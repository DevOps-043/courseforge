import{ Handler }from'@netlify/functions'

import{ GoogleGenerativeAI,GenerateContentResult }from'@google/generative-ai'

import{ createClient }from'@supabase/supabase-js'

// --- TIPOS ---

interfaceLessonInput{

id:string

title:string

objective_specific:string

module_id:string

module_title:string

module_index:number

}

interfaceSyllabusModule{

id:string

title:string

objective_general:string

lessons:{

    id:string

    title:string

    objective_specific:string

}[]

}

interfacePlanComponent{

type:string

summary:string

notes?:string

}

interfaceLessonPlan{

lesson_id:string

lesson_title:string

lesson_order?:number

module_id:string

module_title:string

module_index:number

oa_text:string

oa_bloom_verb?:string

measurable_criteria?:string

course_type_detected?:string

components:PlanComponent[]

alignment_notes?:string

}

interfaceGeneratedPlan{

lesson_plans:LessonPlan[]

blockers:any[]

}

interfaceBackgroundPayload{

artifactId:string

modules:SyllabusModule[]

courseName:string

ideaCentral:string

promptVersion:'system'|'custom'

customPrompt?:string

iterationCount:number

}

// --- CONFIGURACIÓN ---

// Usar la variable de entorno GEMINI_MODEL existente

constGEMINI_MODEL=process.env.GEMINI_MODEL||'gemini-2.5-flash'

constGOOGLE_API_KEY=process.env.GOOGLE_API_KEY

constSUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL

constSUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ROLE_KEY

constREQUIRED_COMPONENTS=['DIALOGUE','READING','QUIZ','VIDEO_THEORETICAL']

// --- PROMPT DEL SISTEMA ---

// --- FUNCIONES DE UTILIDAD PARA PROMPTS ---

import\*asfsfrom'fs'

import\*aspathfrom'path'

functiongetSystemPrompt(

lessonsText:string,

courseName:string,

ideaCentral:string,

lessonCount:number

):string{

try {

    // Intentar leer el archivo desde varias ubicaciones posibles (local vs netlify lambda)

    // En Netlify, included_files suele poner los archivos en la raíz o relativos a la función

    constpossiblePaths= [

    path.resolve('./src/prompts/instructional-plan.prompts.md'),

    path.resolve(__dirname,'../../src/prompts/instructional-plan.prompts.md'),

    path.resolve(process.cwd(),'src/prompts/instructional-plan.prompts.md') // Más común en Lambda

    ]

    letpromptContent=''

    for (constpofpossiblePaths) {

    if (fs.existsSync(p)) {

    console.log(`[BG-PLAN] Leyendo prompt desde: ${p}`)

    promptContent=fs.readFileSync(p,'utf-8')

    break

    }

    }

    if (!promptContent) {

    console.warn('[BG-PLAN] ⚠️ No se encontró el archivo de prompt MD, usando fallback hardcodeado')

    // Fallback si falla la lectura del archivo (para robustez)

    returngetFallbackPrompt(lessonsText,courseName,ideaCentral,lessonCount)

    }

    // Reemplazar placeholders

    returnpromptContent

    .replace(/\{\{COURSE_NAME\}\}/g,courseName)

    .replace(/\{\{IDEA_CENTRAL\}\}/g,ideaCentral)

    .replace(/\{\{LESSONS_TEXT\}\}/g,lessonsText)

    .replace(/\{\{LESSON_COUNT\}\}/g,String(lessonCount))

} catch (error) {

    console.error('[BG-PLAN] Error leyendo archivo de prompt:',error)

    returngetFallbackPrompt(lessonsText,courseName,ideaCentral,lessonCount)

}

}

