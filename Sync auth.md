Resumen del problema
Tenemos dos sistemas independientes (un LMS y una plataforma de talleres con IA) corriendo en el mismo entorno pero en proyectos separados de Supabase/Postgres. Cada proyecto tiene su propia tabla auth.users (o equivalente) y gestiona usuarios por separado. El objetivo es que el usuario tenga una sola identidad lógica (SSO) para ambos sistemas, sin fusionar los proyectos. Es decir, al final cada persona debe acceder con un solo login (un único conjunto de credenciales) y los dos sistemas deben confiar en esa identidad unificada. Esto implica que, conceptualmente, haya “una sola tabla de usuarios” lógica (no física): los datos de usuario podrían residir en distintos esquemas, pero deben vincularse para evitar duplicidad, conflictos o discrepancia de roles. Como supuestos mínimos, consideramos que ambos proyectos pueden configurarse para confiar en un mismo proveedor de identidad (IdP) externo u otro mecanismo común, y que cada usuario está identificado en cada sistema por un UUID o email único.

Enfoques posibles (sin fusionar proyectos)
Proveedor de Identidad externo (IdP) con OIDC/SAML: Usar un IdP dedicado (Auth0, Keycloak, Okta, Azure AD, etc.) que maneje los usuarios. Ambos proyectos Supabase se configuran como aplicaciones (clientes) de este IdP usando OpenID Connect (OIDC) o SAML SSO
. Al iniciar sesión, el usuario es autenticado en el IdP y redirigido de vuelta a cada proyecto con un token único.

Supabase Auth central como IdP único: Designar uno de los proyectos Supabase (o un tercero) como “proyecto SSO”. Ese proyecto almacena la base de usuarios (tabla auth.users). El otro proyecto confía en él usando un flujo de autenticación personalizado (por ejemplo, redirigir al login del proyecto SSO, recibir un JWT firmado por Supabase Auth y validarlo localmente).

JWT / Autenticación propia (Edge Functions o microservicio): Crear un servicio de autenticación personalizado (usando Supabase Edge Functions o un servidor propio) que emita JSON Web Tokens firmados con una clave compartida. Ambos proyectos Supabase usan la misma llave secreta de JWT (se puede configurar manualmente
) para verificar tokens. De este modo, un JWT emitido por el servicio de auth se acepta en ambos proyectos.

Sincronización mediante webhooks o tareas programadas (cron): Mantener tablas de usuario espejos sincronizadas en ambos proyectos. Por ejemplo, al crearse/actualizarse un usuario en el proyecto A se dispara un webhook (o trigger de base) que inserta/actualiza la fila correspondiente en el proyecto B (y viceversa). Esto puede hacerse con funciones en la nube, triggers de NOTIFY/LISTEN o un CRON que use la API de Supabase (o supabase.auth.admin.createUser) para replicar usuarios, roles y status.

Vinculación de cuentas por email/UUID con verificación: No sincronizar automáticamente, sino permitir que un usuario vincule manualmente (o semiautomáticamente) sus cuentas en ambos proyectos. Por ejemplo, si el usuario existe con el mismo email en ambos, al iniciar sesión el sistema ofrece un paso extra para confirmar “Soy el mismo usuario” (por email o código), y luego enlaza internamente las dos IDs. Esto puede aprovechar identidad compartida: se podría usar el campo provider_id de Supabase (ver más abajo) o un mapeo propio para unir cuentas.

Proveedor externo con provisión SCIM: Usar un IdP con soporte SCIM (por ejemplo Okta o Keycloak empresarial) para provisionar usuarios en ambas bases. El IdP actúa como fuente de verdad y crea/modifica/baja usuarios en cada proyecto vía llamadas SCIM (o APIs personalizadas).

(Las opciones 1 y 6 se relacionan; 6 enfatiza la provisión de usuarios desde el IdP).

Análisis de cada enfoque

1. IdP externo (Auth0/Keycloak/Okta) con OIDC o SAML
   Diagrama de componentes (texto):

scss
Copiar
[Usuario]
↓ (login)
[IdP externo (Auth0/Okta/Keycloak)]
↓ (token OIDC/SAML Assertion)
[Supabase A Auth] ←→ PostgresA (tabla de usuarios local)
↓
[API/LMS]
(Simétrico para Supabase B.)

Flujo de autenticación: El usuario accede a cualquiera de los sistemas (A o B), hace clic en “Iniciar sesión” y es redirigido al IdP (Auth0/Keycloak/etc.). Tras autenticarse, el IdP redirige de regreso al proyecto correspondiente con un token OIDC (JWT) o aserción SAML. Supabase Auth valida el token (usando la configuración OIDC/SAML) y crea/actualiza un registro de identidad en auth.users.

Mapeo de IDs: Cada proyecto registra al usuario en su tabla auth.users. En ambas, el campo provider_id (identidad externa) contendrá el mismo valor del IdP (ej. sub del JWT o NameID SAML)
. Sin embargo, cada proyecto genera su propio UUID de usuario interno (auth.users.id). Podríamos mantener una tabla de enlace externa a Supabase (o deducirlo) usando el provider_id o email como clave lógica.

