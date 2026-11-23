import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

// Los overrides globales también alcanzan CommonJS; reutilizar los mismos plugins.
const nextPlugins = nextVitals.find((config) => config.plugins?.["react-hooks"])?.plugins;
if (!nextPlugins) throw new Error("El preset Next no expone los plugins necesarios para lint.");

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  { plugins: nextPlugins },
  {
    // La deuda existente se registra por archivo/regla; el gate rechaza incrementos.
    rules: {
      "@next/next/no-assign-module-variable": "warn",
      "@next/next/no-html-link-for-pages": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "prefer-const": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react/no-unescaped-entities": "warn",
    },
  },
  {
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  globalIgnores([
    ".next/**",
    ".netlify/**",
    "**/.tmp/**",
    "dist/**",
    "coverage/**",
    "public/**",
  ]),
]);
