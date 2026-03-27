/**
 * 📊 CourseForge - Lines of Code Counter
 * 
 * Counts all lines of code in the project, grouped by file extension.
 * Excludes: node_modules, .git, .next, dist, build, lock files, etc.
 * 
 * Usage: node scripts/count-lines.js
 */

const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..');

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '.turbo',
  '.cache', '.vercel', '.netlify', 'coverage', '.nyc_output',
  '__pycache__', '.svn', '.hg',
]);

const EXCLUDED_FILES = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'deno.lock',
  '.DS_Store', 'Thumbs.db',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.avif',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pdf', '.docx', '.xlsx', '.pptx', '.zip', '.gz', '.tar',
  '.mp4', '.mp3', '.wav', '.ogg', '.webm',
  '.exe', '.dll', '.so', '.dylib',
]);

// ── Helpers ─────────────────────────────────────────────────────────
function countLines(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const total = lines.length;
    const blank = lines.filter(l => l.trim() === '').length;
    const code = total - blank;
    return { total, blank, code };
  } catch {
    return { total: 0, blank: 0, code: 0 };
  }
}

function walk(dir, stats) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath, stats);
    } else if (entry.isFile()) {
      if (EXCLUDED_FILES.has(entry.name)) continue;

      const ext = path.extname(entry.name).toLowerCase() || '(no ext)';
      if (BINARY_EXTENSIONS.has(ext)) continue;

      const { total, blank, code } = countLines(fullPath);

      if (!stats[ext]) {
        stats[ext] = { files: 0, total: 0, blank: 0, code: 0 };
      }
      stats[ext].files++;
      stats[ext].total += total;
      stats[ext].blank += blank;
      stats[ext].code += code;
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────
function main() {
  const stats = {};
  const startTime = Date.now();

  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════════╗');
  console.log('  ║        📊  CourseForge — Lines of Code Report               ║');
  console.log('  ╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  📂 Root: ${ROOT}`);
  console.log('  ⏳ Scanning...');
  console.log('');

  walk(ROOT, stats);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  // Sort by total lines descending
  const sorted = Object.entries(stats).sort((a, b) => b[1].total - a[1].total);

  // Grand totals
  const grandTotal = { files: 0, total: 0, blank: 0, code: 0 };
  for (const [, s] of sorted) {
    grandTotal.files += s.files;
    grandTotal.total += s.total;
    grandTotal.blank += s.blank;
    grandTotal.code += s.code;
  }

  // Column widths
  const pad = (str, len, align = 'left') => {
    const s = String(str);
    return align === 'right' ? s.padStart(len) : s.padEnd(len);
  };

  const EXT_W = 14;
  const NUM_W = 10;

  const sep = `  ${'─'.repeat(EXT_W)}┼${'─'.repeat(NUM_W)}┼${'─'.repeat(NUM_W)}┼${'─'.repeat(NUM_W)}┼${'─'.repeat(NUM_W)}`;
  const sepBold = `  ${'═'.repeat(EXT_W)}╪${'═'.repeat(NUM_W)}╪${'═'.repeat(NUM_W)}╪${'═'.repeat(NUM_W)}╪${'═'.repeat(NUM_W)}`;

  // Header
  console.log(`  ${pad('Extension', EXT_W)}│${pad('Files', NUM_W, 'right')}│${pad('Total', NUM_W, 'right')}│${pad('Code', NUM_W, 'right')}│${pad('Blank', NUM_W, 'right')}`);
  console.log(sepBold);

  // Highlight key extensions
  const highlight = new Set(['.tsx', '.ts', '.jsx', '.js', '.css', '.html', '.json', '.md', '.sql']);

  for (const [ext, s] of sorted) {
    const pct = ((s.total / grandTotal.total) * 100).toFixed(1);
    const icon = highlight.has(ext) ? '▸' : ' ';
    const label = `${icon} ${ext}`;
    console.log(
      `  ${pad(label, EXT_W)}│${pad(s.files.toLocaleString(), NUM_W, 'right')}│${pad(s.total.toLocaleString(), NUM_W, 'right')}│${pad(s.code.toLocaleString(), NUM_W, 'right')}│${pad(s.blank.toLocaleString(), NUM_W, 'right')}  (${pct}%)`
    );
  }

  console.log(sepBold);
  console.log(
    `  ${pad('TOTAL', EXT_W)}│${pad(grandTotal.files.toLocaleString(), NUM_W, 'right')}│${pad(grandTotal.total.toLocaleString(), NUM_W, 'right')}│${pad(grandTotal.code.toLocaleString(), NUM_W, 'right')}│${pad(grandTotal.blank.toLocaleString(), NUM_W, 'right')}`
  );

  console.log('');

  // ── Top 5 categories ──
  console.log('  ┌──────────────────────────────────────────────────────────────┐');
  console.log('  │  🏆 Top 5 Extensions by Lines of Code                       │');
  console.log('  └──────────────────────────────────────────────────────────────┘');
  console.log('');

  const top5 = sorted.slice(0, 5);
  const maxBar = 40;
  const maxLines = top5[0]?.[1].total || 1;

  for (const [ext, s] of top5) {
    const barLen = Math.round((s.total / maxLines) * maxBar);
    const bar = '█'.repeat(barLen) + '░'.repeat(maxBar - barLen);
    const pct = ((s.total / grandTotal.total) * 100).toFixed(1);
    console.log(`  ${pad(ext, 12)} ${bar} ${s.total.toLocaleString().padStart(8)} lines (${pct}%)`);
  }

  console.log('');

  // ── Summary ──
  console.log('  ┌──────────────────────────────────────────────────────────────┐');
  console.log('  │  📋 Summary                                                 │');
  console.log('  └──────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log(`  📁 Total files scanned:    ${grandTotal.files.toLocaleString()}`);
  console.log(`  📝 Total lines:            ${grandTotal.total.toLocaleString()}`);
  console.log(`  💻 Lines of code:          ${grandTotal.code.toLocaleString()}`);
  console.log(`  ⬜ Blank lines:            ${grandTotal.blank.toLocaleString()}`);
  console.log(`  📊 File types found:       ${sorted.length}`);
  console.log(`  ⏱️  Scan time:              ${elapsed}s`);
  console.log('');

  // ── TypeScript/React breakdown ──
  const tsExtensions = ['.ts', '.tsx', '.js', '.jsx'];
  const tsStats = { files: 0, total: 0, code: 0, blank: 0 };
  for (const ext of tsExtensions) {
    if (stats[ext]) {
      tsStats.files += stats[ext].files;
      tsStats.total += stats[ext].total;
      tsStats.code += stats[ext].code;
      tsStats.blank += stats[ext].blank;
    }
  }

  if (tsStats.files > 0) {
    console.log('  ┌──────────────────────────────────────────────────────────────┐');
    console.log('  │  ⚛️  TypeScript / React Breakdown                            │');
    console.log('  └──────────────────────────────────────────────────────────────┘');
    console.log('');
    for (const ext of tsExtensions) {
      if (stats[ext]) {
        const s = stats[ext];
        console.log(`    ${pad(ext, 8)} → ${pad(s.files, 5, 'right')} files,  ${pad(s.total.toLocaleString(), 8, 'right')} lines  (${pad(s.code.toLocaleString(), 8, 'right')} code)`);
      }
    }
    console.log(`    ${'─'.repeat(52)}`);
    console.log(`    ${'Combined'} → ${pad(tsStats.files, 5, 'right')} files,  ${pad(tsStats.total.toLocaleString(), 8, 'right')} lines  (${pad(tsStats.code.toLocaleString(), 8, 'right')} code)`);
    console.log('');
  }
}

main();