Propagación de cambios (alta/baja/roles): Las altas de usuarios se gestionan centralmente en el IdP; ambos proyectos simplemente “heredan” el usuario la primera vez que inicia sesión. Para bajas o suspensiones, habría que hacerlo en el IdP (bloquear usuario) y en ambos proyectos usando hooks (p.ej. un trigger que al detectar el cambio en el IdP active un webhook a Supabase A y B para desactivar el usuario con supabase.auth.admin.updateUser). Los roles/claims pueden sincronizarse si el IdP incluye atributos (p.ej. rol en el JWT), que luego mapeamos a políticas RLS o tablas de roles en cada proyecto.

Impacto en RLS/claims: Con OIDC/SAML, el JWT incluirá claims estándar (sub, email) y posiblemente personalizados. En RLS podemos usar auth.jwt()#>>'{provider}' o campos en user_metadata para distinguir, pero típicamente nos basamos en auth.uid() (UUID local) y/o auth.jwt()#>>'{sub}' (ID del IdP). En Supabase cada usuario tiene su propio UUID aunque provenga del mismo IdP. Como Supabase advierte, al usar SSO no hay linking automático con cuentas previas, por lo que podría haber múltiples cuentas con mismo email en un proyecto (peligro de duplicados
). Es crucial que las políticas RLS usen el UUID interno (auth.uid()) y no el email para aislar datos. También se pueden usar atributos SAML/OIDC en RLS (ej. auth.jwt()#>>'{amr,0,method}' para saber que vino por SAML).

Latencia: Media. La redirección a IdP añade un salto adicional (~unos cientos de ms). La validación de tokens OIDC/SAML es rápida, pero configurar el flujo (certificados, metadatos) puede ser compleja inicialmente.

Costos: Puede implicar licencias o costos de SaaS (Auth0/Okta) dependiendo de volumen. Keycloak es OSS/self-hosted (solo costo de infraestructura). Supabase solo cobra por el uso normal (no hay costo adicional por OIDC externo). Si se usa SAML, requiere plan Pro+ de Supabase
.

Complejidad: Moderada-alta. Requiere configurar el IdP, registrar apps para A y B, ajustes en Supabase dashboard o CLI para SAML/OIDC. Hay que manejar SSL, redirecciones, certificados, etc. La implementación inicial es compleja, pero luego el login es estándar.

Riesgos: Dependencia del IdP (resiliencia y seguridad externa). Fallos en el IdP afectan ambos sistemas. Cuidado con sincronizar atributos/roles. Sin validación cuidadosa, podrían crearse cuentas duplicadas (mismo email). Si el IdP cae, todo SSO falla (se pueden habilitar login por correo fallback). Venta atada a proveedor (Auth0, Okta) y limitación de planes SAML de Supabase.

Cita relevante: Supabase Auth soporta SSO SAML con IdPs como Okta y Auth0
, pero advierte que «no hay linking automático; si un usuario se inscribió con contraseña y luego con SSO, habrá dos cuentas separadas”
.

2. Supabase Auth central (un proyecto SSO + segundo cliente)
   Diagrama (texto):

scss
Copiar
┌─────────────┐
│ Proyecto A │
│ (clientes) │◀────────┐
└─────────────┘ │
▲ │
│ │
(tokens/jwt) │
│ │
┌─────────────┐ │
│ Proyecto SSO│────────┘
│ (Usuarios) │
└─────────────┘
(o alternativo: Proyecto A y B consumen el auth del SSO).

Flujo de auth: El “proyecto SSO” tiene el registro maestro de usuarios (auth.users). Un usuario inicia sesión en SSO (por email/password o Social); recibe un JWT de Supabase Auth SSO. Para acceder a los otros proyectos (A/B), se envía este JWT en peticiones o redirecciones. Los proyectos A y B deben validar ese JWT: para ello, compartimos la misma JWT secret entre proyectos (ver abajo) y pre-creamos en A/B usuarios con el mismo ID que en SSO (o al menos dejamos que A/B acepten el token).

Mapeo de IDs: Idealmente, los UUID de usuarios en SSO deben coincidir con los de A y B. Podemos lograrlo si al crear usuarios en SSO (por auth.admin.createUser o migración) guardamos ese UUID en una tabla de mapping en A/B. Con la misma clave JWT, el sub del token (el UUID de SSO) es verificable por A y B. Alternativamente, configurar el mismo JWT secret en Supabase permite que un token firmado por SSO sea válido en A/B
; luego, cada proyecto puede usar auth.uid() directamente (suponiendo el usuario ya existe o se crea al vuelo).

Propagación de cambios: Al cambiar datos del usuario (email, contraseña) se haría sólo en el SSO. B y C necesitarían suscribirse a cambios (via webhooks o schedulers) para replicar esos cambios en sus propias tablas auth.users (crear o actualizar usuario, roles, etc.), posiblemente usando supabase.auth.admin desde un script. Las bajas (borrado de cuenta) igual; o A/B pueden rechazar tokens de usuarios desactivados consultando al SSO o consultando una tabla central.

Impacto en RLS/claims: Todos los datos de autenticación provienen del token del SSO. RLS puede basarse en auth.uid() (mismo ID en todos) y/o en claims custom, pero el SQL user ID único facilita comparaciones. Sin embargo, hay que tener cuidado con permisos: cada proyecto puede tener tablas propias de roles, así que un usuario debe tener los roles correctos en cada. Se pueden usar custom claims al generar el token o guardar roles en JWT para RLS (requiere hooks de supabase
para agregar claims).

Latencia: Baja. No hay redirección a terceros (tras login, se usa directamente token). La validación JWT es local (instantánea). Sin embargo, la duplicación de datos (si no automatizada) puede añadir latencia a actualizaciones.

Costos: Solo costos de Supabase. Hay sobrecarga de desarrollo para integrarlo.

Complejidad: Alta. Supabase Auth no está diseñado nativamente como IdP OIDC/SAML, así que hay que usar trucos (shared JWT secret, llamadas admin API). Debe gestionarse cuidadosamente la seguridad del token y el flujo de adopción de sesión. Fallo en sincronización causa “usuario no existe en A aunque tenga token válido”. Requiere coordinar secrets (ver advertencia de migrar auth
) y triggers para replicar.

Riesgos: Mucho trabajo manual puede introducir errores. Si el JWT secret no se gestiona correctamente o usuarios no están sincronizados, la autenticación falla. Además, revocar tokens en A/B al cambiar en SSO es complejo (necesitan saber que deben invalidar el token). Vendor lock-in bajo (solo Supabase), pero hay más trabajo de mantenimiento.

Cita relevante: Se ha sugerido usar la misma jwt_secret en todos los proyectos para compartir tokens y que un JWT sea válido en cualquier instancia siempre que el usuario exista y cumpla RLS
.

3. JWT personalizado / Edge Functions
   Diagrama (texto):

scss
Copiar
[Usuario] → [App Cliente] → [Edge Function Auth Service]
↓ ↓ ↓
│ Issue JWT │ └─> [Base de datos de usuarios (por ej. externo o en código)]
└──> [Supabase A] y [Supabase B] (validan JWT)
Flujo: El usuario se autentica ante un servicio propio (p.ej. una Edge Function de Supabase o microservicio externo) que implementa el login (podría validar credenciales en Postgres o MD5/hashes). Este servicio emite un JWT firmado con una llave secreta. El usuario usa ese token para acceder a los proyectos A/B enviándolo en Authorization. Ambos proyectos están configurados para aceptar “external JWT”: se comparte el JWT secret (o llave pública) para que Supabase valide internamente el token como si fuera propio.

Supabase no ofrece out-of-box un “Custom JWT provider”, pero se puede hacer con:

Open Source GoTrue hack: (poco usual).
O más práctico, usar el token para loguear vía API: por ejemplo, un Edge Function recibe el JWT, llama a supabase.auth.api.signInWithOAuth() con un “custom provider”, o incluso rellena la cabecera Authorization: Bearer <token> en consultas a la base supabase.
Mapeo de IDs: Similar al enfoque anterior: decidimos que los tokens llevarán un campo sub con el UUID interno. Podríamos usar la misma base de usuarios en ambos o un sistema de usuarios fuera de Supabase. Si confiamos en Supabase Auth, tendríamos que crear usuarios con esos IDs en cada base, o bien extender RLS para confiar en el sub directamente (pero supabase verifica el usuario existe en auth.users). En general, habría que sincronizar el usuario en ambos proyectos cuando se registra.

Propagación: Este método es más DIY: un nuevo usuario se ingresa en el servicio auth (que puede actualizar ambas bases via admin API). Los roles serían administrados en el token o en tablas propias. Cambios se manejan en el servicio y se reflejan en las bases con llamadas al API de supabase.

Impacto en RLS/claims: Se puede incluir cualquier claim en el JWT. RLS puede usar claims personalizados (auth.jwt()) si se inyectan antes de emitir. Si seguimos la misma lógica de shared JWT secret, es esencial que los claims (sub, exp, etc.) sean compatibles. Sin embargo, la ausencia de un IdP estándar puede dificultar cumplir normativas.

Latencia: Similar al flujo de shared JWT (muy bajo), excepto la generación inicial del token que es instantánea. Si usamos un Edge Function, puede adicionar ~50-100ms en el proceso inicial de login.

Costos: Depende de infra. Si usamos Supabase Edge Functions (gratis hasta cierto uso), el costo es bajo. Complexity cuesta más en tiempo de desarrollo.

Complejidad: Muy alta. Implica construir un sistema de auth desde cero o casi. Hay que gestionar almacenamiento seguro de claves, renovación de tokens, etc. Además, integrar esto con Supabase requiere trucos (supabase no tiene UI para “introducir tokens externos”). Mantenibilidad alta.

Riesgos: Potencialmente grandes, pues un error de seguridad en nuestra implementación puede ser crítico (gestión de contraseñas, firmas JWT). No hay auditoría ni comunidad como en IdPs conocidos. Sin embargo, da total control (sin vendor lock-in externo).

4. Sincronización (webhooks / cron / mirror)
   Diagrama (texto):

scss
Copiar
[auth.users en Proyecto A] ↔ [Sync Service] ↔ [auth.users en Proyecto B]
↑ ↑
(supabase webhooks, (admin.api)
triggers o cron) or DB Replication
Flujo: Cada vez que un usuario se crea/actualiza en Proyecto A o B, un sistema de sincronización toma ese evento y lo reproduce en el otro. Por ejemplo, en Proyecto A se configura un Trigger en la base (auth.users) que hace PERFORM post('https://sync-server/sync', row_data). Un microservicio recibe el webhook y usa la API Admin de Supabase para crear o actualizar el usuario en Proyecto B (auth.admin.createUser con email, password etc., o directamente inserta en la tabla Auth via SQL si usamos service_role). De forma similar se sincronizan Proyecto B → A. Podría ser bidireccional, con un campo last_synced_at para evitar bucles infinitos. Otro modelo es un cron que periódicamente lee usuarios de A y B y los compara.

Mapeo de IDs: Si queremos “tabla lógica única”, lo ideal es forzar el mismo UUID en ambas. Usando auth.admin.createUser el UUID es asignado automáticamente; para controlar eso, podríamos inyectar a mano en la DB (no soportado directamente por la API pública), o usar backup/restore para importar la tabla (pero requiere downtime). Más realista: dejarlos con IDs distintos, pero añadir una columna de mapping (p.ej. un campo en public.profiles con el ID de usuario del otro proyecto, o una tabla común en un tercer lugar). Así, sabremos que el usuario X en A corresponde a Y en B. Luego, en código, siempre consultamos esa tabla lógica.

Propagación de cambios: Alta/baja roles: la sincronización debe propagarlas. p.ej. si un admin cambia el rol en A, el trigger debe enviar actualización a B. Para la baja (eliminar usuario), puede hacerse lo mismo (o simplemente marcar confirmed_at = NULL para deshabilitar en vez de borrar). Roles y metadata adicionales (en tablas distintas) podrían sincronizarse también, o gestionarse en cada proyecto dependiendo de la arquitectura.

Impacto en RLS/claims: RLS en cada proyecto ve al usuario por su UUID local (y roles locales). Si tienen IDs diferentes, RLS debe usar esos IDs. Podríamos, como dato extra, añadir el UUID del otro sistema en los claims de JWT o en la sesión (requiere hooks). El reto es asegurar que ambas instancias tengan datos consistentes. La latencia de sincronización significa que un cambio reciente podría no reflejarse instantáneamente.

Latencia: Dependiendo del método: triggers/webhooks pueden ser casi inmediatos (<1s), pero la operación de creación via API lleva decenas-hundreds de ms. Un cron programado introduce retraso (minutos). En general, no es real-time pero sí razonablemente rápida si se hace por evento.

Costos: Uso de triggers/Edge o microservicio (coste mínimo si es serverless o supabase webhook). Supabase permite webhooks en Auth
(audit logs) pero no al nivel de usuario, por lo que quizá se requiera cambiar la función de signup personalizada. Podría implicar consumo de "requests" a API de supabase (uso del key service_role).

Complejidad: Media. Menos compleja que construir un IdP o JWT, pero requiere infraestructura adicional (un cron job o función). Hay que manejar conflictos (¿qué pasa si el mismo email se creó en ambos antes?). Debe cuidarse idempotencia y orden de operaciones. Facilita testeo y rollback (todo en nuestra lógica).

Riesgos: La duplicación es lo que queremos evitar, pero este método crea dos copias sincronizadas. Fallos en la sincronización pueden producir divergencias o conflictos (e.g. rol diferente). Requiere permisos elevados (service_role). Riesgo de loops (si no filtramos updates propios). Data leak: es posible transferir datos sensibles entre proyectos (hay que securizar las llamadas). Sin lock-in de vendor (es propio), pero dependencia de la red/internet si se usa un servidor externo.

5. Vinculación de cuentas (Account Linking por email/UUID)
   Diagrama (texto):

scss
Copiar
[Usuario]
↙ ↘
[Supabase A] [Supabase B]
(Sign in) (Sign in)
│ │
(¿misma cuenta? auto-link/ prompt)
└─────────────┴
(tabla de enlaces central o claims compartidos)
Flujo: Se permite que el usuario tenga cuentas separadas inicialmente, pero el sistema al autenticarse detecta “coincidencia” (p.ej. mismo email). En ese momento, el usuario puede elegir vincular las cuentas (p.ej. reingresando credenciales o por un email de verificación). Por ejemplo, el sistema A ve que su email coincide con una cuenta en B (se podría consultar API de B), y pregunta “¿También usas el sistema B? Ingresa para vincular”. Luego crea un vínculo (en una tabla separada en A o en un servicio central) que indica que A.user_id ↔ B.user_id. A partir de ahí, se considera el mismo usuario.

Mapeo de IDs: Se almacena explícitamente la relación entre el UUID de A y el de B (p.ej. tabla linked_users(usuarioA_id, usuarioB_id)). Alternativamente, una sola tabla externa de usuarios con un campo “main_id” apuntando a un registro central y cada proyecto relaciona con ese ID. En los flujos de sesión, al validar el JWT local, podemos añadir claims extra (Edge Function) que incluyen el ID del otro proyecto como dato, pero esto sería manual.

Propagación de cambios: La sincronización no es automática; los cambios de rol/status deben aplicarse en cada proyecto por separado (o compartirse vía triggers). Si una cuenta vinculada se desactiva en A, debería desactivarse en B manualmente (o mediante un proceso vinculado). Esto aún requiere componentes de sincronización.

Impacto en RLS/claims: Básicamente ninguno automático: RLS actúa por separado en cada proyecto usando cada ID local. La “vinculación” es externa al concepto de Supabase (p.ej. en middleware). Al final, la experiencia de usuario ve una sola identidad (mismo email/mismo rol), pero internamente hay dos usuarios. No hay cambio directo en auth.uid(), por lo que se usaría el mapa vinculado donde se necesite referencia global. Puede hacerse un “single user profiles” externo que contenga roles globales.

Latencia: No añade latencia al login normal, solo un paso extra al vincular (si se hace manual o con token), pero luego la propagación de cambios la decides (podría ser instantánea con un custom hook en sesión).

Costos: Bajo. Es un enfoque más de arquitectura de aplicación que de infra. Sólo se gasta en desarrollo de la lógica de vinculación y en mantener la tabla de enlaces.

Complejidad: Media. Requiere desarrollar lógica adicional (p.ej. páginas para vincular, APIs internas, verificación de propiedad de correo). Pero no necesita configurar IDP externos. Permite que usuarios “decidan” alinear sus cuentas. Sincronizar roles y estados es aún un reto y similar al enfoque de sincronización manual.

Riesgos: El principal es UX: los usuarios pueden confundirse al no estar claro si deben usar la misma credencial en A y B, o hacer un segundo login y luego vincular. Se debe cuidar la seguridad (por ejemplo, ¿cómo verificamos que el usuario en A es el mismo que en B? normalmente con confirmación por email). Además, si un email lo controlan dos usuarios distintos en A y B, vincularlos equivocadamente podría fusionar cuentas ajenas. El vendor lock-in es bajo (all code propio). No elimina duplicidad de datos, solo su gestión.

6. Provisión SCIM via IdP (IdP con Sync automático)
   Diagrama (texto):

css
Copiar
[Proveedor de Identidad con SCIM]
↕ SCIM API
┌─────────────┐ ┌─────────────┐
│ Supabase A │ │ Supabase B │
│ (SCIM client)│ │ (SCIM client)│
└─────────────┘ └─────────────┘
Flujo: Se usa un IdP empresarial que soporta protocolo SCIM (p.ej. Okta, Keycloak con plugin SCIM) para provisionar usuarios. En cada proyecto Supabase se implementa un conector SCIM (podría ser una herramienta externa o un edge function) que expone una API conforme a SCIM para crear/actualizar usuarios. Cuando en el IdP se crea/modifica un usuario, automáticamente la instancia SCIM lo envía a los endpoints configurados de A y B. El usuario es creado en la tabla auth.users de cada proyecto con los datos deseados (email, nombre, etc.). La autenticación luego puede ser local (password) o SSO adicional, pero en general se usa para que ambos proyectos tengan la misma lista de usuarios gestionada desde el IdP.

Mapeo de IDs: En este caso, cada proyecto tendrá su propio UUID de usuario (asignado al crearlo). El IdP puede almacenar un “externalId” que corresponda al sub de un token o un identificador común. Se puede almacenar ese externalId en la base de Supabase (p.ej. usando id de la tabla auth.identities o metadata). Pero la sincronización SCIM se encarga de crear usuarios en cada proyecto sin duplicados al usar el mismo identificador lógico (ej. email).

Propagación: Automática vía SCIM para alta/baja/actualización. Borrar en IdP inactivará en los proyectos (depende de configuración). Roles/tags usualmente también se envían por SCIM en la carga JSON, así los roles se crean en un atributo de usuario (usando admin API al recibir el SCIM payload). Si hay roles en tablas aparte, habría que manejarlo adicionalmente (quizá SCIM Groups). En cualquier caso, cambios en el IdP fluyen a A y B sin necesidad de programar triggers propios.

Impacto en RLS/claims: Los usuarios de ambos proyectos comparten atributos básicos (email, UID del IdP, roles). RLS se gestiona localmente: por ejemplo, se podría usar en A una policy que permita acceso sólo a registros con company_id = auth.jwt()#>>'{user_metadata,company}' si ese claim viene. SCIM puede sincronizar atributos personalizados (e.g. un campo de tenant). Es flexible, pero en Supabase RLS no hay soporte SCIM directo; se trataría de transformar el SCIM push en un update en la DB, lo cual puede hacerse con supabase webhook o direct DB insert.

Latencia: Prácticamente en tiempo real (algo de segundos mientras SCIM envía eventos). Muy bajo retraso en la práctica.

Costos: Depende del IdP licenciado. Okta/OneLogin cobran por SCIM. Herramientas SCIM disponibles pueden ser SaaS o self-hosted. Supabase no cobra extra. El costo principal es el del IdP empresarial (que suele ser alto).

Complejidad: Alta en configuración inicial del IdP y SCIM, pero es un estándar para este problema. Requiere desplegar un servidor SCIM (o usar algo como [0]️ Decadental blog). También configurar correctamente la nube de Supabase para aceptar peticiones externas (necesitas una función HTTP o que se permita escribir en el schema auth, quizá usando un servicio Lambda que use el rol service). Con un conector SCIM ya listo, el mantenimiento es menor (sobre todo para sincronizar grandes cantidades de usuarios).

Riesgos: Vendor lock-in alto hacia un IdP corporativo (Okta, Azure AD). Posibles latencias entre propagaciones si el IdP sufre. Complejidad y riesgo de errores en flujo SCIM (por ejemplo, creación parcial). Seguridad: SCIM endpoints deben estar muy bien protegidos con autenticación mutua. Si algo falla, el sistema podría crear usuarios erróneos o no crear en uno de los proyectos. Sin embargo, SCIM es la forma más estándar de “un solo sistema de usuarios” cuando ambos lados lo soportan.

Matriz comparativa de enfoques
Criterio 1. IdP externo (OIDC/SAML) 2. Supabase central SSO 3. JWT personalizado 4. Sync Webhooks/Cron 5. Linking por email 6. SCIM (IdP+Provision)
Seguridad Alta (depende del IdP). Uso de protocolos estándar (OIDC/SAML) con encriptación. Validación robusta. Riesgo mínimo si el IdP es confiable (p.ej. Keycloak/Azure). Media. El sistema de autenticación es interno, pero depende de supuesta misma seguridad de Supabase. Manejar JWT correctamente es crítico. Puede ser más débil si no se agrega MFA o similar. Variable. Total control, pero alta posibilidad de errores (implementación propia de auth). Si se hace bien, puede ser tan seguro como un IdP, pero requiere mucho trabajo (firmas, manejo de contraseñas). Media. No introduce nuevo vector (usa API de Supabase), pero requiere permisos service_role. Un fallo en la lógica de sync puede crear cuentas no deseadas. Los triggers usan clave segura. Baja-media. Depende de cómo se implemente el enlace. Puede ser inseguro si la vinculación no se verifica bien (por ejemplo, alguien podría vincular su cuenta con la de otro). Requiere confirmación. Alta. IdP corporativo generalmente robusto. SCIM usa HTTPS y token. Requiere asegurar endpoints SCIM. En general estándar y probado en entornos empresariales.
Experiencia (UX) Muy buena. Login único (click, sin login extra). Usuarios ni notan que hay 2 sistemas. Útil “Ir a A/B sin re-login”. Buena. Login único con redirección al SSO. Pero puede requerir configuración extra para que ambos sistemas acepten el token y mantengan sesión. Buena-pequeña fricción inicial. Una vez implementado, el usuario solo entra al servicio de auth y luego su token funciona. Puede requerir copiar/pegar tokens si no se automatiza. Regular. El usuario aún inicia sesión por separado en A y B (o se crea en A y luego se registra en B). Se evita login duplicado solo si la app equipa el token del otro sistema automáticamente. Alta complejidad para el usuario: debe vincular manualmente. Podría ver dos inicios de sesión distintos y un paso de verificación. UX no es de “un click” SSO real, es casi un flujo de migración. Muy buena (igual que IdP 1). El usuario inicia sesión con el IdP (que crea en ambos lugares), luego navega sin notar diferenciación.
Esfuerzo (dev) Alto. Configurar y mantener IdP, integrar OIDC/SAML con Supabase (CLI o dashboard). Tener ambos proyectos listos. Muy alto. Construir flujo personalizado que confiera credenciales de un proyecto a otro. Coordinar secretos de JWT. Lidiar con tokens. Muy alto. Implementar un servicio completo de auth, manejar JWT, integrarlo manualmente con Supabase. Mucha programación de seguridad. Medio-alto. Implementar webhooks/cron y lógica de sync, probar duplicados. Manejo de errores/rollback. Requiere escribir funciones / triggers. Medio. Desarrollar lógica de enlace (front+back), verificación por email, tablas de mapeo. Menos integración con Supabase (p.ej. no toca Auth directamente hasta vincular). Alto. Configurar IdP empresarial (costoso) y desplegar o usar un conector SCIM. Integrar con Supabase mediante un puente (webhooks o funciones) para crear usuarios.
Mantenimiento Medio. Actualizar certificados, gestionar usuarios en IdP. Revisión periódica de flujo SAML/OIDC. Alto. Mantener código que maneje tokens, secrets, actualizaciones. Monitorear errores de sincronía. Alto. El código auth suele necesitar parches (nuevas dependencias, vulnerabilidades). OJO con manejo de secretos JWT. Medio. Depende de la robustez de los scripts. Verificar logs de sincronización. Si algo falla, arreglar duplicados. Alto. Tiene que actualizarse manualmente si cambian ID u opciones de cuenta vinculada. Procedimientos de soporte al usuario. Bajo-medio. Una vez configurado, SCIM se auto-mantiene (IdP en parte gestiona). Hay que revisar logs SCIM. Mantener IdP, no tanto el enlace de supabase (salvo RBAC).
Escalabilidad Alta. Los IdP modernos escalan bien. Supabase maneja su carga normal. Cada sistema evalúa tokens rápidamente. Media. Compartir JWT secret es trivial de escalar. Pero la sincronización masiva puede saturar la API de Supabase si hay miles de usuarios nuevos. Alta técnica. El servicio auth debe escalar (serverless?), pero luego las dos aplicaciones solo validan tokens. Depende de infraestructura propia. Media. Escala bien hasta cierto punto; si crece mucho el número de usuarios cambios masivos pueden requerir batching. Sin embargo, triggers son transaccionales. Media-baja. No escala tan fluido: cada nuevo usuario requiere vinculación manual. Se vuelve difícil en miles de usuarios. Muy alta. Sistemas IdP empresariales (Okta, Azure) están pensados para miles/millones. SCIM es un estándar escalable para aprovisionamiento. Supabase solo recibe llamadas periódicas.
Resiliencia Depende del IdP. Si el IdP cae, no se puede iniciar sesión. Supabase seguiría respondiendo pero sin auth. Hay que manejar fallback (p.ej. login local). B casos supuestamente. Medio-bajo. Todo depende del proyecto SSO; si ese cae, todo falla. No hay fallback a menos que exista otro método de login en A/B. Media. El servicio auth es punto único de falla. Pero los proyectos A/B solo necesitan confirmar token. Se puede diseñar redundante (usar varios endpoints). Alta. Cada proyecto es independiente; si el proceso de sync falla, cada proyecto sigue funcionando con sus usuarios ya creados. (Solo la sincronía se rompe). Baja. Si el sistema de enlace falla, los usuarios aún pueden usar cada sistema por separado. No es un único punto de falla en todas las sesiones. Alta. IdP se asume robusto (podemos usar SLAs). Si el sync falla momentáneamente, cada proyecto mantiene su copia hasta resolver. El riesgo es menor.
Vendor lock-in Alto con IdP elegido (Auth0, Okta: licencias). Flexibilidad: Keycloak es Open Source. Supabase solo actúa de SP. Bajo. Todo es Supabase. Únicamente dependemos de Supabase y sus APIs. (Si se abandona Supabase, habría que rehacer). Bajo. Únicamente dependencia de bibliotecas de JWT/PW que use. Si se hace con Edge Functions y Supabase Admin, queda atado moderadamente a Supabase por la DB. Bajo. Solución propia. Usa API genéricos. Si dejamos de usar Supabase, cambiarían solo la capa de sync. Bajo. Desarrollo propio sencillo. No hay dependencia externa fuerte, más allá de usar Supabase. Medio-alto. Si se elige IdP específico (Okta/Azure), uno se ata a su ecosistema. SCIM como estándar ayuda, pero la herramienta de SCIM es el vendor.
Time-to-implement Largo. Configuración y pruebas de IdP+Supabase (varias semanas). + plan de contingencia. Muy largo. Todo el flujo a medida, pruebas de seguridad, manejo de tokens. Posiblemente meses. Muy largo. Construir un sistema auth completo es laborioso (pruebas de seguridad importantes). Medio. Diseñar la lógica de sync, triggers/webhooks, corregir problemas iniciales puede tomar semanas. Menos que un IdP pero no trivial. Corto-medio. Se inicia con login normal; luego se añade la capa de “vincular cuentas”. Desarrollo ad-hoc. Probablemente semanas. Largo. Integrar un IdP empresarial y SCIM suele tomar tiempo de configuración (meses). Requiere permisos/infraestructura extra.

Recomendación y plan de implementación
Opción principal: Proveedor de Identidad externo (OIDC/SAML). Este enfoque ofrece un SSO real con «una sola identidad lógica». Al usar un IdP consolidado (por ejemplo Keycloak autoalojado, o un servicio como Auth0/Okta), ambos proyectos de Supabase confiarán en el mismo origen de autenticación. Aunque implica trabajo inicial, resulta robusto, seguro y escalable. Recomendamos OIDC (OAuth2/OpenID Connect) para integración rápida o SAML si la organización ya usa Active Directory/Azure/OneLogin
. Se deben configurar ambas apps (A y B) en el IdP, y en Supabase habilitar el provider (en Social Auth) con el issuer y claves correspondientes. Así, el usuario inicia sesión una vez y obtiene tokens JWT/Assertion que funcionan en ambos. Ventajas: estándar probado, manejo central de usuarios/roles, mejor UX. Riesgo principal: dependencia del IdP (plan de respaldo con password local de ser necesario). Plan MVp: primero implementar con un IdP de prueba (p.ej. Keycloak básico), hacer login en A, luego en B usando mismo IdP, verificar RLS y roles. Luego endurecer con MFA o reglas de sesión, y preparar con SAML en caso de requerir integraciones corporativas.

Plan B: Sincronización mediante webhooks/cron. Como contingencia (por ejemplo, si no es posible introducir un IdP externo), sería la alternativa más controlada: mantener las tablas de usuarios paralelas sincronizadas. Esto permite conservar cada proyecto supabase independiente y solo agregar un “puente” de datos. Implica construir triggers o un microservicio que escuche inserciones/actualizaciones en auth.users de A y las replique en B (y viceversa). Es laborioso de implementar, pero evita vendor lock-in y no requiere costos de licencias. En MVP, se puede implementar primero la creación de usuario: por ejemplo, al registrar un usuario en A, automáticamente se crea en B con admin.createUser (replicando email, nickname, rol básico). Verificar entonces que el usuario sincronizado pueda iniciar en B con la misma contraseña (usar confirmación de email). Luego agregar sincronización de actualizaciones (p.ej. si cambian datos de perfil o roles en A, actualizarlos en B). Probablemente usar Supabase Edge Functions o un servicio en la nube para manejar la lógica. MVP: implementamos la sincronía de “alta usuario” entre A→B. Probamos que un usuario creado en A exista en B y pueda hacer login. En fase siguiente, agregar sincronía B→A y de cambios de perfil. Finalmente, roles y borrados. Sincronizar emails (confirmarlos), contraseñas hasheadas y email_confirmed puede necesitar mover hash (con backups) o iniciar workflow de cambio de contraseña en B.

Plan de implementación (fases):

MVP – Autenticación Básica / Login único: Configurar el IdP externo (p.ej. desplegar Keycloak con realm) y conectar Supabase A y B. Hacer pruebas básicas de login en A y luego en B para el mismo usuario. Implementar RLS simples por UUID local (en A y B tablas profiles vinculadas a auth.uid()). Checklist seguridad inicial: usar HTTPS, poner email_confirmed apropiadamente, revisar logs de login. Pruebas: login con cuentas válidas, rechazo de usuarios bloqueados en IdP, verificación de token JWT en ambos.

MVP alternativo (si no IdP): Escribir funciones trigger en DB A: AFTER INSERT/UPDATE en auth.users que llame un servicio para crear/actualizar en B con auth.admin.createUser. Validar en B que la cuenta existe y funciona. Hacer similar de B→A. Test de sincronización inicial, manejo de contraseñas (tal vez todos cambian su password al primer login con magic link). Chequear RLS local (cada proyecto como siempre).

Hardening – Roles y permisos: Definir cómo se manejan los roles: p.ej. usar claims del IdP (groups en Keycloak) y mapearlos a roles en DB de Supabase con RLS; o sincronizar manualmente tablas de roles. Implementar RLS avanzadas (por tenant o rol) y pruebas. Reforzar políticas de seguridad: CSRF, SSO logout (aunque no soportado SLO completo en Supabase
), caducidad de sesiones. Generar reportes de auditoría (Supabase Audit Logs).

Hardening – Resiliencia y monitoreo: Configurar mecanismos de recuperación: por ej. habilitar logins por correo en caso de que IdP caiga (configurar Identity Provider secundario o método de ingreso email/password). Establecer timeouts e inactividad (ej. token expiration short). Monitorear la sincronización (ej. logs de Edge Functions, alertas si falla). Realizar pruebas de penetración y unitarias en flujos de login y sincronización.

Despliegue y pruebas finales: Checklist de seguridad completo:

Revisar que todas las secretos/credentials (IdP client secrets, JWT secrets) estén en variables seguras y no versionadas.
Asegurar RLS: probar que datos de un usuario no accesan recursos de otro (cross-tenant).
Verificar manejo de sesiones: expiraciones, tokens revocados, roles invalidos.
Simular caídas: apagar IdP y ver comportamiento (¿se bloquea login o hay fallback?).
Prueba UX: usuarios que sólo usan A luego B (y viceversa) sin ver duplicados.
Chequear que no se duplique perfil (ver manual de Supabase SAML: dos cuentas con mismo email si no se tiene cuidado
).
Políticas de contraseña (seguridad de pass), CAPTCHA si procede para signup.
E2E tests para login SSO, linking de cuentas, RLS.
Al concluir, la recomendación es privilegiar la integración con IdP externo (por criterios de seguridad y UX) e implementar en paralelo el sincronizador de usuarios como fallback o complemento (por ejemplo, para pre-popular las bases de datos con los mismos usuarios). Esto proporciona redundancia: si el IdP falla, al menos las copias locales siguen válidas por sesiones existentes. En todo caso, documentar los flujos y formar al equipo de DevOps/Seguridad sobre los nuevos componentes (IdP, procesos de sincronización).

Fuentes: La documentación oficial de Supabase confirma la viabilidad de SSO empresarial y la necesidad de manejar manualmente la vinculación de identidades
. Asimismo, en GitHub se sugiere usar el mismo JWT secret en múltiples proyectos para federar sesiones
. La estrategia se basa en estándares (OIDC/SAML, SCIM) y en capacidades descritas por Supabase
.
