import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";
// `test` builds sign in through their own partition (see src/constants.ts).
const testBuild = process.argv[3] === "test";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
  ],
  format: "cjs",
  target: "es2020",
  // Obsidian loads plugins as CommonJS; Node builtins only resolve through require().
  supported: { "dynamic-import": false },
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  define: testBuild ? { BARD_PARTITION: JSON.stringify("persist:bard-player-test") } : {},
});

await context.rebuild();
await context.dispose();
process.exit(0);
