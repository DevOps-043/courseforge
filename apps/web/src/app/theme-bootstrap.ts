// Runs before hydration. Keep the storage key and theme names aligned with Providers.
export const THEME_BOOTSTRAP_SCRIPT = `(() => {
  let theme = "system";
  try { theme = localStorage.getItem("theme") || theme; } catch {}
  const resolved = theme === "dark" || theme === "light"
    ? theme
    : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
})();`;