functiongetFallbackPrompt(

lessonsText:string,

courseName:string,

ideaCentral:string,

lessonCount:number

):string{

return`PROMPT — Plan Instruccional Detallado para Microlearning (FALLBACK)

Actúa como diseñador instruccional senior experto en cursos de e-learning corporativo.

═══════════════════════════════════════════════════════════════

    CONTEXTO DEL CURSO

═══════════════════════════════════════════════════════════════

CURSO: ${courseName}

IDEA CENTRAL: ${ideaCentral}

LECCIONES A PLANIFICAR (${lessonCount} lecciones):

${lessonsText}

═══════════════════════════════════════════════════════════════

    🎯 MISIÓN: CREAR PLAN DETALLADO DE CALIDAD

═══════════════════════════════════════════════════════════════

Genera un plan instruccional DETALLADO y ESPECÍFICO para cada lección.

Cada descripción de componente debe ser RICA EN CONTENIDO, no genérica.

═══════════════════════════════════════════════════════════════

    ⚠️ CALIDAD DE DESCRIPCIONES - MUY IMPORTANTE

═══════════════════════════════════════════════════════════════

CADA descripción de componente DEBE:

- Tener MÍNIMO 2-3 oraciones detalladas
- Ser ESPECÍFICA al tema de la lección
- Mencionar conceptos, ejemplos o situaciones concretas
- Incluir duración o extensión aproximada

❌ MALO (genérico):

"Debate sobre el liderazgo y por qué es importante (7 min)."

✅ BUENO (específico y detallado):

"Conversación con Lia sobre por qué tendemos a leer mensajes neutrales con un tono negativo en Slack o Teams. Se introduce el concepto de 'negativity bias' y el impacto de la ausencia de lenguaje corporal en entornos remotos. Incluye ejemplos de malinterpretaciones comunes en emails corporativos (6-8 min)."

❌ MALO (genérico):

"Lectura sobre comunicación (~750 palabras)."

✅ BUENO (específico y detallado):

"Lectura profunda sobre la psicología de la comunicación mediada por computadora. Explica el efecto de desinhibición online y el sesgo de negatividad. Incluye ejemplos comparativos de mensajes ambiguos y su interpretación según el contexto (~750 palabras)."

═══════════════════════════════════════════════════════════════

    🔍 ANÁLISIS: TIPO DE CURSO

═══════════════════════════════════════════════════════════════

ANALIZA el curso para determinar si es:

📘 TEÓRICO/CONCEPTUAL (Liderazgo, Comunicación, Estrategia, Ética):

→ VIDEO_THEORETICAL es suficiente

→ NO incluir VIDEO_DEMO ni DEMO_GUIDE

→ EXERCISE = casos de estudio, reflexiones, análisis de escenarios

📗 PROCEDIMENTAL/TÉCNICO (Excel, Power BI, Programación, SAP):

→ VIDEO_DEMO o VIDEO_GUIDE son necesarios

→ DEMO_GUIDE para guiar práctica paso a paso

→ EXERCISE = práctico en la herramienta

═══════════════════════════════════════════════════════════════

    📋 COMPONENTES POR LECCIÓN

═══════════════════════════════════════════════════════════════

OBLIGATORIOS (siempre incluir):

✅ DIALOGUE - Diálogo instructivo con Lia (5-9 min)

→ Conversación que introduce conceptos, hace preguntas reflexivas

→ Describe: tema específico, conceptos a introducir, enfoque pedagógico

✅ READING - Material de lectura (~750 palabras)

→ Texto que profundiza en el tema con explicaciones y ejemplos

→ Describe: temas cubiertos, tipo de contenido, ejemplos incluidos

✅ QUIZ - Cuestionario final (3-5 preguntas, 80% para aprobar)

→ Evaluación de comprensión

→ Describe: tipo de preguntas, escenarios evaluados

✅ VIDEO (al menos 1 tipo):

- VIDEO_THEORETICAL: Explicación conceptual (6-12 min)
- VIDEO_DEMO: Demostración práctica en software (solo si aplica)
- VIDEO_GUIDE: Tutorial paso a paso (solo si aplica)

OPCIONALES (solo si aplican):

⚠️ EXERCISE - Ejercicio práctico o caso de estudio

⚠️ DEMO_GUIDE - Solo para cursos técnicos con herramientas

═══════════════════════════════════════════════════════════════

    📝 FORMATO JSON REQUERIDO

═══════════════════════════════════════════════════════════════

{

"lesson_plans": [

    {

    "lesson_id": "ID exacto de la lección (del input)",

    "lesson_title": "Título exacto de la lección",

    "lesson_order": 1,

    "module_id": "ID del módulo",

    "module_title": "Título del módulo",

    "module_index": 0,

    "oa_text": "El participante será capaz de [VERBO BLOOM] [contenido específico] mediante [método/criterio de evaluación]",

    "oa_bloom_verb": "Verbo Bloom (Recordar, Comprender, Aplicar, Analizar, Evaluar, Crear)",

    "measurable_criteria": "Criterio medible específico (ej: identificar 4 de 5 casos correctamente en el quiz final)",

    "course_type_detected": "TEORICO",

    "components": [

    {

    "type": "DIALOGUE",

    "summary": "Conversación con Lia sobre [TEMA ESPECÍFICO]. Se explora [CONCEPTO 1] y [CONCEPTO 2]. El estudiante reflexiona sobre [ASPECTO CLAVE] mediante preguntas guiadas. Duración: 6-8 minutos."

    },

    {

    "type": "READING",

    "summary": "Lectura profunda sobre [TEMA]. Cubre: [SUBTEMA 1], [SUBTEMA 2], y [SUBTEMA 3]. Incluye ejemplos de [CONTEXTO REAL] y casos comparativos. Extensión: ~750 palabras."

    },

    {

    "type": "VIDEO_THEORETICAL",

    "summary": "Video explicativo donde el instructor presenta [TEMA CENTRAL]. Incluye: definición de [CONCEPTO], ejemplos de [CONTEXTO], y reflexión sobre [APLICACIÓN]. Duración: 8-10 minutos."

    },

    {

    "type": "QUIZ",

    "summary": "Evaluación con 4 preguntas de opción múltiple basadas en [ESCENARIOS]. Evalúa comprensión de [CONCEPTO 1] y [CONCEPTO 2]. Requiere 80% para aprobar. Feedback inmediato sobre cada respuesta."

    }

    ],

    "alignment_notes": "Justificación de por qué estos componentes son adecuados para el nivel Bloom y tipo de curso."

    }

],

"blockers": []

}

═══════════════════════════════════════════════════════════════

    ⚠️ REGLAS CRÍTICAS

═══════════════════════════════════════════════════════════════

1. GENERAR EXACTAMENTE ${lessonCount} lesson_plans
2. lesson_id: EXACTAMENTE igual al ID recibido en el input
3. lesson_order: Número secuencial (1, 2, 3...) respetando el orden del input
4. CALIDAD: Cada summary de componente debe tener 2-3 oraciones MÍNIMO
5. ESPECIFICIDAD: Mencionar conceptos, ejemplos y contextos del tema
6. NO ser genérico: Evitar frases como "lectura sobre el tema" o "video explicativo"
7. oa_text: Mínimo 60 caracteres, con verbo Bloom explícito
8. Para cursos de liderazgo/comunicación: NO incluir VIDEO_DEMO ni DEMO_GUIDE
9. Responder SOLO con JSON válido

Responde ÚNICAMENTE con el JSON.`

}

