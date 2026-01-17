import { SyllabusModule, ValidationCheck } from "../types/syllabus.types";
import { COURSE_CONFIG } from "../config/syllabus.config";

export interface ValidationResult {
  passed: boolean;
  checks: ValidationCheck[];
}

// V01: Paridad Módulos vs Objetivos
export function validateModulesParity(modules: SyllabusModule[], objetivos: string[]): ValidationCheck {
  const modCount = modules.length;
  const objCount = objetivos?.length || 0;
  // Regla laxa aceptable: Igualdad o al menos cubrir el mínimo.
  // Según captura usuario: "5 modulos pero 4 objetivos generales" es ERROR.
  // Asumimos igualdad estricta esperada por ahora.
  const pass = objCount > 0 ? modCount === objCount : modCount >= 3;

  return {
    code: "[V01]",
    pass,
    message: pass
      ? `${modCount} modulos coinciden con ${objCount} objetivos generales`
      : `Error: ${modCount} modulos pero ${objCount} objetivos generales`,
    observed: modCount
  };
}

// V02: Rango Lecciones
export function validateLessonsRange(modules: SyllabusModule[]): ValidationCheck {
  const invalidModules = modules.filter(m => 
    m.lessons.length < 3 || m.lessons.length > 6
  );
  
  return {
    code: "[V02]",
    pass: invalidModules.length === 0,
    message: invalidModules.length === 0
      ? "Todos los modulos tienen entre 3 y 6 lecciones"
      : `Hay modulos con cantidad incorrecta de lecciones (se permiten 3-6)`,
    observed: invalidModules.length
  };
}

// V03: Calidad Objetivos
export function validateObjectivesQuality(modules: SyllabusModule[]): ValidationCheck {
  let issues = 0;
  modules.forEach(m => {
    m.lessons.forEach(l => {
      if (!l.objective_specific || l.objective_specific.length < 10) issues++;
    });
  });

  return {
    code: "[V03]",
    pass: issues === 0,
    message: issues === 0
      ? "Todas las lecciones tienen objetivos especificos validos"
      : "Se detectaron lecciones con objetivos invalidos o vacios",
    observed: issues
  };
}

// V04: Duplicados
export function validateNoDuplicates(modules: SyllabusModule[]): ValidationCheck {
  const titles = new Set<string>();
  let dups = 0;
  modules.forEach(m => {
    m.lessons.forEach(l => {
      const t = l.title.toLowerCase().trim();
      if (titles.has(t)) dups++;
      else titles.add(t);
    });
  });

  return {
    code: "[V04]",
    pass: dups === 0,
    message: dups === 0
      ? "No se encontraron duplicados"
      : `Se encontraron ${dups} titulos duplicados`,
    observed: dups
  };
}

// V05: Integridad Estructural (Dummy check final)
export function validateStructure(modules: SyllabusModule[]): ValidationCheck {
  const pass = modules.length > 0 && modules.every(m => m.title && m.lessons);
  return {
    code: "[V05]",
    pass,
    message: pass 
      ? "Estructura del temario completa" 
      : "Error en la estructura del JSON del temario",
    observed: pass
  };
}

// Lista de verbos Bloom expandida y verbos de acción técnica/gestión comunes
const BLOOM_VERBS = new Set([
  // Infinitivos
  "definir", "describir", "identificar", "listar", "nombrar", "reconocer", "recordar", "relatar", "repetir", "reproducir",
  "clasificar", "comparar", "discutir", "explicar", "expresar", "indicar", "ubicar", "reportar", "interpretar",
  "aplicar", "esbozar", "dramatizar", "emplear", "ilustrar", "operar", "practicar", "programar", "usar", "demostrar",
  "analizar", "calcular", "categorizar", "criticar", "diferenciar", "discriminar", "distinguir", "examinar", "experimentar", "probar",
  "argumentar", "evaluar", "juzgar", "seleccionar", "valorar", "defender", "apoyar",
  "crear", "diseñar", "construir", "proponer", "planear", "desarrollar", "formular", "integrar", "organizar", "escribir",
  // Verbos de Gestión / Técnicos comunes
  "implementar", "ejecutar", "gestionar", "administrar", "configurar", "optimizar", "monitorear", "auditar", "diagnosticar",
  "liderar", "coordinar", "facilitar", "negociar", "resolver", "tomar", "fomentar", "impulsar", "alinear", "establecer",
  "detectar", "mitigar", "prevenir", "asegurar", "garantizar", "validar", "verificar", "controlar", "supervisar",
  "fortalecer", "mejorar", "innovar", "transformar", "adaptar", "personalizar", "estructurar", "comprender",
  // Conjugados 3ra persona (algunos modelos devuelven "El alumno analiza...")
  "analiza", "evalua", "crea", "diseña", "identifica", "enumera", "describe", "aplica", "comprende", "define", "implementa"
]);

