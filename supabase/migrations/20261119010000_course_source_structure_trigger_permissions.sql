-- Instancia: Supabase de Architect. Requiere las migraciones documentales F3/F4.
-- El navegador inserta artifacts bajo sus políticas RLS; la guarda consulta
-- tablas documentales privadas sin conceder acceso directo al usuario.
-- Ejecutar como propietario de migraciones confiable (postgres), nunca como
-- authenticated. No modifica filas, políticas RLS ni permisos de tablas.
begin;
alter function public.guard_course_source_structure_generation() security definer;
alter function public.guard_course_source_structure_generation() set search_path = '';
revoke all on function public.guard_course_source_structure_generation() from public, anon, authenticated;
commit;
-- Idempotente. Reversión: ALTER FUNCTION ... SECURITY INVOKER; restaura el
-- bloqueo original de inserciones autenticadas. No requiere revertir datos.
