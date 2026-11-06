"""Inventario local reproducible; solo lee fuentes versionadas, nunca secretos."""
import json
import subprocess
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
paths = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")
prefixes = ("apps/web/src/", "apps/web/netlify/functions/", "apps/api/src/", "supabase/functions/", "supabase/migrations/", "scripts/", ".github/workflows/")
files = [p for p in paths if p.startswith(prefixes) and Path(p).suffix in {".ts", ".tsx", ".mjs", ".sql", ".yml"}]
groups = Counter()
largest = []
tests = []
routes = []
for name in files:
    source = ROOT / name
    if not source.is_file():
        continue
    content = source.read_text(encoding="utf-8-sig")
    if name.startswith("apps/web/src/domains/"):
        group = "/".join(name.split("/")[:5])
    else:
        group = next(p.rstrip("/") for p in prefixes if name.startswith(p))
    groups[group] += 1
    if ".test." in name or "__tests__/" in name:
        tests.append(name)
    if name.endswith("/route.ts"):
        routes.append(name)
    if source.suffix in {".ts", ".tsx"} and "__tests__/" not in name:
        largest.append({"path": name, "lines": len(content.splitlines())})
result = {
    "date": "2026-11-04", "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip(),
    "method": "git ls-files; prefijos y extensiones explícitos en inventory.py; conteos estructurales, no cobertura de pruebas ni deuda",
    "groups": dict(sorted(groups.items())), "source_files": len(files),
    "routes": routes, "test_files": tests,
    "largest": sorted(largest, key=lambda row: row["lines"], reverse=True)[:25],
    "netlify_entries": [p for p in files if p.startswith("apps/web/netlify/functions/") and len(p.split("/")) == 5],
    "edge_entries": [p for p in files if p.startswith("supabase/functions/") and p.endswith("/index.ts")],
    "migrations": [p for p in files if p.startswith("supabase/migrations/")],
}
target = Path(__file__).with_name("inventory.json")
target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"files": len(files), "routes": len(routes), "tests": len(tests), "groups": result["groups"], "largest": result["largest"][:8]}, ensure_ascii=False))
