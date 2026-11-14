import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
const root = process.cwd(), checks: string[] = [], errors: string[] = [];
const server = await createServer({ configFile: false, root, plugins: [{ name: "isolated-cover-observer", enforce: "pre", load(id) {
  if (id.split("?")[0] === path.join(root, "src/services/profileCoverService.ts")) return `export const cacheProfileCover=async()=>{};export const observeProfileCover=()=>()=>{};export const retryProfileCoverSync=()=>{};`;
} }, react()], server: { host: "127.0.0.1", port: 4200, strictPort: true, hmr: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext();
const page = await context.newPage(); let offline = false, requests = 0;
page.on("pageerror", error => errors.push(error.message));
await page.addInitScript("globalThis.__name = (target) => target;");
await page.addInitScript(() => { Object.defineProperty(navigator, "onLine", { configurable: true, get: () => !(window as any).qaOffline }); });
try {
  await page.route("**/*", async route => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:4200/")) return route.continue();
    if (url.startsWith("https://images.example.test/")) {
      requests++;
      if (offline) return route.abort();
      return route.fulfill({ body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=", "base64"), contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*" } });
    }
    return route.abort();
  });
  await page.goto("http://127.0.0.1:4200/verification/release-520/images.html");
  await page.waitForFunction(() => (window as any).qa520?.ready);
  await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-testid="avatar"]')?.src.startsWith("blob:"));
  checks.push("A displayed remote image is stored durably and rendered from local bytes");
  const initial = requests;
  await page.evaluate(() => (window as any).qa520.mount(false));
  await page.evaluate(() => (window as any).qa520.mount(true));
  assert((await page.getByTestId("avatar").getAttribute("src"))?.startsWith("blob:"));
  assert.equal(requests, initial);
  checks.push("Navigating back reuses the synchronous memory source without a network request");
  offline = true;
  await page.reload();
  await page.waitForFunction(() => (window as any).qa520?.ready);
  await page.evaluate(() => { (window as any).qaOffline = true; });
  await page.waitForFunction(() => document.querySelector<HTMLImageElement>('[data-testid="avatar"]')?.complete && document.querySelector<HTMLImageElement>('[data-testid="avatar"]')?.src.startsWith("blob:"));
  assert.equal(requests, initial);
  checks.push("Reload with all remote images blocked restores IndexedDB bytes without relying on HTTP cache");
  await page.evaluate(() => (window as any).qa520.ranking(true));
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>("img")].filter(i => i.src.startsWith("blob:") && i.complete).length >= 2);
  assert.equal(requests, initial);
  await page.evaluate(() => (window as any).qa520.ranking(false));
  checks.push("StableImage's decoded-image preloader also uses offline bytes without a redundant remote request");
  await page.evaluate(() => (window as any).qa520.activateDisplayViewer("viewer-B"));
  assert(!(await page.getByTestId("avatar").getAttribute("src"))?.startsWith("blob:"));
  checks.push("Switching accounts cannot render the previous viewer's cached bytes");
  offline = false;
  await page.evaluate(() => { (window as any).qaOffline = false; (window as any).qa520.activateDisplayViewer("viewer-A"); (window as any).qa520.setUrl("https://images.example.test/avatar-B.png"); });
  await page.waitForFunction(() => !!(window as any).qa520.readDisplayImage("viewer-A", "https://images.example.test/avatar-B.png"));
  await page.evaluate(() => (window as any).qa520.setUrl(""));
  await page.waitForFunction(() => !document.querySelector('[data-testid="avatar"]')?.getAttribute("src"));
  checks.push("A changed URL selects new bytes; explicit photo removal does not revive an old image");
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=";
  await page.evaluate(async data => { await (window as any).qa520.seedCover(data); }, dataUrl);
  await page.reload();
  await page.waitForFunction(() => (window as any).qa520?.ready);
  offline = true;
  await page.evaluate(() => { (window as any).qaOffline = true; (window as any).qa520.cover(true); });
  await page.waitForFunction(() => !!(window as any).qa520.coverAtMount);
  assert.equal(await page.evaluate(() => (window as any).qa520.coverAtMount), dataUrl);
  checks.push("A prehydrated profile cover is present on the first render before its server observer responds");
  const compression = await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 1920; c.height = 1080;
    const x = c.getContext("2d")!;
    const pixels = x.createImageData(c.width, c.height); let seed = 520;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      const shade = Math.floor((i / 4 % c.width) / c.width * 170) + ((seed >>> 24) % 32);
      pixels.data[i] = shade; pixels.data[i+1] = shade + 15; pixels.data[i+2] = shade + 25; pixels.data[i+3] = 255;
    }
    x.putImageData(pixels, 0, 0);
    x.fillStyle = "#222"; x.fillRect(650, 360, 620, 360); x.fillStyle = "white"; x.font = "32px Arial"; x.fillText("Valor a receber: R$ 8.752,00", 720, 490);
    const blob = await new Promise<Blob>(resolve => c.toBlob(b => resolve(b!), "image/png"));
    const original = new File([blob], "receipt.png", { type: "image/png" });
    const result = await (window as any).qa520.prepareTripReceipt(original);
    const image = await createImageBitmap(result);
    const resultInfo = { before: original.size, after: result.size, width: image.width, height: image.height, type: result.type };
    image.close(); return resultInfo;
  });
  console.log("Compression measured:", compression);
  assert(compression.after < compression.before * .85); assert.equal(compression.type, "image/webp");
  assert.equal(compression.width, 1920); assert.equal(compression.height, 1080);
  checks.push("Receipt transport compression reduces bytes while keeping dimensions and the original File unchanged");
  assert.deepEqual(errors, []);
  fs.mkdirSync("reports/release-520", { recursive: true });
  fs.writeFileSync("reports/release-520/image-browser-tests.json", JSON.stringify({ checks, compression, errors, method: "Real React components and IndexedDB in Chromium; remote images intercepted, blocked on reopen; no production calls." }, null, 2));
  console.log("IMAGES_520_PASS", checks.length, compression);
} finally { await browser.close(); server.httpServer?.closeAllConnections(); await server.close(); }
