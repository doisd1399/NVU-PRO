import fs from "node:fs";

const normalize = (raw) =>
  String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const detect = (raw) => {
  const normalized = normalize(raw);
  const evidence = [];
  const add = (v) => { if (!evidence.includes(v)) evidence.push(v); };

  if (/\bvalor (?:foi |ja )?dobrad[oa]\b/.test(normalized)) add("valor-dobrado");
  if (/\bganh(?:o|os) (?:foi |foram |ja )?dobrad[oa]s?\b/.test(normalized)) add("ganho-dobrado");
  if (/\b(?:anuncio|video)\b.{0,45}\b(?:assistid|concluid|finalizad)[oa]s?\b/.test(normalized)
      || /\b(?:assistid|concluid|finalizad)[oa]s?\b.{0,45}\b(?:anuncio|video)\b/.test(normalized)) add("midia-assistida");
  if (/\b(?:bonus|recompensa)\b.{0,45}\b(?:recebid|aplicad|concedid|creditad)[oa]s?\b/.test(normalized)
      || /\b(?:recebid|aplicad|concedid|creditad)[oa]s?\b.{0,45}\b(?:bonus|recompensa)\b/.test(normalized)) add("recompensa-recebida");

  const doubledMarker = /\bdobrad[oa]s?\b/.test(normalized) || /\b(?:2x|x2|valor x ?2)\b/.test(normalized);
  const completedAdMarker =
    /\b(?:anuncio|video)\b.{0,45}\b(?:assistid|concluid|finalizad)[oa]s?\b/.test(normalized)
    || /\b(?:assistid|concluid|finalizad)[oa]s?\b.{0,45}\b(?:anuncio|video)\b/.test(normalized)
    || /\b(?:bonus|recompensa)\b.{0,45}\b(?:recebid|aplicad|concedid|creditad)[oa]s?\b/.test(normalized);
  if (doubledMarker && completedAdMarker) add("dobro-confirmado-com-anuncio");
  return evidence.length > 0;
};

const cases = [
  ["normal result with option", "Concluído Valor a receber R$ 6230 Receber Dobrar valor ADS", false],
  ["plain ad button", "Receber ADS Dobrar valor", false],
  ["doubled confirmation", "Valor dobrado com sucesso", true],
  ["watched video confirmation", "Vídeo assistido - valor dobrado", true],
  ["watched ad reversed", "Assistido anúncio recompensa recebida", true],
  ["reward received", "Recompensa recebida após vídeo", true],
  ["bonus applied", "Bônus aplicado ao valor", true],
  ["unrelated gameplay", "0 km/h oficina garagem", false],
];

let failed = 0;
for (const [name, text, expected] of cases) {
  const actual = detect(text);
  const ok = actual === expected;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${actual}`);
  if (!ok) failed += 1;
}

const source = fs.readFileSync("src/services/gtoOcrService.ts", "utf8");
const required = ["valor-dobrado", "midia-assistida", "recompensa-recebida", "dobro-confirmado-com-anuncio"];
for (const token of required) {
  const ok = source.includes(token);
  console.log(`${ok ? "OK  " : "FAIL"} source token ${token}`);
  if (!ok) failed += 1;
}

console.log(`\n${cases.length + required.length - failed}/${cases.length + required.length} print evidence cases passed.`);
if (failed) process.exit(1);
