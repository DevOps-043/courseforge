import { COURSE_SOURCE_BUCKET, COURSE_SOURCE_LIMITS } from "./course-source-policy";
import { CourseSourceError } from "./course-source-error";
import { publicSourceDocument, reserveSourceUploadSchema, type CourseSourceDocument, type ReserveSourceUpload } from "./course-source.schema";
import type { CourseSourceRepository } from "./course-source.repository";
import { verifySourceUpload } from "./course-source-upload-verification";

export interface SourceStorage {
  sign(path: string): Promise<{ signedUrl: string; token: string }>;
  read(path: string, expectedBytes: number): Promise<Uint8Array>;
}
type UploadRepository = Pick<CourseSourceRepository, "reserve" | "get" | "confirm">;

export class CourseSourceService {
  constructor(private readonly repository: UploadRepository, private readonly storage: SourceStorage,
    private readonly userId: string, private readonly now = () => Date.now()) {}

  async reserve(artifactId: string, input: ReserveSourceUpload) {
    const document = await this.repository.reserve(artifactId, reserveSourceUploadSchema.parse(input));
    if (document.status !== "RESERVED") return { document: publicSourceDocument(document), upload: null };
    this.assertReservation(document);
    const upload = await this.storage.sign(document.storage_path);
    return { document: publicSourceDocument(document), upload: { ...upload, bucket: COURSE_SOURCE_BUCKET, path: document.storage_path } };
  }

  async confirm(artifactId: string, documentId: string) {
    const document = await this.repository.get(artifactId, documentId);
    if (!document) throw new CourseSourceError(404, "Documento no encontrado para este curso.");
    if (document.created_by !== this.userId) throw new CourseSourceError(403, "Solo quien reservó la carga puede confirmarla.");
    if (["UPLOADED", "PROCESSING", "READY"].includes(document.status)) return { document: publicSourceDocument(document) };
    this.assertReservation(document);
    if (document.size_bytes > COURSE_SOURCE_LIMITS.fileBytes) throw new CourseSourceError(413, "El archivo excede el límite de carga.");
    const bytes = await this.storage.read(document.storage_path, document.size_bytes);
    const verified = await verifySourceUpload(document, bytes);
    const confirmed = await this.repository.confirm(artifactId, documentId, verified.sha256, verified.sizeBytes);
    return { document: publicSourceDocument(confirmed) };
  }

  private assertReservation(document: CourseSourceDocument) {
    if (document.created_by !== this.userId) throw new CourseSourceError(403, "La reserva pertenece a otro usuario.");
    if (document.status !== "RESERVED") throw new CourseSourceError(409, "El documento no admite confirmar una carga.");
    if (Date.parse(document.expires_at) <= this.now()) throw new CourseSourceError(409, "La reserva de carga venció. Consulta su estado antes de repetirla.");
  }
}