// V06: Duración Total <= 12 horas
export function validateCourseDuration(modules: SyllabusModule[]): ValidationCheck {
  let totalMinutes = 0;
  let missingEstimates = false;

  modules.forEach(m => {
    m.lessons.forEach(l => {
      if (typeof l.estimated_minutes === 'number' && l.estimated_minutes > 0) {
        totalMinutes += l.estimated_minutes;
      } else {
        missingEstimates = true;
      }
    });
  });
  
  // Si no hay ninguna estimación (total 0), es un error de integridad de datos.
  if (totalMinutes === 0) {
     return {
         code: "[V06]",
         pass: false,
         message: "No se encontraron estimaciones de tiempo en el temario generado.",
         observed: 0
     };
  }

  const totalHours = totalMinutes / 60;
  const pass = totalHours <= 12;

  const hoursDisplay = Math.round(totalHours * 10) / 10;
  
  let message = pass
       ? `Duración estimada (${hoursDisplay}h) dentro del límite de 12h`
       : `La duración total (${hoursDisplay}h) excede el máximo de 12h`;

  if (missingEstimates) {
      message += " (Algunas lecciones no tienen duración asignada, cálculo parcial)";
  }

  return {
    code: "[V06]",
    pass,
    message,
    observed: totalHours
  };
}

// V07: Verbos Bloom (Estricto pero Ampliado)
export function validateBloomVerbs(modules: SyllabusModule[]): ValidationCheck {
  let invalidCount = 0;
  const invalidExamples: string[] = [];

  modules.forEach(m => {
    m.lessons.forEach(l => {
      // Tomar primera palabra, limpiar caracteres de puntuación
      const cleanObjective = l.objective_specific?.trim();
      if (!cleanObjective) return;

      // Detectar "El participante sera capaz de..."
      // Muchos objetivos empiezan con esa frase. Debemos buscar el verbo DESPUÉS de eso.
      // O tomar la primera palabra si es directo "Analizar..."
      
      let verbCandidate = cleanObjective.split(' ')[0].toLowerCase().replace(/[.,;:]/g, '');

      // Manejo de prefijos comunes
      const lowerObj = cleanObjective.toLowerCase();
      if (lowerObj.startsWith("el participante será capaz de") || lowerObj.startsWith("al finalizar la lección")) {
          // Intentar extraer el siguiente verbo
          // Esto es complejo sin NLP, pero asumimos que el modelo sigue prompt.
          // El prompt pide: "El participante será capaz de [verbo]..."
          // Entonces el verbo es la palabra 6 (si contamos 'El' 'participante' 'sera' 'capaz' 'de')
          // "El participante será capaz de ANALIZAR..."
          const parts = lowerObj.split(' ');
          const deIndex = parts.indexOf('de');
          if (deIndex !== -1 && deIndex < parts.length - 1) {
              verbCandidate = parts[deIndex + 1].replace(/[.,;:]/g, '');
          }
      }

      if (!BLOOM_VERBS.has(verbCandidate)) {
           // Chequeo laxo: si termina en 'ar', 'er', 'ir' puede ser verbo aunque no esté en lista
           const esVerboInfinitivo = verbCandidate.endsWith('ar') || verbCandidate.endsWith('er') || verbCandidate.endsWith('ir');
           
           if (!esVerboInfinitivo) {
               invalidCount++;
               if (invalidExamples.length < 3) invalidExamples.push(verbCandidate);
           }
      }
    });
  });

  return {
    code: "[V07]",
    pass: invalidCount === 0,
    message: invalidCount === 0
      ? "Todos los objetivos inician con verbos de acción válidos"
      : `Se detectaron ${invalidCount} objetivos sin verbo de acción claro (ej: ${invalidExamples.join(', ')})`,
    observed: invalidCount
  };
}

export function runAllValidations(modules: SyllabusModule[], objetivos?: string[]): ValidationResult {
  const safeObjetivos = objetivos || []; 
  
  const checks = [
    validateModulesParity(modules, safeObjetivos),
    validateLessonsRange(modules),
    validateObjectivesQuality(modules),
    validateNoDuplicates(modules),
    validateStructure(modules),
    validateCourseDuration(modules),
    validateBloomVerbs(modules)
  ];

  return {
    passed: checks.every(c => c.pass),
    checks
  };
}
