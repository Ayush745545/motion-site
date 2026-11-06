import { defineConfig, globalIgnores } from "eslint/config";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextTypescript,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly", setTimeout: "readonly" } },
    rules: { "no-undef": "error", "no-unused-vars": "error" },
  },
  {
    files: ["workers/analyzer/extract.js"],
    languageOptions: { globals: { document: "readonly", getComputedStyle: "readonly", Node: "readonly", URL: "readonly" } },
    rules: { "no-undef": "error", "@typescript-eslint/no-unused-expressions": "off" },
  },
  globalIgnores([".cache/**", "**/dist/**", "**/.next/**", "**/.venv/**"]),
]);
