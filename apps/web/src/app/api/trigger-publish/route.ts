// Re-exporta el handler de /api/publish.
// La UI llama a /api/trigger-publish pero la lógica vive en /api/publish.
export { POST } from '@/app/api/publish/route';
