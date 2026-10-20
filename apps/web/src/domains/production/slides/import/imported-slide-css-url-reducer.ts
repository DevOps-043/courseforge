/** Reducción de transporte; el saneamiento autoritativo sigue en servidor. */
export function createImportedCssUrlReducer(emit: (css: string) => void, onRemoved: () => void) {
  let pending = "";
  let inUrl = false;
  let quote = "";
  let escaped = false;

  function write(chunk: string) {
    pending += chunk;
    let cursor = 0;
    while (cursor < pending.length) {
      if (inUrl) {
        for (; cursor < pending.length; cursor++) {
          const character = pending[cursor];
          if (escaped) { escaped = false; continue; }
          if (character === "\\") { escaped = true; continue; }
          if (quote) { if (character === quote) quote = ""; continue; }
          if (character === '"' || character === "'") { quote = character; continue; }
          if (character === ")") { inUrl = false; cursor++; break; }
        }
        if (inUrl) { pending = ""; return; }
      } else {
        const match = /url\s*\(/ig;
        match.lastIndex = cursor;
        const found = match.exec(pending);
        if (!found) {
          const remainder = pending.slice(cursor);
          const suffix = /(?:u|ur|url\s*)$/i.exec(remainder)?.[0] ?? "";
          // Un prefijo patológico se conserva y queda sujeto al presupuesto de salida.
          const keep = suffix.length <= 256 ? suffix.length : 0;
          emit(remainder.slice(0, remainder.length - keep));
          pending = keep ? remainder.slice(-keep) : "";
          return;
        }
        emit(pending.slice(cursor, found.index));
        emit("url()");
        onRemoved();
        inUrl = true;
        cursor = match.lastIndex;
      }
    }
    pending = "";
  }

  return { write, end() {
    if (inUrl) throw new Error("El CSS contiene una URL sin cerrar. Revisa el archivo original.");
    emit(pending); pending = "";
  } };
}
