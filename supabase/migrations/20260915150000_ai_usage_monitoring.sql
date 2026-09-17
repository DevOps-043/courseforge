begin;

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  provider_request_id text,
  provider text not null check (provider in ('openai', 'gemini')),
  model text not null,
  pipeline_step text not null,
  operation text not null,
  organization_id uuid,
  artifact_id uuid,
  lesson_id text,
  run_id text,
  user_id uuid,
  attempt integer not null default 1 check (attempt >= 1),
  status text not null check (status in ('succeeded', 'failed', 'incomplete')),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  cached_input_tokens bigint not null default 0 check (cached_input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  reasoning_tokens bigint not null default 0 check (reasoning_tokens >= 0),
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  web_search_calls integer not null default 0 check (web_search_calls >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  estimated_cost_usd numeric(18, 8),
  pricing_version text,
  error_code text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.ai_usage_events is
  'Append-only AI usage ledger. Never stores prompts, responses, document contents or other generated content.';
comment on column public.ai_usage_events.event_key is
  'Idempotency key for a single provider interaction.';
comment on column public.ai_usage_events.user_id is
  'Soflia user UUID when the initiating user is known; intentionally has no local FK.';

create unique index if not exists ai_usage_events_provider_request_unique
  on public.ai_usage_events (provider, provider_request_id)
  where provider_request_id is not null;
create index if not exists ai_usage_events_occurred_at_idx
  on public.ai_usage_events (occurred_at desc);
create index if not exists ai_usage_events_org_time_idx
  on public.ai_usage_events (organization_id, occurred_at desc);
create index if not exists ai_usage_events_artifact_time_idx
  on public.ai_usage_events (artifact_id, occurred_at desc);
create index if not exists ai_usage_events_step_time_idx
  on public.ai_usage_events (pipeline_step, occurred_at desc);

alter table public.ai_usage_events enable row level security;
revoke all on table public.ai_usage_events from public, anon, authenticated;
grant select, insert on table public.ai_usage_events to service_role;

create table if not exists public.ai_pricing_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  provider text not null check (provider in ('openai', 'gemini')),
  model_pattern text not null,
  input_per_million_usd numeric(18, 8),
  cached_input_per_million_usd numeric(18, 8),
  output_per_million_usd numeric(18, 8),
  web_search_call_usd numeric(18, 8),
  effective_from timestamptz not null,
  effective_to timestamptz,
  source_url text,
  created_at timestamptz not null default now(),
  unique (version, provider, model_pattern)
);

comment on table public.ai_pricing_versions is
  'Versioned pricing inputs. No price is inferred until an authorized operator records a source-backed version.';
alter table public.ai_pricing_versions enable row level security;
revoke all on table public.ai_pricing_versions from public, anon, authenticated;
grant select, insert, update on table public.ai_pricing_versions to service_role;

create table if not exists public.ai_provider_cost_daily (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('openai', 'gemini')),
  usage_date date not null,
  project_id text,
  line_item text,
  amount_usd numeric(18, 8) not null default 0,
  source text not null,
  synced_at timestamptz not null default now(),
  unique nulls not distinct (provider, usage_date, project_id, line_item, source)
);

alter table public.ai_provider_cost_daily enable row level security;
revoke all on table public.ai_provider_cost_daily from public, anon, authenticated;
grant select, insert, update on table public.ai_provider_cost_daily to service_role;

create table if not exists public.ai_usage_reconciliation (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('openai', 'gemini')),
  usage_date date not null,
  local_input_tokens bigint not null default 0,
  local_output_tokens bigint not null default 0,
  provider_input_tokens bigint,
  provider_output_tokens bigint,
  local_estimated_cost_usd numeric(18, 8),
  provider_actual_cost_usd numeric(18, 8),
  variance_percent numeric(12, 4),
  reconciled_at timestamptz not null default now(),
  unique (provider, usage_date)
);

alter table public.ai_usage_reconciliation enable row level security;
revoke all on table public.ai_usage_reconciliation from public, anon, authenticated;
grant select, insert, update on table public.ai_usage_reconciliation to service_role;

create or replace function public.get_ai_usage_dashboard(
  p_start timestamptz,
  p_end timestamptz,
  p_bucket text default 'day'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if p_bucket not in ('day', 'week', 'month') then
    raise exception 'Invalid AI usage bucket';
  end if;

  with selected as (
    select *
    from public.ai_usage_events
    where occurred_at >= p_start and occurred_at < p_end
  ), bucketed as (
    select
      date_trunc(p_bucket, timezone('America/Mexico_City', occurred_at)) as bucket_start,
      sum(input_tokens) as input_tokens,
      sum(cached_input_tokens) as cached_input_tokens,
      sum(output_tokens) as output_tokens,
      sum(reasoning_tokens) as reasoning_tokens,
      sum(total_tokens) as total_tokens,
      sum(web_search_calls) as web_search_calls,
      count(*) as requests,
      count(*) filter (where status = 'failed') as failed_requests,
      sum(estimated_cost_usd) as estimated_cost_usd
    from selected
    group by 1
  ), by_step as (
    select
      pipeline_step,
      sum(total_tokens) as total_tokens,
      sum(web_search_calls) as web_search_calls,
      count(*) as requests,
      count(*) filter (where status = 'failed') as failed_requests,
      sum(estimated_cost_usd) as estimated_cost_usd
    from selected
    group by pipeline_step
    order by sum(total_tokens) desc
  ), by_provider as (
    select
      provider,
      sum(total_tokens) as total_tokens,
      sum(web_search_calls) as web_search_calls,
      count(*) as requests,
      count(*) filter (where status = 'failed') as failed_requests
    from selected
    group by provider
    order by sum(total_tokens) desc
  ), provider_costs as (
    select sum(amount_usd) as actual_cost_usd
    from public.ai_provider_cost_daily
    where usage_date >= timezone('America/Mexico_City', p_start)::date
      and usage_date <= timezone('America/Mexico_City', p_end)::date
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'input_tokens', coalesce((select sum(input_tokens) from selected), 0),
      'cached_input_tokens', coalesce((select sum(cached_input_tokens) from selected), 0),
      'output_tokens', coalesce((select sum(output_tokens) from selected), 0),
      'reasoning_tokens', coalesce((select sum(reasoning_tokens) from selected), 0),
      'total_tokens', coalesce((select sum(total_tokens) from selected), 0),
      'web_search_calls', coalesce((select sum(web_search_calls) from selected), 0),
      'requests', (select count(*) from selected),
      'failed_requests', (select count(*) from selected where status = 'failed'),
      'estimated_cost_usd', (select sum(estimated_cost_usd) from selected),
      'actual_cost_usd', (select actual_cost_usd from provider_costs),
      'last_event_at', (select max(occurred_at) from selected)
    ),
    'buckets', coalesce((select jsonb_agg(to_jsonb(bucketed) order by bucket_start) from bucketed), '[]'::jsonb),
    'by_step', coalesce((select jsonb_agg(to_jsonb(by_step)) from by_step), '[]'::jsonb),
    'by_provider', coalesce((select jsonb_agg(to_jsonb(by_provider)) from by_provider), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_ai_usage_dashboard(timestamptz, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.get_ai_usage_dashboard(timestamptz, timestamptz, text)
  to service_role;

commit;
