const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const {
  RANKING_TIME_ZONE,
  dateKey,
  periodForDate,
  periodFromKey,
  periodBoundsForDate,
  closedPeriodsInRange,
  parseDate,
} = require("../lib/rankingCalendar.js");
const { publishedAtForCreate } = require("../lib/publicationPolicy.js");

const beforeClose = new Date("2026-09-01T02:59:59.999Z"); // 31/08 23:59:59.999 em São Paulo
const atClose = new Date("2026-09-01T03:00:00.000Z"); // 01/09 00:00:00 em São Paulo;
const augustReference = new Date("2026-08-15T15:00:00.000Z");

assert.equal(RANKING_TIME_ZONE, "America/Sao_Paulo");
assert.equal(dateKey(beforeClose), "2026-08-31");
assert.equal(dateKey(atClose), "2026-09-01");

const augustBeforeClose = periodForDate(augustReference, "mes", beforeClose);
assert.equal(augustBeforeClose, null, "agosto não pode publicar antes do fechamento em São Paulo");

const augustAtClose = periodForDate(augustReference, "mes", atClose);
assert.ok(augustAtClose, "agosto deve ser elegível no primeiro instante de setembro em São Paulo");
assert.equal(augustAtClose.key, "mes_2026-08");
assert.equal(augustAtClose.start.toISOString(), "2026-08-01T03:00:00.000Z");
assert.equal(augustAtClose.end.toISOString(), "2026-09-01T02:59:59.999Z");
assert.equal(augustAtClose.publicationAt.toISOString(), "2026-09-01T03:00:00.000Z");

const closedAtBoundary = closedPeriodsInRange(
  new Date("2026-08-01T03:00:00.000Z"),
  atClose,
  ["mes"],
  atClose,
);
assert.deepEqual(closedAtBoundary.map((period) => period.key), ["mes_2026-08"]);

const september = periodBoundsForDate(atClose, "mes");
assert.equal(september.key, "mes_2026-09");
assert.equal(september.start.toISOString(), "2026-09-01T03:00:00.000Z");
assert.equal(periodForDate(atClose, "mes", atClose), null, "setembro ainda está aberto no próprio início");

const fromKey = periodFromKey("mes", "mes_2026-08");
assert.ok(fromKey);
assert.equal(fromKey.start.toISOString(), augustAtClose.start.toISOString());
assert.equal(fromKey.end.toISOString(), augustAtClose.end.toISOString());

const civil = parseDate("2026-09-01");
assert.ok(civil);
assert.equal(civil.toISOString(), "2026-09-01T03:00:00.000Z");
const explicitUtc = parseDate("2026-09-01T03:00:00.000Z");
assert.ok(explicitUtc);
assert.equal(dateKey(explicitUtc), "2026-09-01");

const sentinel = { __serverTimestamp: true };
assert.deepEqual(publishedAtForCreate(false, true, sentinel), { publishedAt: sentinel });
assert.deepEqual(publishedAtForCreate(true, true, sentinel), {}, "rerun não pode sobrescrever publishedAt");
assert.deepEqual(publishedAtForCreate(false, false, sentinel), {}, "histórico sem evidência não recebe publishedAt");
const existingPublication = { publishedAt: "2026-09-01T00:00:00.000Z", sortAt: "old" };
const rerunUpdate = { sortAt: "new" };
const mergedRerun = { ...existingPublication, ...rerunUpdate };
assert.equal(mergedRerun.publishedAt, existingPublication.publishedAt, "rerun preserva publishedAt");
assert.equal(mergedRerun.sortAt, "new", "rerun pode recalcular somente sortAt");

const childScript = [
  "const c=require('./lib/rankingCalendar.js');",
  "const d=new Date('2026-09-01T02:59:59.999Z');",
  "const p=c.periodForDate(new Date('2026-08-15T15:00:00.000Z'),'mes',new Date('2026-09-01T03:00:00.000Z'));",
  "process.stdout.write(JSON.stringify({key:p&&p.key,date:c.dateKey(d),start:p&&p.start.toISOString(),end:p&&p.end.toISOString()}));",
].join("\n");
const expected = {
  key: "mes_2026-08",
  date: "2026-08-31",
  start: "2026-08-01T03:00:00.000Z",
  end: "2026-09-01T02:59:59.999Z",
};
for (const tz of ["UTC", "America/New_York", "Pacific/Auckland"]) {
  const result = spawnSync(process.execPath, ["-e", childScript], {
    cwd: require("node:path").join(__dirname, ".."),
    env: { ...process.env, TZ: tz },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `process TZ ${tz} deve concluir sem erro`);
  assert.deepEqual(JSON.parse(result.stdout), expected, `process TZ ${tz} não pode alterar o período`);
}

console.log(JSON.stringify({
  ok: true,
  timezone: RANKING_TIME_ZONE,
  monthBoundary: "31/08 23:59:59.999 São Paulo -> aberto; 01/09 00:00 São Paulo -> agosto elegível",
  publicationPolicy: "publishedAt somente na primeira criação automática; histórico sem evidência permanece sem campo",
  processTimezones: ["UTC", "America/New_York", "Pacific/Auckland"],
}, null, 2));
