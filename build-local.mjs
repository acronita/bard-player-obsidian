// Fallback bundler (no npm dependencies): transpiles src/main.ts to main.js
// using Node's built-in TypeScript type-stripping.
// Usage: node build-local.mjs   (prefer `npm run build` when deps are installed)
// Only handles a single-file src/main.ts; extend `files` (dependency order) as modules are added.
import { stripTypeScriptTypes } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

const files = ["src/main.ts"];
const obsidianImports = new Set();
const chunks = [];

for (const f of files) {
  let js = stripTypeScriptTypes(readFileSync(f, "utf8"), { mode: "transform", sourceMap: false });
  js = js.replace(/import\s*\{([^}]*)\}\s*from\s*["']obsidian["'];?/g, (_m, names) => {
    names.split(",").map((s) => s.trim()).filter(Boolean).forEach((n) => obsidianImports.add(n));
    return "";
  });
  js = js.replace(/import[^;]*?from\s*["']\.[^"']*["'];?/g, "");
  js = js.replace(/^\s*export\s+default\s+/m, "");
  js = js.replace(/^export\s+/gm, "");
  chunks.push(`// ---- ${f} ----\n${js}`);
}

const header = `"use strict";\nconst { ${[...obsidianImports].sort().join(", ")} } = require("obsidian");\n\n`;
const footer = `\nmodule.exports = BardPlayerPlugin;\nmodule.exports.default = BardPlayerPlugin;\n`;
writeFileSync("main.js", header + chunks.join("\n\n") + footer);
console.log("main.js written");
