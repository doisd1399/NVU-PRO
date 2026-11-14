import assert from "node:assert/strict";
import {
  APP_GUIDES, APP_GUIDE_MAX_BYTES, buildGuideStoragePath, formatGuideSize, readGuideRecord, resolveAppGuide, sanitizeGuideFileName, validateGuideFile,
} from "../src/lib/appGuides.ts";
import fs from "node:fs";

// 1) guias que acompanham o app existem de verdade e são PDF
for (const guide of APP_GUIDES) {
  const file = "public" + guide.bundledUrl;
  assert(fs.existsSync(file), file);
  assert.equal(fs.readFileSync(file).subarray(0, 5).toString("latin1"), "%PDF-", file);
}
assert.deepEqual(APP_GUIDES.map(guide => guide.id), ["driver", "company"]);

// 2) nome e caminho seguros no Storage (um nome novo a cada envio, dentro de app-guides/{guia}/)
assert.equal(sanitizeGuideFileName("Guia do Motorista – versão 2.PDF"), "Guia-do-Motorista-versao-2.pdf");
assert.equal(sanitizeGuideFileName("../../etc/passwd"), "etc-passwd.pdf");
assert.equal(sanitizeGuideFileName(""), "guia.pdf");
assert.equal(buildGuideStoragePath("driver", "a b.pdf", 123), "app-guides/driver/123-a-b.pdf");
assert(!buildGuideStoragePath("company", "../x.pdf", 1).includes(".."));

// 3) validação do arquivo antes do envio
const head = (text: string) => new TextEncoder().encode(text);
assert.equal(validateGuideFile({ name: "a.pdf", size: 1000, type: "application/pdf" }, head("%PDF-1.7")), null);
assert.equal(validateGuideFile({ name: "a.pdf", size: 1000, type: "" }, head("%PDF-1.4")), null, "alguns navegadores não informam o tipo");
assert.match(validateGuideFile({ name: "a.pdf", size: 0, type: "application/pdf" }, head("%PDF-")) || "", /vazio/);
assert.match(validateGuideFile({ name: "a.pdf", size: APP_GUIDE_MAX_BYTES + 1, type: "application/pdf" }, head("%PDF-")) || "", /15 MB/);
assert.match(validateGuideFile({ name: "a.pdf", size: 10, type: "application/pdf" }, head("<html>")) || "", /PDF/, "extensão .pdf com conteúdo de outro tipo");
assert.match(validateGuideFile({ name: "a.pdf", size: 10, type: "image/png" }, head("%PDF-")) || "", /PDF/);

// 4) ficha do Firestore: só vale se completa e do guia certo; senão o app usa o guia que acompanha a versão
const good = { id: "driver", fileName: "Guia.pdf", storagePath: "app-guides/driver/1-guia.pdf", downloadUrl: "https://firebasestorage.googleapis.com/v0/b/x/o/y?alt=media", size: 2048, updatedAt: { seconds: 1762430400 } };
assert.equal(readGuideRecord("driver", good)?.downloadUrl, good.downloadUrl);
assert.equal(readGuideRecord("company", good), null, "caminho de outro guia");
assert.equal(readGuideRecord("other", good), null);
assert.equal(readGuideRecord("driver", { ...good, downloadUrl: "http://x/y" }), null, "só https");
assert.equal(readGuideRecord("driver", { ...good, downloadUrl: "" }), null);
assert.equal(readGuideRecord("driver", { ...good, fileName: "" }), null);
assert.equal(readGuideRecord("driver", null), null);
assert.equal(readGuideRecord("driver", "texto"), null);

// 5) resolução: sem ficha = guia do app (funciona offline); com ficha = arquivo enviado
const [driver] = APP_GUIDES;
const bundled = resolveAppGuide(driver, null);
assert.equal(bundled.source, "bundled"); assert.equal(bundled.url, "/guias/NVU-Guia-do-Motorista.pdf"); assert.equal(bundled.updatedAtMs, null);
const uploaded = resolveAppGuide(driver, readGuideRecord("driver", good));
assert.equal(uploaded.source, "uploaded"); assert.equal(uploaded.url, good.downloadUrl); assert.equal(uploaded.updatedAtMs, 1762430400000); assert.equal(uploaded.size, 2048);
assert.equal(resolveAppGuide(driver, undefined).source, "bundled");

// 6) texto do tamanho
assert.equal(formatGuideSize(null), ""); assert.equal(formatGuideSize(500), "1 KB"); assert.equal(formatGuideSize(2048), "2 KB"); assert.equal(formatGuideSize(2411724), "2,3 MB");
console.log("guias do app: ok");
