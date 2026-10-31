// Mirrors the TS checks behind the Obsidian plugin scorecard (community.obsidian.md).
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  globalIgnores(["main.js", "node_modules/", "build-local.mjs", "esbuild.config.mjs", "scripts/", "test/", "spike/", ".maestri/"]),
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*"],
        },
      },
    },
    rules: {
      "obsidianmd/prefer-active-doc": "warn",
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          brands: ["Obsidian", "Bard Player", "YouTube", "YouTube Music", "Windows"],
          ignoreWords: ["Ctrl", "Settings"],
        },
      ],
    },
  },
]);
