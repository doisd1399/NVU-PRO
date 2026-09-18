import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
let checks = 0;
const expect = (condition, label) => {
  checks += 1;
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`PASS ${checks}: ${label}`);
};

const fn = read("functions/src/gtoTrips.ts");
expect(fn.includes('if (destinationCompany) assertBoundedText(destinationCompany, "destinationCompany");'), "destinationCompany is optional in registerGtoTrip");
expect(!/\n\s*assertBoundedText\(destinationCompany, "destinationCompany"\);/.test(fn), "no unconditional destinationCompany backend gate remains");

const observerType = read("src/lib/gtoObserver.ts");
expect(!observerType.includes("freightReplacementExplicitlyArmed"), "obsolete HF33 explicit replacement status removed from web bridge");

const setup = read("src/components/GtoObserverSetup.tsx");
expect(!setup.includes("freightReplacementExplicitlyArmed"), "obsolete explicit replacement UI removed");
expect(setup.includes("encerrando o contexto anterior e preparando o próximo frete automaticamente"), "HF34 canonical reopened-list message present");

const trip = read("src/pages/driver/RecordTrip.tsx");
expect(trip.includes('{uploadPhase !== "idle" && ('), "receipt overlay is gated by receipt upload phase");
expect(trip.includes('{uploadPhase === "idle" && imageHash && ('), "receipt success badge survives final trip submission busy state");
expect(!trip.includes('{isUploading && (\n                    <div className="absolute inset-x-0 bottom-0'), "global trip busy state no longer reopens receipt progress overlay");
expect(trip.includes('gtoManualConfirmed'), "newer AI Studio manual audit fallback preserved");
expect(trip.includes('withTimeout('), "newer AI Studio timeout hardening preserved");

const ocrPrep = read("scripts/prepare-tesseract-assets.mjs");
expect(ocrPrep.includes('if (info.size < minBytes)'), "OCR build rejects empty/corrupt local runtime assets");
expect(ocrPrep.includes('await assertFile(workerTarget, "worker local publicado")'), "OCR worker is verified after build-time copy");

const tesseractDir = new URL("../public/tesseract/", import.meta.url);
const zeroByteRuntimeFiles = [];
if (fs.existsSync(tesseractDir)) {
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const path = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      if (entry.isDirectory()) walk(path);
      else if (fs.statSync(path).size === 0) zeroByteRuntimeFiles.push(path.pathname);
    }
  };
  walk(tesseractDir);
}
expect(zeroByteRuntimeFiles.length === 0, "export contains no zero-byte Tesseract runtime placeholders");
expect(fs.existsSync(new URL("../package-lock.json", import.meta.url)), "npm lockfile is present for reproducible Netlify/AI Studio installs");
const bunLock = new URL("../bun.lock", import.meta.url);
expect(!fs.existsSync(bunLock) || fs.statSync(bunLock).size > 0, "no empty bun.lock can confuse package-manager detection");

console.log(`HF53 AI Studio alignment: ${checks}/${checks} PASS`);
