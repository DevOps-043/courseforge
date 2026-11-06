export class CourseSourceError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "CourseSourceError";
  }
}

export function sourcePersistenceError(error: { message: string; code?: string }): never {
  if (error.code === "23505") throw new CourseSourceError(409, "El archivo o su sustitución ya están registrados. Reutiliza la versión existente.");
  if (error.message.includes("SOURCE_QUOTA")) throw new CourseSourceError(429, "Se alcanzó la cuota de documentos o borradores.");
  if (error.message.includes("SOURCE_NOT_FOUND")) throw new CourseSourceError(404, "Fuente o curso no encontrado.");
  if (error.message.includes("SOURCE_CONFLICT")) throw new CourseSourceError(409, "La solicitud ya no coincide con la reserva o su versión.");
  if (error.message.includes("SOURCE_EXPIRED")) throw new CourseSourceError(409, "La reserva de carga venció. Consulta el estado antes de iniciar otra carga.");
  throw new CourseSourceError(503, "No se pudo consultar o guardar el estado documental. Consulta el estado antes de reintentar.");
}
