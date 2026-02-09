
// Mocking the input data from the user
const inputData = {
    "items": [
        {
            "id": "q1_pilares_ia",
            "type": "MULTIPLE_CHOICE",
            "options": [
                "La disponibilidad de grandes volúmenes de datos (Big Data).",
                "El desarrollo de la computación cuántica.",
                "El avance en el poder de cómputo paralelo (GPUs).",
                "La madurez de algoritmos como la retropropagación."
            ],
            "question": "¿Cuál de los siguientes NO es considerado uno de los tres pilares principales que impulsaron el renacimiento del Deep Learning en la última década?",
            "difficulty": "EASY",
            "bloom_level": "REMEMBER",
            "explanation": "La respuesta correcta es 'El desarrollo de la computación cuántica'. Aunque es un campo prometedor, no fue un motor del auge del Deep Learning en la década de 2010. Los verdaderos pilares fueron la disponibilidad masiva de datos (Big Data), la potencia de cómputo paralelo de las GPUs y la aplicación a gran escala de algoritmos ya existentes como la retropropagación.",
            "correct_answer": 1
        },
        {
            "id": "q2_algoritmos_antiguos",
            "type": "TRUE_FALSE",
            "options": [
                "Verdadero",
                "Falso"
            ],
            "question": "Verdadero o Falso: Los algoritmos de redes neuronales profundas, como la retropropagación, fueron inventados completamente desde cero alrededor del año 2012.",
            "difficulty": "MEDIUM",
            "bloom_level": "UNDERSTAND",
            "explanation": "La afirmación es Falsa. Muchos algoritmos fundamentales como la retropropagación existían desde décadas antes (los 70 y 80), pero eran computacionalmente inviables para problemas complejos. El 'renacimiento' de la IA consistió en aplicar estos algoritmos probados a una escala masiva, gracias a la disponibilidad de más datos y mayor poder de cómputo.",
            "correct_answer": "Falso"
        },
        {
            "id": "q3_rol_gpu",
            "type": "MULTIPLE_CHOICE",
            "options": [
                "Porque consumen menos energía que las CPUs.",
                "Porque fueron diseñadas específicamente para ejecutar algoritmos de IA desde el principio.",
                "Porque su arquitectura permite realizar miles de cálculos simples en paralelo, acelerando el entrenamiento de redes neuronales.",
                "Porque son más baratas de producir que cualquier otro tipo de chip."
            ],
            "question": "¿Por qué las GPUs (Unidades de Procesamiento Gráfico) fueron tan cruciales para el avance del Deep Learning?",
            "difficulty": "MEDIUM",
            "bloom_level": "UNDERSTAND",
            "explanation": "La respuesta correcta es la tercera opción. La principal ventaja de las GPUs es su arquitectura masivamente paralela, diseñada para renderizar gráficos, que se adaptó perfectamente a las operaciones matriciales de las redes neuronales. Las otras opciones son incorrectas: no necesariamente consumen menos energía, no fueron diseñadas originalmente para IA y su costo no es el factor determinante.",
            "correct_answer": 2
        },
        {
            "id": "q4_alexnet_imagenet",
            "type": "TRUE_FALSE",
            "options": [
                "Verdadero",
                "Falso"
            ],
            "question": "Verdadero o Falso: El evento clave que demostró la superioridad del Deep Learning en el reconocimiento de imágenes a gran escala fue la victoria del modelo AlexNet en el desafío ImageNet de 2012.",
            "difficulty": "HARD",
            "bloom_level": "REMEMBER",
            "explanation": "La afirmación es Verdadera. El rendimiento de AlexNet en la competencia ImageNet de 2012 fue un momento decisivo. Su drástica reducción de la tasa de error en comparación con los métodos tradicionales convenció a gran parte de la comunidad científica y tecnológica del inmenso potencial del Deep Learning cuando se combina con big data y GPUs.",
            "correct_answer": "Verdadero"
        }
    ],
    "title": "Comprobando tu Comprensión: La Era del Deep Learning",
    "instructions": "Responde las siguientes 4 preguntas para validar tu comprensión sobre los factores que impulsaron el renacimiento de la IA. Necesitas un 80% para aprobar.",
    "passing_score": 80
};

// Current implementation from actions.ts
function transformQuizContent(content: any) {
    if (!content) return {};

    // Normalize questions
    const questions = Array.isArray(content.questions)
        ? content.questions.map((q: any) => ({
            id: q.id,
            question: q.question,
            // Map snake_case to camelCase
            questionType: q.questionType || q.question_type || 'multiple_choice',
            options: q.options || [],
            correctAnswer: q.correctAnswer || q.correct_answer || '',
            explanation: q.explanation || '',
            points: q.points || 10
        }))
        : [];

    return {
        passing_score: content.passing_score || 80,
        totalPoints: content.totalPoints || content.total_points || 100, // spec says totalPoints in camelCase example
        questions: questions
    };
}

const result = transformQuizContent(inputData);
console.log(JSON.stringify(result, null, 2));