// --- HANDLER PRINCIPAL ---

exportconsthandler:Handler=async(event)=>{

// Solo POST

if (event.httpMethod!=='POST') {

    return { statusCode:405,body:'Method Not Allowed' }

}

// Verificar configuración

if (!GOOGLE_API_KEY||!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY) {

    console.error('[BG-PLAN] Falta configuración de entorno')

    return { statusCode:500,body:'Missing env configuration' }

}

try {

    constpayload=JSON.parse(event.body||'{}') asBackgroundPayload

    const{artifactId,modules,courseName,ideaCentral,promptVersion,customPrompt,iterationCount}=payload

    if (!artifactId||!modules||modules.length===0) {

    return { statusCode:400,body:'Missing required payload data' }

    }

    console.log(`[BG-PLAN] Iniciando generación background para: ${artifactId}`)

    console.log(`[BG-PLAN] Modelo: ${GEMINI_MODEL}`)

    console.log(`[BG-PLAN] Módulos: ${modules.length}`)

    // Inicializar Supabase con Service Role Key

    constsupabase=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY, {

    auth: {

    persistSession:false,

    autoRefreshToken:false,

    }

    })

    // Registrar inicio

    awaitsupabase.from('pipeline_events').insert({

    artifact_id:artifactId,

    step_id:'ESP-03',

    event_type:'BACKGROUND_STARTED',

    event_data: { model:GEMINI_MODEL,modulesCount:modules.length }

    })

    // Preparar lecciones

    constlessons:LessonInput[] = []

    for (letmoduleIndex=0;moduleIndex<modules.length;moduleIndex++) {

    constmod=modules[moduleIndex]

    for (constlessonofmod.lessons|| []) {

    lessons.push({

    id:lesson.id,

    title:lesson.title,

    objective_specific:lesson.objective_specific,

    module_id:mod.id,

    module_title:mod.title,

    module_index:moduleIndex

    })

    }

    }

    console.log(`[BG-PLAN] Total lecciones: ${lessons.length}`)

    // Inicializar Gemini

    constgenAI=newGoogleGenerativeAI(GOOGLE_API_KEY)

    constmodel=genAI.getGenerativeModel({

    model:GEMINI_MODEL,

    generationConfig: {

    temperature:parseFloat(process.env.GEMINI_TEMPERATURE||'0.7')

    }

    })

    // Preparar texto de lecciones

    constlessonsText=lessons.map((l,i) =>

    `${i+1}. ID: ${l.id}\n   Módulo: ${l.module_title}\n   Lección: ${l.title}\n   OA Original: ${l.objective_specific}`

    ).join('\n\n')

    // Generar prompt

    letprompt:string

    if (promptVersion==='custom'&&customPrompt) {

    // Inyectar contexto en prompt personalizado

    prompt=customPrompt

    .replace(/\{\{COURSE_NAME\}\}|\$\{courseName\}/gi,courseName)

    .replace(/\{\{IDEA_CENTRAL\}\}|\$\{ideaCentral\}/gi,ideaCentral)

    .replace(/\{\{LESSONS_TEXT\}\}|\$\{lessonsText\}/gi,lessonsText)

    .replace(/\{\{LESSON_COUNT\}\}|\$\{lessonCount\}/gi,String(lessons.length))

    } else {

    prompt=getSystemPrompt(lessonsText,courseName,ideaCentral,lessons.length)

    }

    console.log(`[BG-PLAN] Llamando a Gemini (${GEMINI_MODEL})...`)

    // Generar contenido

    constresult=awaitmodel.generateContent(prompt) asGenerateContentResult

    constresponse=result.response.text()

    if (!response||response.trim().length===0) {

    thrownewError('Respuesta vacía de Gemini')

    }

    console.log('[BG-PLAN] Respuesta recibida, parseando JSON...')

    // Limpiar y parsear JSON

    letcleanJson=response

    .replace(/```json\n?/g,'')

    .replace(/```\n?/g,'')

    .trim()

    // Extraer JSON

    constjsonMatch=cleanJson.match(/\{[\s\S]*\}/m)

    if (jsonMatch) {

    cleanJson=jsonMatch[0]

    }

    letparsed:GeneratedPlan

    try {

    parsed=JSON.parse(cleanJson)

    } catch (parseError:any) {

    console.error('[BG-PLAN] Error parseando JSON:',parseError.message)

    console.error('[BG-PLAN] Primeros 500 chars:',cleanJson.substring(0,500))

    thrownewError(`Error parseando JSON: ${parseError.message}`)

    }

    if (!parsed||!Array.isArray(parsed.lesson_plans)) {

    thrownewError('Respuesta no contiene lesson_plans válido')

    }

    console.log(`[BG-PLAN] Planes parseados: ${parsed.lesson_plans.length}`)

    // Enriquecer con module_id, module_title, module_index

    constlessonLookup=newMap<string,LessonInput>()

    for (constlessonoflessons) {

    lessonLookup.set(lesson.id,lesson)

    }

    constenrichedPlans=parsed.lesson_plans.map((plan,idx) => {

    constoriginal=lessonLookup.get(plan.lesson_id)

    // Calcular el orden original basándose en la posición en el array de lessons

    constoriginalIndex=lessons.findIndex(l=>l.id===plan.lesson_id)

    return {

    ...plan,

    module_id:original?.module_id||plan.module_id,

    module_title:original?.module_title||plan.module_title,

    module_index:original?.module_index??plan.module_index??999,

    // Usar lesson_order de Gemini, o el índice original, o el índice en el array parseado

    lesson_order:plan.lesson_order??originalIndex??idx,

    components:plan.components||REQUIRED_COMPONENTS.map(type=> ({

    type,

    summary:`${type} pendiente de generación`

    }))

    }

    })

    // Ordenar por módulo primero, luego por lesson_order dentro del módulo

    enrichedPlans.sort((a,b) => {

    // Primero por módulo

    if (a.module_index!==b.module_index) {

    returna.module_index-b.module_index

    }

    // Luego por lesson_order (numérico)

    return (a.lesson_order??999) - (b.lesson_order??999)

    })

    // Generar DoD

    constdod= {

    checklist: [

    { code:'DOD_A',pass:enrichedPlans.length===lessons.length,evidence:`${enrichedPlans.length}/${lessons.length} lecciones` },

    { code:'DOD_B',pass:enrichedPlans.every(p=>p.oa_text?.length>=50),evidence:'OA con verbos Bloom' },

    { code:'DOD_C',pass:enrichedPlans.every(p=>p.components?.length>=3),evidence:'Componentes obligatorios' },

    { code:'DOD_D',pass:true,evidence:'Sin bloqueadores críticos' }

    ],

    automatic_checks: [],

    semantic_checks: []

    }

    // Determinar estado final

    constallPassed=dod.checklist.every(c=>c.pass)

    constfinalState=allPassed?'STEP_READY_FOR_REVIEW': (iterationCount>=2?'STEP_ESCALATED':'STEP_READY_FOR_REVIEW')

    // Actualizar en Supabase

    const{error:updateError}=awaitsupabase

    .from('instructional_plans')

    .update({

    lesson_plans:enrichedPlans,

    blockers:parsed.blockers|| [],

    dod,

    state:finalState

    })

    .eq('artifact_id',artifactId)

    if (updateError) {

    console.error('[BG-PLAN] Error actualizando plan:',updateError)

    throwupdateError

    }

    // Registrar éxito

    awaitsupabase.from('pipeline_events').insert({

    artifact_id:artifactId,

    step_id:'ESP-03',

    event_type:'BACKGROUND_COMPLETED',

    event_data: {

    lessonsGenerated:enrichedPlans.length,

    blockersCount:parsed.blockers?.length||0,

    finalState

    }

    })

    console.log(`[BG-PLAN] ✅ Completado exitosamente. Estado: ${finalState}`)

    return {

    statusCode:200,

    body:JSON.stringify({

    success:true,

    lessonsGenerated:enrichedPlans.length,

    state:finalState

    })

    }

} catch (error:any) {

    console.error('[BG-PLAN] ❌ Error:',error.message)

    // Intentar marcar como escalado

    try {

    if (!SUPABASE_SERVICE_ROLE_KEY) thrownewError('No service key')

    constsupabase=createClient(SUPABASE_URL!,SUPABASE_SERVICE_ROLE_KEY, {

    auth: { persistSession:false,autoRefreshToken:false }

    })

    constpayload=JSON.parse(event.body||'{}') asBackgroundPayload

    awaitsupabase

    .from('instructional_plans')

    .update({ state:'STEP_ESCALATED' })

    .eq('artifact_id',payload.artifactId)

    awaitsupabase.from('pipeline_events').insert({

    artifact_id:payload.artifactId,

    step_id:'ESP-03',

    event_type:'BACKGROUND_ERROR',

    event_data: { error:error.message }

    })

    } catch (e) {

    console.error('[BG-PLAN] Error registrando fallo:',e)

    }

    return {

    statusCode:500,

    body:JSON.stringify({ success:false,error:error.message })

    }

}

}
