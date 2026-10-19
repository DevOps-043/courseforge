type CatalogRow = Record<string, unknown>;
interface QueryResult { data: CatalogRow | null; error: { message: string } | null; count?: number }

export function createImportCatalogFixture() {
  const tables = new Map<string, Map<string, CatalogRow>>();
  const files = new Map<string, Buffer>();
  const accesses: Array<{ table: string; filters: Record<string, unknown>; operation: string }> = [];
  const failure = { finalSave: false };
  class Query {
    private filters: Record<string, unknown> = {};
    private operation = "read";
    private row: CatalogRow = {};
    private count = false;
    constructor(private table: string) {}
    eq(key: string, value: unknown) { this.filters[key] = value; return this; }
    in(key: string, values: unknown[]) { this.filters[key] = values; return this; }
    select(_columns: string, options?: { count?: string }) { this.count = Boolean(options?.count); return this; }
    upsert(row: CatalogRow) { this.operation = "insert"; this.row = row; return this; }
    update(row: CatalogRow) { this.operation = "update"; this.row = row; return this; }
    private execute(): QueryResult {
      accesses.push({ table: this.table, filters: { ...this.filters }, operation: this.operation });
      if (!tables.has(this.table)) tables.set(this.table, new Map());
      const records = tables.get(this.table)!;
      const selected = [...records.values()].filter(row => Object.entries(this.filters).every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
      if (this.count) return { data: null, error: null, count: selected.length };
      if (this.operation === "insert") {
        const id = String(this.row.id);
        if (!records.has(id)) records.set(id, { ...this.row });
        return { data: records.get(id)!, error: null };
      }
      if (this.operation === "update") {
        if (failure.finalSave) { failure.finalSave = false; return { data: null, error: { message: "Fallo simulado al confirmar" } }; }
        for (const row of selected) Object.assign(row, this.row);
      }
      return { data: selected[0] || null, error: null };
    }
    async maybeSingle() { return this.execute(); }
    async single() { return this.execute(); }
    then(resolve: (value: QueryResult) => unknown) { return Promise.resolve(this.execute()).then(resolve); }
  }
  const admin = {
    from: (table: string) => new Query(table),
    storage: { from: (_bucket: string) => ({
      async upload(path: string, bytes: Buffer) {
        if (files.has(path)) return { error: { message: "El archivo ya existe" } };
        files.set(path, bytes); return { error: null };
      },
      async download(path: string) {
        const bytes = files.get(path);
        return { data: bytes ? { arrayBuffer: async () => Uint8Array.from(bytes).buffer } : null, error: bytes ? null : { message: "No encontrado" } };
      },
    }) },
  };
  return { admin, accesses, tables, files, failure };
}
