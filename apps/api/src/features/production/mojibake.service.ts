const UTF8_MOJIBAKE_RE = /\u00c3.|\u00c2.|\u00e2(?:\u20ac\u2122|\u20ac\u0153|\u20ac\ufffd|\u20ac\u201c|\u20ac\u201d|\u20ac\u02dc|\u20ac|\u201e\u00a2|\u20ac\u00a6)/;

const UTF8_MOJIBAKE_REPLACEMENTS: Record<string, string> = {
  "\u00c3\u00a1": "\u00e1",
  "\u00c3\u00a9": "\u00e9",
  "\u00c3\u00ad": "\u00ed",
  "\u00c3\u00b3": "\u00f3",
  "\u00c3\u00ba": "\u00fa",
  "\u00c3\u00b1": "\u00f1",
  "\u00c3\u00bc": "\u00fc",
  "\u00c3\u0081": "\u00c1",
  "\u00c3\u0089": "\u00c9",
  "\u00c3\u008d": "\u00cd",
  "\u00c3\u0093": "\u00d3",
  "\u00c3\u009a": "\u00da",
  "\u00c3\u0091": "\u00d1",
  "\u00c3\u009c": "\u00dc",
  "\u00c2\u00a1": "\u00a1",
  "\u00c2\u00bf": "\u00bf",
  "\u00c2\u00b7": "\u00b7",
  "\u00c2\u00ab": "\u00ab",
  "\u00c2\u00bb": "\u00bb",
  "\u00c2\u00b0": "\u00b0",
  "\u00c2\u00a9": "\u00a9",
  "\u00c2\u00ae": "\u00ae",
  "\u00c2": "",
  "\u00e2\u20ac\u2122": "\u2019",
  "\u00e2\u20ac\u02dc": "\u2018",
  "\u00e2\u20ac\u0153": "\u201c",
  "\u00e2\u20ac\ufffd": "\u201d",
  "\u00e2\u20ac\u201c": "\u2013",
  "\u00e2\u20ac\u201d": "\u2014",
  "\u00e2\u20ac\u00a6": "\u2026",
  "\u00e2\u201e\u00a2": "\u2122",
};

export function repairCommonUtf8Mojibake(value: string): string {
  if (!UTF8_MOJIBAKE_RE.test(value)) return value;

  return Object.entries(UTF8_MOJIBAKE_REPLACEMENTS).reduce(
    (current, [broken, fixed]) => current.split(broken).join(fixed),
    value,
  );
}
