import { HtmlEditingValidationError } from "./html-editing-validation";

export const HTML_EDITING_LAYOUT_EXPANSION_POLICY = Object.freeze({ maximumTracks: 128, maximumCells: 4096,
  maximumColumns: 32, maximumTokens: 8192, maximumIdentifierCharacters: 64, maximumFraction: 128,
  maximumLineNames: 16, maximumExpandedLineNames: 2048, minimumColumnWidthPixels: 1 });
const identifier = /^[a-z_][a-z0-9_-]*$/i;
const reserved = new Set(["auto", "span", "inherit", "initial", "unset", "revert", "revert-layer"]);
function reject(): never { throw new HtmlEditingValidationError("INVALID_SOURCE"); }
function nameAllowed(name: string) {
  return identifier.test(name) && name.length <= HTML_EDITING_LAYOUT_EXPANSION_POLICY.maximumIdentifierCharacters && !reserved.has(name);
}

/** Closed layout syntax, not a general CSS parser or computed-layout bound.
 * Counts expanded explicit tracks rather than only the compact repeat() token.
 * Length validation is injected to reuse the caller's geometric unit policy. */
export function assertHtmlEditingLayoutExpansion(property: string, value: string, assertLength: (value: string) => void): boolean {
  const name = property.replace(/^-(?:webkit|moz)-/, "");
  if (!/^(?:grid(?:-|$)|columns$|column-(?:count|width)$)/.test(name)) return false;
  if (/[\\]/.test(value)) reject();
  let tokens = 0, expandedLineNames = 0;
  const consume = () => { if (++tokens > HTML_EDITING_LAYOUT_EXPANSION_POLICY.maximumTokens) reject(); };
  const split = (raw: string, separator: "space" | "comma"): string[] => {
    const result: string[] = []; let start = 0, depth = 0, bracket = 0;
    for (let index = 0; index < raw.length; index++) {
      const char = raw[index];
      if (char === "(") { if (++depth > 2 || bracket) reject(); }
      else if (char === ")") { if (--depth < 0) reject(); }
      else if (char === "[") { if (++bracket > 1) reject(); }
      else if (char === "]") { if (--bracket < 0) reject(); }
      if (!depth && !bracket && (separator === "space" ? /\s/.test(char) : char === ",")) {
        const token = raw.slice(start, index).trim();
        if (token) { consume(); result.push(token); }
        else if (separator === "comma") reject();
        start = index + 1;
      }
    }
    if (depth || bracket) reject();
    const last = raw.slice(start).trim();
    if (last) { consume(); result.push(last); }
    else if (separator === "comma") reject();
    return result;
  };
  const breadth = (raw: string) => {
    if (["auto", "min-content", "max-content"].includes(raw)) return;
    const fraction = /^([+]?(?:\d+(?:\.\d*)?|\.\d+))fr$/.exec(raw);
    if (fraction) {
      if (!Number.isFinite(Number(fraction[1])) || Number(fraction[1]) > HTML_EDITING_LAYOUT_EXPANSION_POLICY.maximumFraction) reject();
      return;
    }
    assertLength(raw);
  };
  const track = (raw: string) => {
    const sizing = /^(minmax|fit-content)\((.*)\)$/.exec(raw);
    if (!sizing) { breadth(raw); return; }
    const argumentsList = split(sizing[2], "comma");
    if (sizing[1] === "fit-content") {
      if (argumentsList.length !== 1 || /^(?:auto|min-content|max-content)$/.test(argumentsList[0])) reject();
      assertLength(argumentsList[0]);
    } else {
      if (argumentsList.length !== 2 || /fr$/.test(argumentsList[0])) reject();
      argumentsList.forEach(breadth);
    }
  };
  const list = (raw: string, repeated = false, multiplier = 1): number => {
    const entries = split(raw, "space"); let tracks = 0;
    for (const entry of entries) {
      if (/^\[.*\]$/.test(entry)) {
        const names = split(entry.slice(1, -1), "space");
        expandedLineNames += names.length * multiplier;
        if (!names.length || names.length > HTML_EDITING_LAYOUT_EXPANSION_POLICY.maximumLineNames
          || expandedLineNames > HTML_EDITING_LAYOUT_EXPANSION_POLICY.maximumExpandedLineNames
          || names.some(name => !nameAllowed(name))) reject();
        continue;
      }
      const repeat = /^repeat\((.*)\)$/.exec(entry);
      if (repeat) {
        if (repeated) reject();
        const argumentsList = split(repeat[1], "comma");
        if (argumentsList.length !== 2 || !/^\d+$/.test(argumentsList[0])) reject();
        const count = Number(argumentsList[0]);
        if (!Number.isSafeInteger(count) || count < 1 || count > HTML_EDITING_LAYOUT_EXPANSION_POLICY.maximumTracks) reject();
        tracks += count * list(argumentsList[1], true, count);
      } else { track(entry); tracks++; }
      if (tracks > HTML_EDITING_LAYOUT_EXPANSION_POLICY.maximumTracks) reject();
    }
    if (!tracks) reject();
    return tracks;
  };
  if (["grid", "grid-template"].includes(name)) { if (value !== "none") reject(); return true; }
  if (/^grid-(?:template|auto)-(?:rows|columns)$/.test(name)) {
    if (value !== "none" || name.startsWith("grid-auto-")) list(value, name.startsWith("grid-auto-"));
    return true;
  }
  if (name === "grid-template-areas") {
    if (value === "none") return true;
    const rows = [...value.matchAll(/(["'])([^"']*)\1/g)];
    if (!rows.length || rows.length > HTML_EDITING_LAYOUT_EXPANSION_POLICY.maximumTracks
      || value.replace(/(["'])([^"']*)\1/g, "").trim()) reject();
    let columns = 0;
    for (const row of rows) {
      const cells = split(row[2].trim(), "space");
      if (!cells.length || cells.length > HTML_EDITING_LAYOUT_EXPANSION_POLICY.maximumTracks
        || cells.some(cell => !/^\.+$/.test(cell) && !nameAllowed(cell)) || columns && cells.length !== columns) reject();
      columns = cells.length;
    }
    if (columns * rows.length > HTML_EDITING_LAYOUT_EXPANSION_POLICY.maximumCells) reject();
    return true;
  }
  if (name === "grid-auto-flow") {
    if (!["row", "column", "dense", "row dense", "column dense"].includes(value)) reject();
    return true;
  }
  if (/^grid-(?:row|column)(?:-(?:start|end))?$/.test(name) || name === "grid-area") {
    const lines = value.split("/").map(line => line.trim());
    const maximumLines = name === "grid-area" ? 4 : /-(?:start|end)$/.test(name) ? 1 : 2;
    if (lines.length > maximumLines) reject();
    for (const line of lines) {
      if (line === "auto") continue;
      const words = split(line, "space");
      if (!words.length || words.length > 3) reject();
      let counts = 0, names = 0, spans = 0;
      for (const word of words) {
        if (word === "span") spans++;
        else if (/^[+-]?\d+$/.test(word)) {
          const count = Number(word);
          if (!Number.isSafeInteger(count) || !count || Math.abs(count) > HTML_EDITING_LAYOUT_EXPANSION_POLICY.maximumTracks
            || words.includes("span") && count < 0) reject();
          counts++;
        } else if (nameAllowed(word)) names++;
        else reject();
      }
      if (counts > 1 || names > 1 || spans > 1 || spans && !counts && !names) reject();
    }
    return true;
  }
  if (["column-count", "column-width", "columns"].includes(name)) {
    const words = split(value, "space");
    if (!words.length || words.length > (name === "columns" ? 2 : 1)) reject();
    let counts = 0, widths = 0;
    for (const word of words) {
      if (word === "auto") continue;
      if (/^\d+$/.test(word) && name !== "column-width") {
        const count = Number(word);
        if (!Number.isSafeInteger(count) || count < 1 || count > HTML_EDITING_LAYOUT_EXPANSION_POLICY.maximumColumns) reject();
        counts++;
      } else {
        if (name === "column-count" || !/^(?:\d+(?:\.\d*)?|\.\d+)px$/.test(word)
          || Number.parseFloat(word) < HTML_EDITING_LAYOUT_EXPANSION_POLICY.minimumColumnWidthPixels) reject();
        assertLength(word); widths++;
      }
    }
    if (counts > 1 || widths > 1) reject();
    return true;
  }
  reject(); // Unsupported grid sinks require an explicit adapter, not pass-through.
}
