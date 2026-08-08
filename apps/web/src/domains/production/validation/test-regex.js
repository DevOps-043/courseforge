function scopeSelector(selector) {
  return selector
    .split(",")
    .map((raw) => {
      let value = raw.trim();
      if (!value) return value;

      value = value
        .replace(/(?:^|\s)(?:html|body|:root|\.deck-shell|\.deck-stage)(?=[\s.[:]|$)/gi, " .deck-scope")
        .replace(/(?:\s*\.deck-scope\s*)+/g, " .deck-scope ");

      value = value.trim();

      if (value.startsWith(".deck-scope")) return value;
      if (value === "*") return ".deck-scope *";
      return `.deck-scope ${value}`;
    })
    .join(", ");
}

const tests = [
  "html",
  "body .slide",
  ".deck-shell > section",
  "html body .deck-shell .slide",
  ".slide",
  "*",
  "div.deck-shell-wrapper", // should NOT match .deck-shell
  ".deck-shell.light" // should match .deck-shell and keep .light
];

for (const t of tests) {
  console.log(`"${t}" => "${scopeSelector(t)}"`);
}
