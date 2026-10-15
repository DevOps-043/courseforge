-- Additive rollout. New document/import tables are API-only: RLS enabled,
-- no anon/authenticated grants; handlers must authorize artifact ownership.
begin;
alter table public.syllabus add column if not exists input_mode text;
alter table public.syllabus add column if not exists content_version integer not null default 0;
alter table public.syllabus add column if not exists active_import_id uuid;
update public.syllabus set input_mode = case when route = 'A_WITH_SOURCE' then 'DOCUMENT_BASED' else 'IDEA' end where input_mode is null;
alter table public.syllabus alter column input_mode set default 'IDEA';
alter table public.syllabus alter column input_mode set not null;
alter table public.syllabus add constraint syllabus_input_mode_check check (input_mode in ('IDEA','DOCUMENT_BASED','PROVIDED_SYLLABUS'));

create table public.syllabus_source_documents (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.artifacts(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  filename text not null check (length(filename) between 1 and 255),
  mime_type text not null check (mime_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/plain')),
  size_bytes integer not null check (size_bytes between 1 and 15728640),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  extracted_text text not null check (length(extracted_text) between 1 and 40000),
  extraction_version text not null default '1',
  created_at timestamptz not null default now(),
  unique(id, artifact_id)
);
create index syllabus_documents_artifact_idx on public.syllabus_source_documents(artifact_id, created_at desc);
alter table public.syllabus_source_documents enable row level security;
revoke all on public.syllabus_source_documents from anon, authenticated;
grant select, insert, delete on public.syllabus_source_documents to service_role;

create function public.guard_syllabus_document_quota() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  perform 1 from public.artifacts where id = new.artifact_id for update;
  if (select count(*) from public.syllabus_source_documents where artifact_id = new.artifact_id) >= 50 then
    raise exception 'SYLLABUS_DOCUMENT_QUOTA';
  end if;
  return new;
end $$;
create trigger syllabus_document_quota before insert on public.syllabus_source_documents for each row execute function public.guard_syllabus_document_quota();

create table public.syllabus_imports (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.artifacts(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  primary_document_id uuid not null,
  support_document_ids uuid[] not null default '{}',
  idempotency_key uuid not null,
  status text not null default 'PARSING' check (status in ('PARSING','REVIEW_REQUIRED','CONFIRMED','ENRICHING','FAILED')),
  revision integer not null default 1 check (revision > 0),
  candidate_outline jsonb not null default '[]' check (jsonb_typeof(candidate_outline) = 'array'),
  extracted_outline jsonb,
  confirmed_outline jsonb,
  confirmed_revision integer,
  issues jsonb not null default '[]',
  unassigned_topics jsonb not null default '[]',
  proposals jsonb not null default '[]',
  operation text check (operation in ('parse','enrich','propose')),
  lease_expires_at timestamptz,
  attempt_count integer not null default 1,
  error_message text,
  source_syllabus_version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(primary_document_id, artifact_id) references public.syllabus_source_documents(id, artifact_id),
  unique(artifact_id, idempotency_key),
  unique(id, artifact_id)
);
create index syllabus_imports_artifact_idx on public.syllabus_imports(artifact_id, created_at desc);
create unique index syllabus_imports_active_artifact_idx on public.syllabus_imports(artifact_id) where lease_expires_at is not null;
create function public.guard_syllabus_import_quota() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  perform 1 from public.artifacts where id = new.artifact_id for update;
  if (select count(*) from public.syllabus_imports where artifact_id = new.artifact_id and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'SYLLABUS_IMPORT_QUOTA';
  end if;
  return new;
end $$;
create trigger syllabus_import_quota before insert on public.syllabus_imports for each row execute function public.guard_syllabus_import_quota();
alter table public.syllabus_imports enable row level security;
revoke all on public.syllabus_imports from anon, authenticated;
grant select, insert, update, delete on public.syllabus_imports to service_role;
alter table public.syllabus add constraint syllabus_active_import_fk foreign key(active_import_id, artifact_id) references public.syllabus_imports(id, artifact_id);

create table public.syllabus_import_revisions (
  import_id uuid not null references public.syllabus_imports(id) on delete cascade,
  revision integer not null,
  actor_id uuid references public.profiles(id) on delete set null,
  outline jsonb not null,
  decision jsonb not null,
  created_at timestamptz not null default now(),
  primary key(import_id, revision)
);
alter table public.syllabus_import_revisions enable row level security;
revoke all on public.syllabus_import_revisions from anon, authenticated;
grant select, insert, delete on public.syllabus_import_revisions to service_role;

-- IDs/text/extracted original cannot be changed by a later application bug.
create function public.guard_syllabus_import_original() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.artifact_id <> old.artifact_id or new.primary_document_id <> old.primary_document_id
     or new.support_document_ids <> old.support_document_ids or new.idempotency_key <> old.idempotency_key
     or (old.extracted_outline is not null and new.extracted_outline is distinct from old.extracted_outline) then
    raise exception 'SYLLABUS_IMPORT_ORIGINAL_IMMUTABLE';
  end if;
  return new;
end $$;
create trigger syllabus_import_original_guard before update on public.syllabus_imports for each row execute function public.guard_syllabus_import_original();

-- Version and invalidate in the same transaction, for all mutation paths.
create function public.version_syllabus_content() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.input_mode <> 'PROVIDED_SYLLABUS' then
    new.input_mode := case when new.route = 'A_WITH_SOURCE' then 'DOCUMENT_BASED' else 'IDEA' end;
  end if;
  if tg_op = 'INSERT' then
    new.content_version := case when new.modules <> '[]'::jsonb then 1 else 0 end;
  elsif new.modules is distinct from old.modules or new.input_mode is distinct from old.input_mode or new.active_import_id is distinct from old.active_import_id then
    new.content_version := old.content_version + 1;
    new.qa := '{"status":"PENDING"}'::jsonb;
    if new.state = 'STEP_APPROVED' then new.state := 'STEP_READY_FOR_QA'; end if;
  else
    new.content_version := old.content_version;
  end if;
  return new;
end $$;
create trigger syllabus_content_version before insert or update on public.syllabus for each row execute function public.version_syllabus_content();

create function public.invalidate_syllabus_dependents() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare artifact uuid;
begin
  if tg_op = 'UPDATE' and new.content_version = old.content_version then return new; end if;
  if tg_op = 'INSERT' and new.content_version = 0 then return new; end if;
  artifact := case when tg_op = 'DELETE' then old.artifact_id else new.artifact_id end;
  update public.instructional_plans set upstream_dirty = true, upstream_dirty_source = 'Temario' where artifact_id = artifact;
  update public.curation set upstream_dirty = true, upstream_dirty_source = 'Temario' where artifact_id = artifact;
  update public.materials set upstream_dirty = true, upstream_dirty_source = 'Temario' where artifact_id = artifact;
  update public.publication_requests set upstream_dirty = true, upstream_dirty_source = 'Temario' where artifact_id = artifact;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.invalidate_syllabus_dependents() from public, anon, authenticated;
create trigger syllabus_dependents_invalidation after insert or update or delete on public.syllabus for each row execute function public.invalidate_syllabus_dependents();

-- All callers are trusted server adapters. No user-controlled SQL or arbitrary
-- table writes; compare-and-swap and snapshots happen under one row lock.
create function public.transition_syllabus_import(p_artifact_id uuid, p_import_id uuid, p_revision integer, p_action text, p_payload jsonb default '{}', p_actor_id uuid default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare entry public.syllabus_imports; current_version integer; target_state text; snapshot_decision jsonb; result jsonb;
begin
  -- Serialize against syllabus edits without holding a lock during provider calls.
  perform 1 from public.artifacts where id = p_artifact_id for update;
  select * into entry from public.syllabus_imports where id = p_import_id and artifact_id = p_artifact_id for update;
  if not found then raise exception 'SYLLABUS_IMPORT_NOT_FOUND'; end if;
  if entry.revision <> p_revision then raise exception 'SYLLABUS_IMPORT_CONFLICT'; end if;
  select content_version into current_version from public.syllabus where artifact_id = p_artifact_id for update;
  current_version := coalesce(current_version, 0);
  if p_action = 'recover' then
    if entry.lease_expires_at is null or entry.lease_expires_at > now() then raise exception 'SYLLABUS_IMPORT_CONFLICT'; end if;
    update public.syllabus_imports set status = 'FAILED', lease_expires_at = null,
      error_message = 'La operación venció. Puedes reintentar conservando el temario.' where id = entry.id;
  elsif p_action = 'revise' then
    if entry.lease_expires_at > now() then raise exception 'SYLLABUS_IMPORT_BUSY'; end if;
    update public.syllabus_imports set candidate_outline = p_payload->'outline', confirmed_outline = null, confirmed_revision = null,
      status = 'REVIEW_REQUIRED', operation = null, lease_expires_at = null, proposals = '[]', error_message = null
      where id = entry.id;
    snapshot_decision := jsonb_build_object('action','revise','previous',entry.candidate_outline);
  elsif p_action = 'confirm' then
    if entry.status <> 'REVIEW_REQUIRED' then raise exception 'SYLLABUS_IMPORT_INVALID_STATE'; end if;
    update public.syllabus_imports set confirmed_outline = candidate_outline, confirmed_revision = revision + 1, status = 'CONFIRMED' where id = entry.id;
    snapshot_decision := jsonb_build_object('action','confirm','issues_acknowledged',entry.issues,'unassigned_topics_acknowledged',entry.unassigned_topics);
  elsif p_action in ('reserve_enrich','reserve_propose','retry') then
    if entry.lease_expires_at > now() then raise exception 'SYLLABUS_IMPORT_BUSY'; end if;
    if p_action <> 'retry' and entry.status <> 'CONFIRMED' then raise exception 'SYLLABUS_IMPORT_INVALID_STATE'; end if;
    if p_action = 'retry' and (entry.operation is null or entry.status not in ('FAILED','PARSING','ENRICHING')) then raise exception 'SYLLABUS_IMPORT_INVALID_STATE'; end if;
    if p_action = 'retry' and entry.attempt_count >= 3 then raise exception 'SYLLABUS_IMPORT_ATTEMPT_LIMIT'; end if;
    update public.syllabus_imports set
      operation = case p_action when 'reserve_enrich' then 'enrich' when 'reserve_propose' then 'propose' else operation end,
      status = case when p_action = 'retry' and entry.operation = 'parse' then 'PARSING' else 'ENRICHING' end,
      lease_expires_at = now() + interval '10 minutes', error_message = null,
      source_syllabus_version = current_version,
      attempt_count = case when p_action = 'retry' then attempt_count + 1 else 1 end
      where id = entry.id;
  elsif p_action in ('parsed','enriched','proposed','failed') then
    if entry.lease_expires_at is null or entry.lease_expires_at <= now() then raise exception 'SYLLABUS_IMPORT_CONFLICT'; end if;
    if p_action = 'parsed' then
      if entry.operation <> 'parse' then raise exception 'SYLLABUS_IMPORT_INVALID_STATE'; end if;
      update public.syllabus_imports set candidate_outline = p_payload->'outline', extracted_outline = p_payload->'outline',
        issues = p_payload->'issues', unassigned_topics = p_payload->'unassignedTopics', status = 'REVIEW_REQUIRED', operation = null,
        lease_expires_at = null where id = entry.id;
    elsif p_action = 'proposed' then
      if entry.operation <> 'propose' then raise exception 'SYLLABUS_IMPORT_INVALID_STATE'; end if;
      update public.syllabus_imports set proposals = p_payload->'proposals', status = 'CONFIRMED', operation = null,
        lease_expires_at = null where id = entry.id;
    elsif p_action = 'failed' then
      update public.syllabus_imports set status = 'FAILED', error_message = coalesce(left(p_payload->>'message',500),'No se pudo completar la operación. Puedes reintentar conservando el temario.'), lease_expires_at = null where id = entry.id;
    else
      if entry.operation <> 'enrich' or entry.confirmed_outline is null then raise exception 'SYLLABUS_IMPORT_INVALID_STATE'; end if;
      if current_version <> entry.source_syllabus_version then raise exception 'SYLLABUS_IMPORT_CONFLICT'; end if;
      if exists(select 1 from public.syllabus where artifact_id = p_artifact_id and state = 'STEP_GENERATING') then raise exception 'SYLLABUS_IMPORT_BUSY'; end if;
      insert into public.syllabus(artifact_id, route, input_mode, active_import_id, modules, source_summary, validation, qa, state)
      values(p_artifact_id,'A_WITH_SOURCE','PROVIDED_SYLLABUS',entry.id,p_payload->'modules',p_payload->'metadata',p_payload->'validation','{"status":"PENDING"}', 'STEP_READY_FOR_QA')
      on conflict(artifact_id) do update set route = excluded.route, input_mode = excluded.input_mode, active_import_id = excluded.active_import_id,
        modules = excluded.modules, source_summary = excluded.source_summary, validation = excluded.validation, qa = excluded.qa, state = excluded.state, updated_at = now();
      update public.syllabus_imports set status = 'CONFIRMED', operation = null, lease_expires_at = null where id = entry.id;
    end if;
  elsif p_action = 'decide' then
    if entry.status <> 'CONFIRMED' then raise exception 'SYLLABUS_IMPORT_INVALID_STATE'; end if;
    update public.syllabus_imports set candidate_outline = p_payload->'outline', confirmed_outline = null, confirmed_revision = null, status = 'REVIEW_REQUIRED', proposals = '[]' where id = entry.id;
    snapshot_decision := jsonb_build_object('action','decide','accepted_ids',p_payload->'acceptedIds','proposals',entry.proposals);
  else raise exception 'SYLLABUS_IMPORT_INVALID_ACTION';
  end if;
  update public.syllabus_imports set revision = revision + 1, updated_at = now() where id = entry.id returning to_jsonb(syllabus_imports.*) into result;
  if snapshot_decision is not null then
    insert into public.syllabus_import_revisions(import_id, revision, actor_id, outline, decision)
    values(entry.id, (result->>'revision')::integer, p_actor_id, result->'candidate_outline', snapshot_decision);
  end if;
  return result;
end $$;
revoke all on function public.transition_syllabus_import(uuid,uuid,integer,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.transition_syllabus_import(uuid,uuid,integer,text,jsonb,uuid) to service_role;

-- Existing background jobs can checkpoint the exact syllabus version they read.
alter table public.instructional_plans add column if not exists syllabus_content_version integer;
alter table public.curation add column if not exists syllabus_content_version integer;
alter table public.materials add column if not exists syllabus_content_version integer;
alter table public.publication_requests add column if not exists syllabus_content_version integer;
comment on column public.syllabus.input_mode is 'Origin contract; PROVIDED_SYLLABUS requires confirmed import fidelity.';

-- Fidelity also protects direct table writes; authority comes from immutable
-- server-only snapshots, not metadata supplied by the caller.
create function public.guard_provided_syllabus_fidelity() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare baseline jsonb; module jsonb; lesson jsonb; actual_module jsonb; actual_lesson jsonb; module_index bigint; lesson_index bigint;
begin
  if tg_op = 'UPDATE' and old.input_mode = 'PROVIDED_SYLLABUS' and new.input_mode <> old.input_mode then
    raise exception 'PROVIDED_SYLLABUS_RESET_REQUIRED';
  end if;
  if new.input_mode <> 'PROVIDED_SYLLABUS' then return new; end if;
  select r.outline into baseline from public.syllabus_import_revisions r join public.syllabus_imports i on i.id = r.import_id
    where i.id = new.active_import_id and i.artifact_id = new.artifact_id
    and r.revision = (new.source_summary->>'import_revision')::integer and r.decision->>'action' = 'confirm';
  if baseline is null or jsonb_array_length(baseline) <> jsonb_array_length(new.modules) then raise exception 'PROVIDED_SYLLABUS_FIDELITY'; end if;
  for module, module_index in select value, ordinality from jsonb_array_elements(baseline) with ordinality loop
    actual_module := new.modules->(module_index::integer - 1);
    if actual_module->>'id' is distinct from module->>'id' or actual_module->>'title' is distinct from module->>'title'
      or (module->>'objective_general_ref' <> '' and actual_module->>'objective_general_ref' is distinct from module->>'objective_general_ref')
      or jsonb_array_length(actual_module->'lessons') <> jsonb_array_length(module->'lessons') then raise exception 'PROVIDED_SYLLABUS_FIDELITY'; end if;
    for lesson, lesson_index in select value, ordinality from jsonb_array_elements(module->'lessons') with ordinality loop
      actual_lesson := actual_module->'lessons'->(lesson_index::integer - 1);
      if actual_lesson->>'id' is distinct from lesson->>'id' or actual_lesson->>'title' is distinct from lesson->>'title'
        or coalesce(actual_lesson->'topics','[]') is distinct from lesson->'topics'
        or (lesson->>'objective_specific' <> '' and actual_lesson->>'objective_specific' is distinct from lesson->>'objective_specific') then raise exception 'PROVIDED_SYLLABUS_FIDELITY'; end if;
    end loop;
  end loop;
  return new;
end $$;
revoke all on function public.guard_provided_syllabus_fidelity() from public, anon, authenticated;
create trigger syllabus_aa_import_fidelity before insert or update on public.syllabus for each row execute function public.guard_provided_syllabus_fidelity();

-- Phase version guards remain active even if the UI warning is dismissed.
create function public.guard_provided_syllabus_dependency() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare syllabus_row public.syllabus; previous jsonb; next_record jsonb; previous_state text; next_state text; starts_generation boolean; content_changed boolean; dependency_version integer;
begin
  -- Avoid reverse row-lock order with the syllabus invalidation trigger.
  -- Version stamps and transactional invalidation detect concurrent changes.
  select * into syllabus_row from public.syllabus where artifact_id = new.artifact_id;
  if not found or syllabus_row.input_mode <> 'PROVIDED_SYLLABUS' then return new; end if;
  next_record := to_jsonb(new);
  previous := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  next_state := coalesce(next_record->>'state',next_record->>'status','');
  previous_state := coalesce(previous->>'state',previous->>'status','');
  -- Dirty marking itself and heartbeat-only updates must always remain possible.
  starts_generation := next_state in ('STEP_PROCESSING','PHASE2_GENERATING','PHASE3_GENERATING')
    and (tg_op = 'INSERT' or next_state <> previous_state or next_record->'iteration_count' is distinct from previous->'iteration_count'
      or next_record->'attempt_number' is distinct from previous->'attempt_number' or next_record->'version' is distinct from previous->'version');
  if tg_table_name = 'publication_requests' and next_state = 'DRAFT' and
    (tg_op = 'INSERT' or next_record->'lesson_videos' is distinct from previous->'lesson_videos' or next_record->'selected_lessons' is distinct from previous->'selected_lessons') then
    select syllabus_content_version into dependency_version from public.materials where artifact_id = new.artifact_id;
    if dependency_version is distinct from syllabus_row.content_version then raise exception 'PROVIDED_SYLLABUS_STALE_MATERIALS'; end if;
    new.syllabus_content_version := syllabus_row.content_version;
  elsif tg_op = 'UPDATE' and not starts_generation and new.syllabus_content_version is distinct from old.syllabus_content_version then
    raise exception 'PROVIDED_SYLLABUS_VERSION_IMMUTABLE';
  end if;
  content_changed := tg_table_name = 'instructional_plans' and next_record->'lesson_plans' is distinct from previous->'lesson_plans';
  if starts_generation then
    if syllabus_row.state <> 'STEP_APPROVED' then raise exception 'PROVIDED_SYLLABUS_APPROVAL_REQUIRED'; end if;
    if tg_table_name <> 'instructional_plans' then
      select syllabus_content_version into dependency_version from public.instructional_plans where artifact_id = new.artifact_id;
      if dependency_version is distinct from syllabus_row.content_version then raise exception 'PROVIDED_SYLLABUS_STALE_PLAN'; end if;
    end if;
    if tg_table_name = 'materials' then
      select syllabus_content_version into dependency_version from public.curation where artifact_id = new.artifact_id;
      if dependency_version is distinct from syllabus_row.content_version then raise exception 'PROVIDED_SYLLABUS_STALE_SOURCES'; end if;
    end if;
    new.syllabus_content_version := syllabus_row.content_version;
    new.upstream_dirty := false;
  elsif content_changed or (next_state <> previous_state and next_state in ('STEP_APPROVED','STEP_READY_FOR_REVIEW','PHASE2_APPROVED','PHASE3_APPROVED','READY','SENT')) then
    if new.syllabus_content_version is distinct from syllabus_row.content_version or syllabus_row.state <> 'STEP_APPROVED' then
      raise exception 'PROVIDED_SYLLABUS_STALE_DEPENDENCY';
    end if;
    if tg_table_name = 'publication_requests' then
      select syllabus_content_version into dependency_version from public.materials where artifact_id = new.artifact_id;
      if dependency_version is distinct from syllabus_row.content_version then raise exception 'PROVIDED_SYLLABUS_STALE_MATERIALS'; end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_provided_syllabus_dependency() from public, anon, authenticated;
create trigger plan_provided_syllabus_version before insert or update on public.instructional_plans for each row execute function public.guard_provided_syllabus_dependency();
create trigger curation_provided_syllabus_version before insert or update on public.curation for each row execute function public.guard_provided_syllabus_dependency();
create trigger materials_provided_syllabus_version before insert or update on public.materials for each row execute function public.guard_provided_syllabus_dependency();
create trigger publication_provided_syllabus_version before insert or update on public.publication_requests for each row execute function public.guard_provided_syllabus_dependency();

commit;
