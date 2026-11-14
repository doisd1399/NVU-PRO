import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const cwd = process.cwd();
const fixture = path.join(cwd, "scripts/fixtures/news-context-ports.tsx");
const compiled = await build({ entryPoints: ["scripts/fixtures/news-context-tests.tsx"], bundle: true, write: false,
  platform: "node", format: "cjs", packages: "external", loader: { ".css": "empty" }, define: { "import.meta.env.DEV": "false" },
  plugins: [{ name: "news-offline-ports", setup(builder) {
    builder.onResolve({ filter: /^(?:firebase\/firestore|\.\/NewsFeedView)$|\/(?:context\/(?:AppContext|CompanyContext)|lib\/(?:firebase|imageCache|runtimePerformance)|components\/common\/StableImage)$/ }, () => ({ path: fixture }));
  } }] });
const dom = new JSDOM('<!doctype html><html lang="pt-BR"><body></body></html>', { url: "http://localhost", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "CustomEvent", "Event", "getComputedStyle", "localStorage"])
  Object.defineProperty(globalThis, key, { value: key === "window" ? dom.window : dom.window[key], configurable: true });
dom.window.scrollTo = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const errors = [], originalError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(" ")); originalError(...args); };
try {
  const module = new Module(path.join(cwd, "scripts/.news-context-tests.cjs"));
  module.filename = path.join(cwd, "scripts/.news-context-tests.cjs"); module.paths = Module._nodeModulePaths(path.join(cwd, "scripts"));
  module._compile(compiled.outputFiles[0].text, module.filename);
  let watchdog;
  const cases = await Promise.race([module.exports.run(), new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error("News regression suite did not finish all cases")), 30_000); })]).finally(() => clearTimeout(watchdog));
  assert.deepEqual(errors, [], "React/DOM regression warnings must be resolved");
  fs.mkdirSync("reports", { recursive: true });
  fs.writeFileSync("reports/news-context-and-money.json", JSON.stringify({ cases, productionAccess: false,
    method: "Componentes React reais com Firestore e contextos isolados; sem escrita em produção.",
    browserLayoutVerified: false }, null, 2) + "\n");
  console.log(`NEWS_CONTEXT_MONEY ${cases.length}/${cases.length} PASS`);
} finally { console.error = originalError; dom.window.close(); }
