-- Solo lectura de historial; no vuelve a crear tablas ni modifica la base.
select version, name
from supabase_migrations.schema_migrations
where version = '20261026160000'
   or lower(coalesce(name, '')) like '%synchronous_course_delivery%'
order by version;
