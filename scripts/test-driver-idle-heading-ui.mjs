import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// "Painel do motorista" without a running operation: the real idle panel with the built stylesheets. Its title and description use the
// same sizes as the working panel (19px / 10px) and sit a little higher than before.
let playwright;
try { playwright = await import("playwright"); }
catch { playwright = await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright/index.mjs")).href); }
const root = process.cwd(), errors = [];
const assets = await fs.readdir("dist/assets");
const rank = n => n.startsWith("vendor-") ? 0 : n.startsWith("index-") ? 1 : 2;
const css = (await Promise.all(assets.filter(n => n.endsWith(".css")).sort((a, b) => rank(a) - rank(b)).map(n => fs.readFile(path.join("dist/assets", n), "utf8")))).join("\n");
const bundle = await build({
  stdin: { resolveDir: root, sourcefile: "idle-heading.tsx", loader: "tsx", contents: `
import React from "react";import {createRoot} from "react-dom/client";
import {DriverIdlePanel} from "./src/components/driver/DriverIdlePanel";
createRoot(document.getElementById("root")).render(<main className="nvu-workspace-theme nvu-driver-workspace" style={{padding:14,background:"var(--driver-page)",minHeight:"100vh"}}>
<DriverIdlePanel online suspended={false} onAvailabilityChange={()=>{}} request={{pending:false,busy:false,success:false,onRequest:()=>{}}} onProfile={()=>{}} works={null} history={null}><section data-testid="after">Fila</section></DriverIdlePanel></main>);` },
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", loader: { ".css": "empty" }, logLevel: "error",
  define: { "process.env.NODE_ENV": '"test"', "import.meta.env.DEV": "false" },
  plugins: [{ name: "firebase-free", setup(b) {
    b.onResolve({ filter: /\/StableImage$/ }, () => ({ path: "stable", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "import React from 'react';export function StableImage({fallback,wrapperClassName}){return <span className={wrapperClassName}>{fallback}</span>}", loader: "tsx", resolveDir: root }));
  } }],
});
const html = `<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.NVU_CHROMIUM_EXECUTABLE ? { executablePath: process.env.NVU_CHROMIUM_EXECUTABLE } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const context = await browser.newContext();
  await context.route("**/*", async route => {
    const u = new URL(route.request().url());
    if (u.hostname !== "127.0.0.1") return route.abort();
    if (u.pathname.startsWith("/assets/")) return route.fulfill({ body: await fs.readFile(path.join(root, "public", u.pathname)), contentType: "font/woff2" });
    return route.fulfill({ body: html, contentType: "text/html" });
  });
  const page = await context.newPage(); page.on("pageerror", e => errors.push(e.message));
  await page.goto("http://127.0.0.1:43851/"); await page.getByTestId("driver-idle-panel").waitFor();
  const results = [];
  for (const dark of [true, false]) for (const width of [320, 390, 412, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark);
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(() => {
      const r = s => document.querySelector(s).getBoundingClientRect(), panel = r('[data-testid="driver-idle-panel"]'), h1 = document.querySelector(".nvu-idle-heading h1"), p = document.querySelector(".nvu-idle-heading p");
      return { titleSize: getComputedStyle(h1).fontSize, titleWeight: getComputedStyle(h1).fontWeight, descSize: getComputedStyle(p).fontSize, descPad: getComputedStyle(p).padding,
        titleOffset: r(".nvu-idle-heading h1").top - panel.top, descGap: r(".nvu-idle-heading p").top - r(".nvu-idle-heading h1").bottom,
        companyGap: r(".nvu-driver-status-row").top - r(".nvu-idle-heading p").bottom, overflow: document.documentElement.scrollWidth > innerWidth,
        center: Math.abs((r(".nvu-idle-heading h1").left + r(".nvu-idle-heading h1").width / 2) - (panel.left + panel.width / 2)) };
    });
    const tag = `${dark ? "dark" : "light"} ${width}`;
    assert.equal(m.titleSize, "19px", tag); assert.equal(m.descSize, "10px", tag);
    assert(m.titleOffset <= 18, `${tag}: the title sits higher (${m.titleOffset}px from the panel top; it was 28px)`);
    assert(m.descGap >= 4 && m.descGap <= 10, `${tag}: ${m.descGap}`); assert(m.companyGap >= 12, `${tag}: ${m.companyGap}`);
    assert(!m.overflow, tag); assert(m.center <= 1.5, `${tag}: centred`);
    results.push(tag);
  }
  assert.deepEqual(errors, []);
  console.log(`DRIVER_IDLE_HEADING_UI_PASS (${results.length} layouts)`);
} finally { await browser.close(); }
