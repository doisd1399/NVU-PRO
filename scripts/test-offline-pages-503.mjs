import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const root = process.cwd(), fixture = path.join(root, "scripts/fixtures/offline-pages-503-ports.tsx");
const compiled = await build({ entryPoints: ["scripts/fixtures/offline-pages-503-tests.tsx"], bundle: true, write: false,
  platform: "node", format: "cjs", packages: "external", loader: { ".css": "empty" }, define: { "import.meta.env.DEV": "false" },
  plugins: [{ name: "offline-503-isolated-transport", setup(builder) {
    builder.onResolve({ filter: /^(?:firebase\/firestore|firebase\/storage)$|\/(?:lib\/firebase|services\/notificationService|components\/common\/StableImage)$/ }, () => ({ path: fixture }));
    builder.onResolve({ filter: /\/context\/(?:AppContext|CompanyContext)$/ }, args => args.importer.endsWith("RecruitmentTab.tsx") ? { path: fixture } : undefined);
  } }] });
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: "http://localhost", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "CustomEvent", "Event", "getComputedStyle", "localStorage"])
  Object.defineProperty(globalThis, key, { value: key === "window" ? dom.window : dom.window[key], configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const errors = [], originalError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(" ")); originalError(...args); };
try {
  const module = new Module(path.join(root, "scripts/.offline-pages-503.cjs"));
  module.filename = path.join(root, "scripts/.offline-pages-503.cjs"); module.paths = Module._nodeModulePaths(path.join(root, "scripts"));
  module._compile(compiled.outputFiles[0].text, module.filename);
  const cases = await module.exports.run();
  assert.deepEqual(errors, [], "React regressions must be resolved");
  fs.mkdirSync("reports", { recursive: true });
  fs.writeFileSync("reports/offline-pages-503.json", JSON.stringify({ cases, productionAccess: false, method: "Real RH page and recruitment controller; isolated Firestore transport, JSDOM lifecycle." }, null, 2) + "\n");
  console.log(`OFFLINE_PAGES_503 ${cases.length}/${cases.length} PASS`);
} finally { console.error = originalError; dom.window.close(); }
