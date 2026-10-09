import { HtmlEditingValidationError } from "./html-editing-validation";

const pathToken = /[a-zA-Z]|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const commandArity: Readonly<Record<string, number>> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
type Point = Readonly<{ x: number; y: number }>;
function reject(): never { throw new HtmlEditingValidationError("INVALID_SOURCE"); }

/** Validates a bounded static path subset without rewriting it. Bezier control
 * hulls bound curves; arcs include SVG radius correction, not just raw radii.
 * Compact adjacent arc flags are deliberately unsupported: explicit 0/1 tokens
 * keep the admission grammar unambiguous. This is not a raster/layout bound. */
export function assertHtmlEditingSvgPath(value: string,
  limits: Readonly<{ maximumMagnitude: number; maximumNumericTokens: number }>): void {
  const tokens: string[] = [];
  let offset = 0, numericTokens = 0, commandTokens = 0, afterComma = false;
  while (offset < value.length) {
    if (/\s/.test(value[offset])) { offset++; continue; }
    if (value[offset] === ",") {
      if (!tokens.length || afterComma || /^[a-zA-Z]$/.test(tokens[tokens.length - 1])) reject();
      afterComma = true; offset++; continue;
    }
    pathToken.lastIndex = offset;
    const match = pathToken.exec(value);
    if (!match || (afterComma && /^[a-zA-Z]$/.test(match[0]))) reject();
    if (/^[a-zA-Z]$/.test(match[0])) {
      if (++commandTokens > limits.maximumNumericTokens) reject();
    } else if (++numericTokens > limits.maximumNumericTokens) reject();
    tokens.push(match[0]); offset = pathToken.lastIndex; afterComma = false;
  }
  if (afterComma) reject();
  if (!tokens.length) return; // SVG defines an empty path as no geometry.
  if (!/^[Mm]$/.test(tokens[0])) reject();

  const bounded = (point: Point): Point => {
    if (![point.x, point.y].every(coordinate => Number.isFinite(coordinate)
      && Math.abs(coordinate) <= limits.maximumMagnitude)) reject();
    return point;
  };
  let cursor: Point = { x: 0, y: 0 }, subpath = cursor;
  let previousKind = "", control: Point | null = null;
  let command = "", index = 0;
  while (index < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[index])) {
      command = tokens[index++];
      if (command.toUpperCase() === "Z") {
        cursor = subpath; control = null; previousKind = "Z"; command = ""; continue;
      }
    }
    const kind = command.toUpperCase(), arity = commandArity[kind];
    if (!arity || index + arity > tokens.length) reject();
    const raw = tokens.slice(index, index + arity);
    const amounts = raw.map(Number);
    if (amounts.some(amount => !Number.isFinite(amount) || Math.abs(amount) > limits.maximumMagnitude)) reject();
    index += arity;
    const relative = command === command.toLowerCase();
    const point = (x: number, y: number) => bounded({ x: x + (relative ? cursor.x : 0), y: y + (relative ? cursor.y : 0) });
    const reflection = () => bounded({ x: 2 * cursor.x - (control?.x ?? cursor.x),
      y: 2 * cursor.y - (control?.y ?? cursor.y) });
    let endpoint: Point, nextControl: Point | null = null;
    if (kind === "H") endpoint = bounded({ x: amounts[0] + (relative ? cursor.x : 0), y: cursor.y });
    else if (kind === "V") endpoint = bounded({ x: cursor.x, y: amounts[0] + (relative ? cursor.y : 0) });
    else if (kind === "C") {
      point(amounts[0], amounts[1]); nextControl = point(amounts[2], amounts[3]); endpoint = point(amounts[4], amounts[5]);
    } else if (kind === "S") {
      if (["C", "S"].includes(previousKind)) reflection();
      nextControl = point(amounts[0], amounts[1]); endpoint = point(amounts[2], amounts[3]);
    } else if (kind === "Q") {
      nextControl = point(amounts[0], amounts[1]); endpoint = point(amounts[2], amounts[3]);
    } else if (kind === "T") {
      nextControl = ["Q", "T"].includes(previousKind) ? reflection() : cursor;
      endpoint = point(amounts[0], amounts[1]);
    } else if (kind === "A") {
      if (amounts[0] < 0 || amounts[1] < 0 || ![raw[3], raw[4]].every(flag => flag === "0" || flag === "1")) reject();
      endpoint = point(amounts[5], amounts[6]);
      if (amounts[0] !== 0 && amounts[1] !== 0 && (cursor.x !== endpoint.x || cursor.y !== endpoint.y)) {
        const angle = (amounts[2] % 360) * Math.PI / 180;
        const halfX = (cursor.x - endpoint.x) / 2, halfY = (cursor.y - endpoint.y) / 2;
        const rotatedX = Math.cos(angle) * halfX + Math.sin(angle) * halfY;
        const rotatedY = -Math.sin(angle) * halfX + Math.cos(angle) * halfY;
        const correction = Math.max(1, Math.hypot(rotatedX / amounts[0], rotatedY / amounts[1]));
        const diameterBound = 2 * Math.hypot(amounts[0] * correction, amounts[1] * correction);
        if (!Number.isFinite(diameterBound)
          || Math.max(Math.abs(cursor.x), Math.abs(endpoint.x)) + diameterBound > limits.maximumMagnitude
          || Math.max(Math.abs(cursor.y), Math.abs(endpoint.y)) + diameterBound > limits.maximumMagnitude) reject();
      }
    } else endpoint = point(amounts[0], amounts[1]);
    cursor = endpoint; control = nextControl; previousKind = kind;
    if (kind === "M") { subpath = cursor; command = relative ? "l" : "L"; }
  }
}
