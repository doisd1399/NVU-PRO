import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  rankingPickerBusinessDate, rankingPickerDateKey, rankingPickerDateFromKey,
  rankingPeriodPickerRange, rankingPeriodSelectionFromPicker,
} from "../src/lib/rankingPeriodSelection.ts";
import { getRankingUtcCustomRange } from "../src/lib/rankingPeriods.ts";

if (!process.env.NVU_PERIOD_TEST_CHILD) {
  for (const TZ of ["UTC", "America/Sao_Paulo", "America/Los_Angeles", "Pacific/Kiritimati"]) {
    execFileSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url)], {
      stdio: "inherit", env: { ...process.env, TZ, NVU_PERIOD_TEST_CHILD: "1" },
    });
  }
} else {
  for (const key of ["2024-02-29", "2026-10-18", "2026-12-31", "2027-01-01"]) {
    assert.equal(rankingPickerDateKey(rankingPickerDateFromKey(key)), key);
  }
  for (const key of ["", "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-10-00", "2026-1-1"]) {
    assert.equal(rankingPickerDateFromKey(key), undefined, key);
  }
  assert.equal(rankingPickerDateKey(new Date(NaN)), "");
  const reference = new Date("2026-11-01T01:00:00Z"); // Still October in São Paulo.
  assert.equal(rankingPickerDateKey(rankingPickerBusinessDate(reference)), "2026-10-31");
  const keys = range => [rankingPickerDateKey(range.from), rankingPickerDateKey(range.to)];
  assert.deepEqual(keys(rankingPeriodPickerRange("mes", "", "", reference)), ["2026-10-01", "2026-10-31"]);
  assert.deepEqual(keys(rankingPeriodPickerRange("semana", "", "", reference)), ["2026-10-25", "2026-10-31"]);
  assert.deepEqual(keys(rankingPeriodPickerRange("custom", "2027-01-05", "2026-12-30", reference)), ["2026-12-30", "2027-01-05"]);
  assert.deepEqual(keys(rankingPeriodPickerRange("custom", "invalid", "2026-10-32", reference)), ["2026-10-01", "2026-10-31"]);
  assert.equal(rankingPeriodSelectionFromPicker({ from: new Date(2026, 9, 18) }, "custom"), null);
  assert.equal(rankingPeriodSelectionFromPicker({ from: new Date(NaN), to: new Date() }, "custom"), null);
  const same = rankingPeriodSelectionFromPicker({ from: new Date(2026, 9, 18), to: new Date(2026, 9, 18) }, "custom");
  assert.deepEqual(same, { preset: "custom", startDate: "2026-10-18", endDate: "2026-10-18" });
  const day = getRankingUtcCustomRange(same.startDate, same.endDate);
  assert.equal(day.start.toISOString(), "2026-10-18T03:00:00.000Z");
  assert.equal(day.end.toISOString(), "2026-10-19T02:59:59.999Z");
  const reversed = rankingPeriodSelectionFromPicker({ from: new Date(2027, 0, 5), to: new Date(2026, 11, 30) }, "custom");
  assert.deepEqual(reversed, { preset: "custom", startDate: "2026-12-30", endDate: "2027-01-05" });
  const span = getRankingUtcCustomRange(reversed.startDate, reversed.endDate);
  assert.equal(span.start.toISOString(), "2026-12-30T03:00:00.000Z");
  assert.equal(span.end.toISOString(), "2027-01-06T02:59:59.999Z");
  console.log(`PASS ranking period civil dates, inclusive bounds, leap day and reversed range: ${process.env.TZ}`);
}
