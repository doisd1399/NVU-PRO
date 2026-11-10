import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Foto do veículo escolhida na galeria (src/lib/vehiclePhotoPrepare.ts), no Chromium de verdade.
// Causa do erro "VEHICLE_PHOTO_DECODE_INVALID": a checagem antiga abria a foto inteira num <img> e recusava mais de 40 MP; no Android o WebView
// limita o que decodifica conforme a memória do aparelho (câmeras de 48/50/64/108 MP e HEIC falhavam, "para alguns funciona e para outros não").
// Aqui se prova que: fotos de 50 MP / 20 MB entram sem abrir um <img> grande, a rotação EXIF fica certa, cada falha tem mensagem clara e
// o que sobe para o Storage continua pequeno.
let playwright;
try { playwright = await import("playwright"); }
catch { playwright = await import(pathToFileURL(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright/index.mjs")).href); }

const root = process.cwd();
const bundle = await build({ entryPoints: [path.join(root, "src/lib/vehiclePhotoPrepare.ts")], bundle: true, write: false, format: "iife", globalName: "Prep", platform: "browser", target: "es2022" });
const TINY_AVIF = "AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAVwAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAAQAAAADAAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAAX21kYXQSAAoJGBV/vaICGg0IMkhGUeHhiGHnnnmgAADPzEjKqveV8vpWtp2BPTFNS5dR+TpQdLEMHaSTt3JgVN39BUlNrqsnI13lijakA2nDEdCFZ6GmQAko52s=";
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;

const browser = await playwright.chromium.launch({ headless: true,
  ...(process.env.NVU_CHROMIUM_EXECUTABLE ? { executablePath: process.env.NVU_CHROMIUM_EXECUTABLE } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const errors = [];
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };

// Ferramentas de teste executadas dentro da página (foto sintética de 4 quadrantes: vermelho/verde em cima, azul/amarelo embaixo).
const helpers = () => {
  const paint = (ctx, w, h) => {
    ctx.fillStyle = "#e02020"; ctx.fillRect(0, 0, w / 2, h / 2); ctx.fillStyle = "#20c020"; ctx.fillRect(w / 2, 0, w / 2, h / 2);
    ctx.fillStyle = "#2020e0"; ctx.fillRect(0, h / 2, w / 2, h / 2); ctx.fillStyle = "#e0e020"; ctx.fillRect(w / 2, h / 2, w / 2, h / 2);
  };
  window.makeJpeg = async (w, h, { quality = 0.9, orientation = 1 } = {}) => {
    const canvas = new OffscreenCanvas(w, h); paint(canvas.getContext("2d"), w, h);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    return orientation === 1 ? blob : window.withOrientation(blob, orientation);
  };
  window.withOrientation = async (blob, orientation) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const exif = [0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00,
      0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    return new Blob([bytes.slice(0, 2), new Uint8Array(exif), bytes.slice(2)], { type: "image/jpeg" });
  };
  window.makePng = async (w, h) => { const canvas = new OffscreenCanvas(w, h); paint(canvas.getContext("2d"), w, h); return canvas.convertToBlob({ type: "image/png" }); };
  window.makeWebp = async (w, h) => { const canvas = new OffscreenCanvas(w, h); paint(canvas.getContext("2d"), w, h); return canvas.convertToBlob({ type: "image/webp", quality: 0.9 }); };
  // Cor perto de cada canto da foto pronta: R G B Y (vermelho, verde, azul, amarelo) na ordem canto superior esquerdo, superior direito, inferior esquerdo, inferior direito.
  window.corners = async (blob) => {
    const bitmap = await createImageBitmap(blob), canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0); const w = bitmap.width, h = bitmap.height;
    const tag = (fx, fy) => { const [r, g, b] = ctx.getImageData(Math.round(w * fx), Math.round(h * fy), 1, 1).data; return r > 150 && g < 110 && b < 110 ? "R" : g > 150 && r < 110 && b < 110 ? "G" : b > 150 && r < 110 && g < 110 ? "B" : r > 150 && g > 150 && b < 110 ? "Y" : "?"; };
    return { size: `${w}x${h}`, order: tag(0.1, 0.1) + tag(0.9, 0.1) + tag(0.1, 0.9) + tag(0.9, 0.9) };
  };
  window.dataUrlSize = async (dataUrl) => { const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob()); return { width: bitmap.width, height: bitmap.height }; };
  window.run = async (file, options) => {
    try { const r = await Prep.preparePhoto(file, options); return { ok: true, via: r.via, width: r.width, height: r.height, type: r.blob.type, bytes: r.blob.size, same: r.blob === file, poster: r.posterDataUrl.slice(0, 22), format: r.probe.format }; }
    catch (e) { return { ok: false, code: e.code, message: e.message, name: e.name }; }
  };
};

async function freshPage() {
  const context = await browser.newContext();
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    assert.equal(url.hostname, "127.0.0.1", "Só recursos locais isolados");
    return route.fulfill({ body: html, contentType: "text/html" });
  });
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:43832/"); // 127.0.0.1 é contexto seguro: expõe o ImageDecoder, como o WebView do app
  await page.evaluate(helpers);
  return { page, context };
}

try {
  const { page, context } = await freshPage();
  const caps = await page.evaluate(() => ({ imageDecoder: typeof ImageDecoder === "function", bitmap: typeof createImageBitmap === "function", offscreen: typeof OffscreenCanvas === "function" }));
  ok(caps.imageDecoder && caps.bitmap && caps.offscreen, "o Chromium do teste precisa ter ImageDecoder, createImageBitmap e OffscreenCanvas");

  // ───── cabeçalho: tipo real, dimensões e orientação, sem decodificar
  const probes = await page.evaluate(async (avif) => {
    const out = {};
    out.jpeg = (({ format, width, height, orientation }) => ({ format, width, height, orientation }))(await Prep.probePhoto(await makeJpeg(640, 480)));
    for (const o of [3, 6, 8]) out["exif" + o] = (await Prep.probePhoto(await makeJpeg(640, 480, { orientation: o }))).orientation;
    out.png = (({ format, width, height }) => ({ format, width, height }))(await Prep.probePhoto(await makePng(321, 123)));
    out.webp = (({ format, width, height }) => ({ format, width, height }))(await Prep.probePhoto(await makeWebp(400, 300)));
    out.gif = (({ format, width, height }) => ({ format, width, height }))(await Prep.probePhoto(new Blob([Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), c => c.charCodeAt(0))])));
    out.avif = (await Prep.probePhoto(new Blob([Uint8Array.from(atob(avif), c => c.charCodeAt(0))]))).format;
    out.heic = (await Prep.probePhoto(new Blob([Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99, 0, 0, 0, 0, 109, 105, 102, 49, 104, 101, 105, 99, ...new Array(64).fill(0)])]))).format;
    out.text = (await Prep.probePhoto(new Blob(["%PDF-1.4 não é foto"]))).format;
    // JPEG com bloco APP1 grande (XMP/ICC de celulares): o cabeçalho do quadro vem depois de ~200 KB
    const base = new Uint8Array(await (await makeJpeg(500, 300)).arrayBuffer()), pad = new Uint8Array(65_533).fill(0), seg = [0xff, 0xe1, 0xff, 0xff];
    const big = new Blob([base.slice(0, 2), new Uint8Array(seg), pad, new Uint8Array(seg), pad, new Uint8Array(seg), pad, new Uint8Array(seg), pad, base.slice(2)]);
    out.bigHeader = (({ format, width, height }) => ({ format, width, height }))(await Prep.probePhoto(big));
    return out;
  }, TINY_AVIF);
  eq(probes.jpeg, { format: "jpeg", width: 640, height: 480, orientation: 1 }, "JPEG: dimensões lidas do cabeçalho");
  eq([probes.exif3, probes.exif6, probes.exif8], [3, 6, 8], "orientação EXIF lida do APP1");
  eq(probes.png, { format: "png", width: 321, height: 123 }); eq(probes.webp, { format: "webp", width: 400, height: 300 }); eq(probes.gif, { format: "gif", width: 1, height: 1 });
  eq(probes.avif, "avif", "AVIF reconhecido pela marca"); eq(probes.heic, "heic", "HEIC/HEIF reconhecido pela marca"); eq(probes.text, "unknown");
  eq(probes.bigHeader, { format: "jpeg", width: 500, height: 300 }, "cabeçalho do quadro depois de blocos APP grandes");

  // ───── foto comum de 12 MP: sai em WebP até 1280 px, dentro do limite, com miniatura
  const normal = await page.evaluate(async () => { const file = await makeJpeg(4000, 3000); const r = await run(file, {}); r.fileBytes = file.size; return r; });
  ok(normal.ok, JSON.stringify(normal)); eq([normal.width, normal.height, normal.type], [1280, 960, "image/webp"]); ok(normal.bytes <= 800_000, "foto final até 800 KB"); eq(normal.via, "image-decoder"); ok(normal.poster.startsWith("data:image/jpeg"));

  // ───── 50 MP (antes: recusada por passar de 40 MP): entra, sem abrir um <img> grande
  const big = await page.evaluate(async () => {
    let imageElements = 0; const NativeImage = window.Image;
    window.Image = new Proxy(NativeImage, { construct(target, args) { imageElements++; return new target(...args); } });
    const file = await makeJpeg(8160, 6120, { quality: 0.85 });
    const started = performance.now(), r = await run(file, {}); r.ms = Math.round(performance.now() - started); r.imageElements = imageElements; r.fileBytes = file.size;
    window.Image = NativeImage; return r;
  });
  ok(big.ok, JSON.stringify(big)); eq([big.width, big.height, big.type, big.via], [1280, 960, "image/webp", "image-decoder"], "50 MP lido na escala reduzida"); eq(big.imageElements, 0, "nenhum <img> com a foto inteira");
  ok(big.ms < 15_000, `50 MP em ${big.ms} ms`);

  // ───── 108 MP: também entra (JPEG reduzido a 1/8), sem estourar memória
  const huge = await page.evaluate(async () => { const file = await makeJpeg(12000, 9000, { quality: 0.8 }); const started = performance.now(); const r = await run(file, {}); r.ms = Math.round(performance.now() - started); return r; });
  ok(huge.ok, JSON.stringify(huge)); eq([huge.width, huge.height, huge.via], [1280, 960, "image-decoder"], "108 MP lido na escala 1/8");

  // ───── rotação EXIF (foto de celular em pé): 1 = RGBY; 3 (180°) = YBGR; 6 (90° horário) = BRYG; 8 (90° anti-horário) = GYRB
  for (const [orientation, expected] of [[1, { size: "1280x960", order: "RGBY" }], [3, { size: "1280x960", order: "YBGR" }], [6, { size: "960x1280", order: "BRYG" }], [8, { size: "960x1280", order: "GYRB" }]]) {
    const result = await page.evaluate(async (o) => {
      const prepared = await Prep.preparePhoto(await makeJpeg(4000, 3000, { orientation: o }), {});
      return { corners: await corners(prepared.blob), via: prepared.via, dims: `${prepared.width}x${prepared.height}` };
    }, orientation);
    eq(result.corners, expected, `orientação EXIF ${orientation}`); eq(result.dims, expected.size); eq(result.via, "image-decoder");
  }

  // ───── PNG e WEBP (sem escala por JPEG): caminho do createImageBitmap
  for (const kind of ["png", "webp"]) {
    const r = await page.evaluate(async (k) => { const file = await (k === "png" ? makePng(4000, 3000) : makeWebp(4000, 3000)); return run(file, {}); }, kind);
    ok(r.ok, JSON.stringify(r)); eq([r.width, r.height, r.via, r.type], [1280, 960, "image-bitmap", "image/webp"], kind);
  }
  const avif = await page.evaluate(async (data) => run(new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))]), {}), TINY_AVIF);
  ok(avif.ok && avif.via === "image-bitmap", "AVIF abre pelo createImageBitmap: " + JSON.stringify(avif));

  // ───── limite de 20 MB: 20 MB exatos entram; um byte a mais é recusado com a mensagem certa
  const sizes = await page.evaluate(async () => {
    const jpeg = await makeJpeg(2000, 1500), limit = 20 * 1024 * 1024;
    const exact = new Blob([jpeg, new Uint8Array(limit - jpeg.size)], { type: "image/jpeg" }), over = new Blob([jpeg, new Uint8Array(limit - jpeg.size + 1)], { type: "image/jpeg" });
    return { exactSize: exact.size, exact: await run(exact, {}), over: await run(over, {}) };
  });
  eq(sizes.exactSize, 20 * 1024 * 1024); ok(sizes.exact.ok, "20 MB exatos: " + JSON.stringify(sizes.exact));
  eq(sizes.over.code, "VEHICLE_PHOTO_TOO_LARGE"); ok(/tem 20,1 MB/.test(sizes.over.message) && /limite é 20 MB/.test(sizes.over.message), sizes.over.message);

  // ───── falhas com mensagem clara (nunca o código cru na tela)
  const failures = await page.evaluate(async () => {
    const jpeg = await makeJpeg(800, 600), cut = jpeg.slice(0, Math.floor(jpeg.size / 3), "image/jpeg");
    // assinatura de JPEG seguida de lixo (sem quadro nem dados): nenhum decodificador abre
    const garbage = new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Array.from({ length: 4000 }, (_, i) => (i * 37 + 11) % 251)])], { type: "image/jpeg" });
    const heic = new Blob([Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99, 0, 0, 0, 0, 109, 105, 102, 49, 104, 101, 105, 99, ...new Array(64).fill(0)])], { type: "image/heic" });
    const unreadable = { size: 100, type: "image/jpeg", slice: () => ({ arrayBuffer: () => Promise.reject(new DOMException("não foi possível ler", "NotReadableError")) }) };
    const hang = { size: 100, type: "image/jpeg", slice: () => ({ arrayBuffer: () => new Promise(() => {}) }) };
    return { empty: await run(new Blob([]), {}), garbage: await run(garbage, {}), text: await run(new Blob(["isto não é uma foto"], { type: "image/jpeg" }), {}), cut: await run(cut, {}), heic: await run(heic, {}), unreadable: await run(unreadable, {}), timeout: await run(hang, { timeoutMs: 150 }) };
  });
  eq(failures.empty.code, "VEHICLE_PHOTO_EMPTY"); eq(failures.text.code, "VEHICLE_PHOTO_NOT_IMAGE"); eq(failures.garbage.code, "VEHICLE_PHOTO_DECODE_INVALID");
  ok(failures.cut.ok, "JPEG cortado no meio abre pela parte que chegou (como na galeria), sem erro: " + JSON.stringify(failures.cut));
  eq(failures.heic.code, "VEHICLE_PHOTO_HEIC_UNSUPPORTED"); eq(failures.unreadable.code, "VEHICLE_PHOTO_UNREADABLE"); eq(failures.timeout.code, "VEHICLE_PHOTO_TIMEOUT");
  for (const [name, failure] of Object.entries(failures).filter(([name]) => name !== "cut")) ok(!/^VEHICLE_PHOTO_[A-Z_]+$/.test(failure.message) && /[a-zç]{4,} [a-zç]{2,}/i.test(failure.message), `${name}: mensagem em português, não o código: ${failure.message}`);
  ok(/HEIC/.test(failures.heic.message) && /JPG/.test(failures.heic.message) && /alta eficiência/.test(failures.heic.message), "HEIC explica o que fazer");
  ok(/Google Fotos/.test(failures.unreadable.message), "foto da nuvem explica o que fazer"); ok(/corrompido/.test(failures.garbage.message) && /Escolha outra foto/.test(failures.garbage.message), "arquivo corrompido explica o motivo");

  // ───── foto já otimizada (baixada do Storage): devolve os mesmos bytes
  const keep = await page.evaluate(async () => { const file = await makeJpeg(800, 600, { quality: 0.7 }); return { ...(await run(file, { keepOriginal: p => p.bytes <= 850_000 && Math.max(p.width, p.height) <= 1280 })), fileBytes: file.size }; });
  ok(keep.ok && keep.same && keep.via === "original" && keep.bytes === keep.fileBytes, "foto pequena já otimizada fica como está: " + JSON.stringify(keep));

  // ───── miniatura 480×320 (ou menos), JPEG
  const poster = await page.evaluate(async () => { const r = await Prep.preparePhoto(await makeJpeg(4000, 3000), {}); return { head: r.posterDataUrl.slice(0, 23), ...(await dataUrlSize(r.posterDataUrl)) }; });
  eq([poster.head, poster.width, poster.height], ["data:image/jpeg;base64,", 480, 360], "miniatura 480 px de largura");
  const noPoster = await page.evaluate(async () => (await Prep.preparePhoto(await makeJpeg(1000, 800), { poster: false })).posterDataUrl);
  eq(noPoster, "", "sem miniatura quando não pedida");
  await context.close();

  // ───── WebView sem ImageDecoder (ou que falha): cai no createImageBitmap, com limite pela memória do aparelho
  {
    const { page: older, context: olderContext } = await freshPage();
    const result = await older.evaluate(async () => {
      delete window.ImageDecoder;
      const twelve = await makeJpeg(4000, 3000), fifty = await makeJpeg(8160, 6120, { quality: 0.8 });
      const a = await run(twelve, {});
      Object.defineProperty(navigator, "deviceMemory", { value: 2, configurable: true });       // aparelho de 2 GB: ~26 MP por inteiro
      const small = await run(twelve, {}), refused = await run(fifty, {});
      Object.defineProperty(navigator, "deviceMemory", { value: 8, configurable: true });       // aparelho de 8 GB: 50 MP cabe
      const roomy = await run(fifty, {});
      return { a, small, refused, roomy };
    });
    eq([result.a.ok, result.a.via, result.a.width], [true, "image-bitmap", 1280], "12 MP sem ImageDecoder"); ok(result.small.ok, "12 MP cabe em 2 GB");
    eq(result.refused.code, "VEHICLE_PHOTO_RESOLUTION_UNSUPPORTED", "50 MP sem ImageDecoder em 2 GB é recusado em vez de arriscar a memória"); ok(/megapixels/.test(result.refused.message) && /menor resolução/.test(result.refused.message), result.refused.message);
    ok(result.roomy.ok && result.roomy.via === "image-bitmap", "50 MP cabe em 8 GB: " + JSON.stringify(result.roomy));
    await olderContext.close();
  }
  {
    const { page: broken, context: brokenContext } = await freshPage();
    const result = await broken.evaluate(async () => {
      const NativeDecoder = window.ImageDecoder;
      window.ImageDecoder = class { constructor() { throw new Error("falha simulada do decodificador"); } static isTypeSupported() { return Promise.resolve(true); } };
      const afterDecoder = await run(await makeJpeg(4000, 3000), {});
      window.ImageDecoder = NativeDecoder; delete window.createImageBitmap;
      const lastResort = await run(await makeJpeg(4000, 3000), {});
      return { afterDecoder, lastResort };
    });
    eq([result.afterDecoder.ok, result.afterDecoder.via], [true, "image-bitmap"], "decodificador falhou: segue pelo createImageBitmap");
    eq([result.lastResort.ok, result.lastResort.via, result.lastResort.width], [true, "image-decoder", 1280], "com o ImageDecoder de volta continua pela escala reduzida");
    const imgOnly = await broken.evaluate(async () => { delete window.ImageDecoder; return run(await makeJpeg(3000, 2000), {}); });
    eq([imgOnly.ok, imgOnly.via, imgOnly.width], [true, "img-element", 1280], "último recurso: <img>");
    await brokenContext.close();
  }
  assert.deepEqual(errors, [], "nenhum erro de página");
  console.log(`Foto do veículo (preparo seguro): ${checks} verificações passaram.`);
} finally { await browser.close(); }
