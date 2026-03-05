import React from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidad | SOFLIA Generating Sources Assistant",
  description: "Política de privacidad para el SOFLIA Generating Sources Assistant GPT.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 dark:bg-gray-900">
      <div className="max-w-3xl mx-auto bg-white p-8 rounded-xl shadow-sm dark:bg-gray-800 dark:text-gray-200">
        <h1 className="text-3xl font-bold mb-8 text-gray-900 dark:text-white">
          Políticas de SOFLIA Generating Sources Assistant
        </h1>

        <div className="space-y-8 text-gray-700 dark:text-gray-300">
          <section>
            <h2 className="text-xl font-semibold mb-3 text-gray-900 dark:text-white">
              1. Introducción
            </h2>
            <p>
              Este GPT, llamado <strong>SOFLIA Generating Sources Assistant</strong>, es un asistente de IA especializado en buscar fuentes bibliográficas de alta calidad para talleres educativos. Ayuda a instructores y diseñadores instruccionales a encontrar recursos confiables que respalden el contenido de sus cursos. Funciona mediante la tecnología de ChatGPT de OpenAI.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-gray-900 dark:text-white">
              2. Uso de OpenAI y ChatGPT
            </h2>
            <p>
              Todos los mensajes, archivos y búsquedas que envíe a este GPT se procesan exclusivamente en la plataforma de OpenAI. Este GPT <strong>no almacena</strong> de forma independiente la información que usted ingresa en sus chats fuera del entorno seguro de ChatGPT.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-gray-900 dark:text-white">
              3. Información que NO recopilamos
            </h2>
            <p>
              <strong>No solicitamos ni almacenamos datos personales</strong> (por ejemplo: nombres, direcciones, contraseñas, datos de salud o financieros). No utilizamos cookies, píxeles ni otras tecnologías de rastreo dentro de las conversaciones del GPT. Asimismo, el GPT está instruido específicamente para rechazar cualquier interacción que solicite autenticación, pagos o suscripciones.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-gray-900 dark:text-white">
              4. Transferencia de Fuentes al Taller (CourseForge)
            </h2>
            <p>
              Una vez que el usuario valida y confirma las fuentes bibliográficas encontradas, el GPT cuenta con una acción específica que permite el envío de esta información validada hacia la API de la plataforma <strong>CourseForge</strong> <code>(soflia-coursegen.netlify.app/api/gpt/sources)</code>. 
              <br/><br/>
              Durante este proceso <strong>únicamente</strong> se transfiere:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>El ID del artefacto interactuado (curso/taller).</li>
              <li>Las URL de las fuentes seleccionadas y validadas pertinentes al taller.</li>
              <li>Títulos, tipos y breves resúmenes públicos de dichas fuentes.</li>
            </ul>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Esta transferencia es opcional (requiere su confirmación en el chat) y no contiene datos que le identifiquen personalmente de su cuenta de origen en ChatGPT.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-gray-900 dark:text-white">
              5. Datos y Retención en OpenAI
            </h2>
            <p>
              Según las políticas de operación proporcionadas por OpenAI, los archivos o datos que cargue al chat del asistente se conservan en su historial <strong>hasta que usted los elimine</strong>. Según las políticas de OpenAI, si llegáramos a eliminar el GPT por completo de la tienda, los archivos asociados en la base de conocimiento interna serán eliminados dentro de 30 días.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-gray-900 dark:text-white">
              6. Seguridad
            </h2>
            <p>
              Esta herramienta utiliza la infraestructura segura de OpenAI para proteger los textos de entrada en sus servidores. Usted, como usuario, es el responsable de mantener la seguridad, privacidad y acceso a su cuenta de usuario en ChatGPT.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-gray-900 dark:text-white">
              7. Uso previsto y Exenciones de Responsabilidad
            </h2>
            <p>
              Este GPT está destinado exclusivamente a la investigación educativa y formación (búsqueda de fuentes públicas y gratuitas). Los resultados generados provienen de un modelo de lenguaje autónomo y de fuentes extraídas de internet, y deben ser revisadas antes de incluirlas definitivamente en currículos académicos de alta criticidad. Por favor, <strong>no ingrese información sensible</strong>, confidencial o derechos de autor no autorizados.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-gray-900 dark:text-white">
              8. Privacidad de Menores
            </h2>
            <p>
              Este GPT está diseñado para diseñadores instruccionales y educadores (adultos). No está dirigido a niños y no solicitamos de ninguna manera información relacionada con menores.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-gray-900 dark:text-white">
              9. Cambios en la Política
            </h2>
            <p>
              Es posible que actualicemos esta página en el futuro si cambian nuestras prácticas, las características de nuestro GPT, o las normativas de OpenAI. 
              <br/>
              <strong>Última actualización:</strong> 05 de Marzo de 2026.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-gray-900 dark:text-white">
              10. Contacto
            </h2>
            <p>
              Para cualquier consulta legal o de privacidad sobre las prácticas de este asistente, contáctenos en <a href="mailto:support@soflia.ai" className="text-blue-600 hover:underline dark:text-blue-400">support@soflia.ai</a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
