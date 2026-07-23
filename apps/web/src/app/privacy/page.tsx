import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Politica de Privacidad | Courseforge",
  description:
    "Politica de privacidad para la curaduria automatica de fuentes en Courseforge.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 dark:bg-gray-900">
      <div className="max-w-3xl mx-auto bg-white p-8 rounded-xl shadow-sm dark:bg-gray-800 dark:text-gray-200">
        <h1 className="text-3xl font-bold mb-8 text-gray-900 dark:text-white">
          Politicas de privacidad de Courseforge
        </h1>

        <div className="space-y-8 text-gray-700 dark:text-gray-300">
          <section>
            <h2 className="text-xl font-semibold mb-3 text-gray-900 dark:text-white">
              1. Introduccion
            </h2>
            <p>
              Courseforge utiliza IA para apoyar la creacion de cursos,
              incluyendo la busqueda de fuentes publicas relevantes para cada
              leccion. La curaduria de fuentes se ejecuta dentro de la
              plataforma y queda sujeta a revision humana antes de alimentar la
              generacion de materiales.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-gray-900 dark:text-white">
              2. Uso de OpenAI
            </h2>
            <p>
              Para la curaduria automatica de fuentes, Courseforge puede enviar
              contexto pedagogico del curso a la API de OpenAI: titulo,
              descripcion, audiencia, objetivos, modulos y lecciones. No se
              envia informacion sensible que no sea necesaria para encontrar
              fuentes educativas publicas.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-gray-900 dark:text-white">
              3. Informacion que no debe ingresarse
            </h2>
            <p>
              No ingrese contrasenas, tokens, informacion de salud, datos
              financieros, informacion personal sensible ni contenido
              confidencial no autorizado en los campos de descripcion del curso.
              El sistema esta destinado a investigacion educativa y fuentes
              publicas.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-gray-900 dark:text-white">
              4. Fuentes y validacion
            </h2>
            <p>
              Las URLs encontradas se guardan en Courseforge junto con titulo,
              justificacion, leccion relacionada y estado de validacion tecnica.
              El sistema valida disponibilidad, redirecciones, errores HTTP,
              posibles paginas vacias, paywalls basicos y longitud minima de
              contenido antes de marcar una fuente como apta.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-gray-900 dark:text-white">
              5. Revision humana
            </h2>
            <p>
              Las fuentes sugeridas por IA deben revisarse antes de aprobar la
              fase de curaduria. La aprobacion humana sigue siendo el control de
              calidad final para asegurar relevancia, actualidad y pertinencia
              pedagogica.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3 text-gray-900 dark:text-white">
              6. Contacto
            </h2>
            <p>
              Para cualquier consulta legal o de privacidad, contactenos en{" "}
              <a
                href="mailto:support@soflia.ai"
                className="text-blue-600 hover:underline dark:text-blue-400"
              >
                support@soflia.ai
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
