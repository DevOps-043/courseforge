/** Fixed server-owned program. Never evaluate a font, stylesheet or request as JS.
 * Fontkit is externalized in Next so its pinned module is available in the worker. */
export const GOOGLE_FONT_DECODER_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
try {
  const font = require(workerData.modulePath).create(Buffer.from(workerData.bytes));
  const policy = workerData.policy;
  if (font.fonts || !font.directory || !font.directory.tables) throw Error();
  const tables = Object.entries(font.directory.tables);
  if (!tables.length || tables.length > policy.maximumTables) throw Error();
  let decodedBytes = 0;
  for (const [tag, table] of tables) {
    for (const length of [table.length, table.transformLength ?? table.length])
      if (!Number.isSafeInteger(length) || length < 0 || length > policy.maximumDecodedBytes) throw Error();
    decodedBytes += Math.max(table.length, table.transformLength ?? table.length);
    if (decodedBytes > policy.maximumDecodedBytes) throw Error();
    if (['name','OS/2','cmap','head','maxp'].includes(tag) && table.transformed) throw Error();
  }
  if (font.directory.totalSfntSize && font.directory.totalSfntSize > policy.maximumDecodedBytes) throw Error();
  for (const tag of ['name','OS/2','cmap','head','hhea','hmtx','maxp']) if (!font.directory.tables[tag] || !font[tag]) throw Error();
  const os2 = font['OS/2'];
  if (!os2.fsType || !os2.fsSelection || !Number.isInteger(os2.usWeightClass)) throw Error();
  if (os2.fsType.noEmbedding || os2.fsType.viewOnly || os2.fsType.bitmapOnly || os2.fsType.noSubsetting) throw Error();
  if (!Number.isInteger(font.numGlyphs) || font.numGlyphs < 1 || font.numGlyphs > policy.maximumGlyphs) throw Error();
  if (!Number.isFinite(font.unitsPerEm) || font.unitsPerEm < 16 || font.unitsPerEm > 16384) throw Error();
  let pathCommands = 0;
  // Force actual outline decoding, not just lazy metadata getters or a signature.
  for (let index = 0; index < font.numGlyphs; index++) {
    const glyph = font.getGlyph(index);
    if (!glyph || !Number.isFinite(glyph.advanceWidth)) throw Error();
    const commands = glyph.path.commands;
    if (!Array.isArray(commands)) throw Error();
    pathCommands += commands.length;
    if (pathCommands > policy.maximumPathCommands) throw Error();
    for (const command of commands) if (!command.args.every(Number.isFinite)) throw Error();
  }
  const characters = [...new Set(font.characterSet)].sort((a,b) => a-b);
  const ranges = [];
  for (const code of characters) {
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) throw Error();
    // cmap may contain a sentinel mapped to .notdef. It is not usable coverage.
    if (!font.hasGlyphForCodePoint(code)) continue;
    const last = ranges[ranges.length-1];
    if (last && last[1]+1 === code) last[1] = code;
    else ranges.push([code,code]);
    if (ranges.length > policy.maximumCoverageRanges) throw Error();
  }
  if (!ranges.length) throw Error();
  parentPort.postMessage({ ok:true, metadata:{
    family: font.getName('preferredFamily','en') || font.familyName,
    style: os2.fsSelection.italic || os2.fsSelection.oblique ? 'italic' : 'normal',
    weight: os2.usWeightClass, axes: font.variationAxes, glyphCount:font.numGlyphs,
    coverage:ranges, decodedBytes, embedding:'EDITABLE_TABLE_FLAGS'
  }});
} catch { parentPort.postMessage({ok:false}); }
`;
