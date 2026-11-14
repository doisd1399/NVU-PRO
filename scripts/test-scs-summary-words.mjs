// ETS2/ATS modo print: leitura por palavras do resumo "Trabalho concluído" (ônibus e demais telas coloridas).
// Palavras reais do OCR no print do ônibus (Porto -> Gijón, 618 km, Total € 10.595).
import assert from "node:assert/strict";
import fs from "node:fs";
import { __scsOcrTestUtils as u } from "../src/services/scsTripOcrService.ts";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/scs-bus-summary-words.json", import.meta.url), "utf8"));
const toWords = (rows) => rows.map(([text, conf, x, y]) => ({ text, conf, x, y }));
const [good, bad] = fixture.passes.map(toWords);
let checks = 0;
const ok = (fn, label) => { fn(); checks += 1; console.log("PASS", label); };

ok(() => {
  const r = u.parseScsSummaryWords(good, fixture.frameWidth);
  assert.equal(r.origin, "Porto");
  assert.equal(r.destination, "Gijon");
  assert.equal(r.value, "10.595,00", "Total € 10.595 (a coluna de XP 1.026 não entra)");
}, "rota e valor lidos; XP nunca vira ganho");

ok(() => {
  const r = u.parseScsSummaryWords(good, fixture.frameWidth);
  assert.equal(r.distanceKm, null, "topo lê 618 e a tabela lê 616: não escolhe sozinho");
  assert.deepEqual(r.kmReads.map((k) => `${k.location}:${k.km}`), ["header:618", "reward:616"]);
}, "km divergente (618 x 616) não é aceito sem votação");

ok(() => {
  const r = u.parseScsSummaryWords(bad, fixture.frameWidth);
  assert.equal(r.value, null, "Total mal lido (40595) não bate com a soma 9.855 + 740 + 0 e é recusado");
}, "valor só entra se a soma das linhas bater com o Total");

ok(() => {
  const read = (location, km, unit = "km") => ({ location, km, unit, conf: 95, box: null });
  assert.deepEqual(u.resolveKmVotes([read("header", 618), read("reward", 616), read("header", 618), read("header", 618), read("reward", 618)]), { km: 618, unit: "km" });
  assert.equal(u.resolveKmVotes([read("header", 618), read("reward", 616), read("header", 618), read("reward", 616)]), null, "empate não escolhe");
  assert.equal(u.resolveKmVotes([read("header", 618), read("header", 618), read("header", 618), read("reward", 616)]), null, "vencedor precisa aparecer nas duas posições");
  assert.equal(u.resolveKmVotes([read("header", 618), read("reward", 618)]), null, "2 votos não bastam");
  assert.equal(u.resolveKmVotes([read("header", 618), read("header", 618), read("header", 618)])?.km, 618, "uma só posição legível com 3 leituras iguais");
}, "votação de km: 3+ votos, vencedor único e nas duas posições");

ok(() => {
  const w = (text, x, y, conf = 95) => ({ text, conf, x, y });
  const noMoney = [w("Total", 321, 552), w("1.026", 870, 554), w("EXP", 900, 554)];
  assert.equal(u.parseScsSummaryWords(noMoney, 1280).value, null, "linha Total só com XP não vira dinheiro");
  const truck = [
    w("Recompensa", 321, 291), w("Dinheiro", 748, 291), w("Experiência", 865, 291),
    w("Recompensa", 321, 321), w("base", 390, 321), w("1.234", 568, 321), w("km", 600, 321), w("+€", 743, 321), w("9.855", 760, 321), w("+618", 868, 321), w("EXP", 895, 321),
    w("Total", 321, 552), w("€", 747, 554), w("9.855", 758, 554), w("1.026", 870, 554), w("EXP", 900, 554),
  ];
  assert.equal(u.parseScsSummaryWords(truck, 1280).value, "9.855,00", "uma linha de dinheiro igual ao Total");
}, "Total só com XP é recusado; tabela simples confere");

ok(() => {
  const line = (text) => [{ text, conf: 95, x: 400, y: 160 }];
  const en = u.parseScsSummaryWords([..."transported from Madrid to Lisbon .".split(" ")].map((t, i) => ({ text: t, conf: 95, x: 300 + i * 40, y: 160 })), 1280);
  assert.equal(en.origin, "Madrid");
  assert.equal(en.destination, "Lisbon");
  assert.equal(u.parseScsSummaryWords([], 1280).value, null);
  void line;
}, "rota em inglês e entrada vazia");

console.log(`SCS_SUMMARY_WORDS_PASS ${checks}/${checks}`);
