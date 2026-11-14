// ETS2 modo print, OCR REAL em Chromium: print do ônibus ("Trabalho concluído", valor em verde, km em laranja).
// Antes da v91 o app lia tudo vazio ("nenhum dado pôde ser confirmado") e a viagem não era lançada.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const publicDir = path.join(root, "public");
const image = path.join(root, "tests/fixtures/scs/ets2-bus-trabalho-concluido.jpg");
const entry = `import { extractScsTripData } from "./src/services/scsTripOcrService";
window.runScs = async (url, sim) => { const b = await (await fetch(url)).blob(); return extractScsTripData(new File([b], "print.jpg", { type: b.type }), sim); };`;
const bundled = await build({ stdin: { contents: entry, loader: "ts", resolveDir: root }, bundle: true, write: false, format: "iife", platform: "browser", loader: { ".css": "empty" } });
const html = `<!doctype html><meta charset="utf-8"><script>${bundled.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script>`;
const types = { ".wasm": "application/wasm", ".js": "text/javascript; charset=utf-8", ".jpg": "image/jpeg" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8"); return res.end(html); }
  if (url.pathname === "/print.jpg") { res.setHeader("Content-Type", "image/jpeg"); return res.end(fs.readFileSync(image)); }
  const file = path.join(publicDir, decodeURIComponent(url.pathname));
  if (!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream"); res.setHeader("Access-Control-Allow-Origin", "*");
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.NVU_CHROMIUM_EXECUTABLE;
let browser;
try { browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] }); }
catch (error) {
  await new Promise((resolve) => server.close(resolve));
  if (/socket\(\) failed: Operation not permitted|Executable doesn't exist/.test(String(error))) { console.error("SCS_BUS_OCR_BLOCKED: Chromium indisponível; leitura real não executada."); process.exit(2); }
  throw error;
}
try {
  const page = await browser.newPage();
  // O app carrega o worker/núcleo do Tesseract pelo CDN no celular; aqui usa os mesmos arquivos locais do projeto.
  await page.route(/cdn\.jsdelivr\.net\/npm\/tesseract\.js@[^/]+\/dist\/worker\.min\.js/, (r) => r.fulfill({ path: path.join(publicDir, "tesseract/worker.min.js"), contentType: "text/javascript", headers: { "access-control-allow-origin": "*" } }));
  await page.route(/cdn\.jsdelivr\.net\/npm\/tesseract\.js-core@[^/]+\/(.+)/, (r) => {
    const file = path.join(publicDir, "tesseract/core", r.request().url().split("/").pop());
    return fs.existsSync(file) ? r.fulfill({ path: file, headers: { "access-control-allow-origin": "*" } }) : r.abort();
  });
  await page.goto(`${origin}/`);
  const result = await page.evaluate(() => window.runScs("/print.jpg", "ETS2"));
  assert(result, "o OCR devolveu resultado");
  assert.equal(result.origin, "Porto");
  assert.equal(result.destination, "Gijon");
  assert.equal(result.distanceKm, 618, "km da viagem");
  assert.equal(result.sourceDistanceUnit, "km");
  assert.equal(result.value, "10.595,00", "Total € 10.595 (nunca o XP 1.026)");
  console.log("SCS_BUS_OCR_PASS: Porto → Gijon, 618 km, 10.595,00 lidos do print do ônibus.");
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
