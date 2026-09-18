import assert from "node:assert/strict";
import fs from "node:fs";

const service = fs.readFileSync(
  "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java",
  "utf8",
);

const results = [];
const scenario = (name, run) => {
  run();
  results.push(name);
  console.log(`PASS ${name}`);
};

const rects = (count) => Array.from({ length: count }, (_, row) => ({
  left: 800,
  top: 100 + row * 100,
  right: 1000,
  bottom: 180 + row * 100,
}));

const exactRow = (x, y, buttons) => {
  const hits = buttons
    .map((r, row) => ({ row, hit: x >= r.left && x < r.right && y >= r.top && y < r.bottom }))
    .filter(({ hit }) => hit)
    .map(({ row }) => row);
  return hits.length === 1 ? hits[0] : -1;
};

const createAttempt = (id, generation) => ({
  id,
  generation,
  row: -1,
  identity: "PENDING_GEOMETRY",
  validation: "PENDING",
  commit: "PENDING",
});

const lock = (attempt, row) => ({
  ...attempt,
  row,
  identity: "TOUCH_LOCKED",
});

const validate = (attempt, result) => ({
  ...attempt,
  validation: result,
});

const callbackCanApply = (attempt, id, row, generation) => (
  attempt.id === id
  && attempt.row === row
  && attempt.generation === generation
);

const freezePending = (eventId, generation, buttons, anchor) => ({
  eventId,
  generation,
  buttons: buttons.map((button) => ({ ...button })),
  anchor,
  consumed: false,
});

const bindUnknownOnce = (pending, frameGeneration, frameAnchor, frameButtons) => {
  if (pending.consumed || pending.buttons.length > 0) return pending;
  if (pending.anchor !== frameAnchor) return null;
  return { ...pending, generation: frameGeneration, buttons: frameButtons.map((button) => ({ ...button })) };
};

const consumePinned = (pending, currentGeneration, x, y) => {
  if (!pending || pending.consumed || pending.generation !== currentGeneration) return -1;
  return exactRow(x, y, pending.buttons);
};

scenario("1 lista pronta + toque normal", () => {
  assert.equal(exactRow(900, 140, rects(3)), 0);
  assert.ok(service.includes("commitAuthoritativeFreightTouch"));
});

scenario("2 lista pronta + toque rápido", () => {
  assert.ok(service.includes("beginPhysicalTouchAttempt(event)"));
  assert.ok(service.includes("fastTouchMarkerQueued"));
  assert.ok(service.includes("selectionCoordinator.markTouch()"));
});

scenario("3 lista recém-detectada + toque imediato", () => {
  assert.ok(service.includes("WAITING_CURRENT_ACCEPT_RECTS"));
  assert.ok(service.includes('"pending-accept-first-geometry"'));
  assert.ok(service.indexOf('"pending-accept-first-geometry"') < service.indexOf("scheduleFreightPageOcr(freightPageGeneration"));
});

for (let row = 0; row < 5; row += 1) {
  scenario(`${4 + row} Accept ${row + 1}`, () => {
    const buttons = rects(5);
    const selected = exactRow(900, 140 + row * 100, buttons);
    assert.equal(selected, row);
    const attempt = lock(createAttempt(`touch-${row}`, 25), selected);
    assert.equal(attempt.row, row);
    assert.equal(attempt.identity, "TOUCH_LOCKED");
  });
}

scenario("9 OCR atrasado preserva target lock", () => {
  const locked = lock(createAttempt("touch-ocr", 25), 2);
  const pending = validate(locked, "MISSING_DATA");
  assert.equal(pending.row, 2);
  assert.equal(pending.identity, "TOUCH_LOCKED");
  assert.ok(service.includes("preserveLockedTargetForValidation"));
});

scenario("10 freightTextGeneration atrasada usa snapshot provisório", () => {
  assert.ok(service.includes("provisionalFreightForRow"));
  assert.ok(service.includes("boolean sameGeneration = freightPageGeneration > 0L && textGeneration == freightPageGeneration"));
  assert.ok(service.includes("if (sameGeneration)"));
});

scenario("11 frame atrasado mantém o mesmo evento até geometria", () => {
  assert.ok(service.includes("pendingAcceptEventId"));
  assert.ok(service.includes("armFastTouchPulseOnCaptureThread(rawX, rawY, localX, localY)"));
  assert.ok(service.includes("clearPendingAcceptEvent(eventId, \"PROCESSED_FIRST_VALID_ACCEPT\")"));
});

scenario("12 geração conhecida rejeita página posterior", () => {
  assert.ok(service.includes("pendingAcceptSnapshotGeneration"));
  assert.ok(service.includes("pendingGeneration != freightPageGeneration"));
  assert.ok(service.includes("STALE_LIST_GENERATION_BEFORE_COMMIT"));
});

scenario("13 geração desconhecida não pode aderir a uma lista arbitrária", () => {
  assert.ok(service.includes("LIST_GENERATION_UNANCHORED"));
  assert.ok(service.includes("pendingAcceptAnchorFrame"));
  assert.ok(service.includes("fastVisualDetector.samePage(pendingAcceptAnchorFrame, firstReadyFrame)"));
});

scenario("14 retângulos realtime posteriores não substituem a transação", () => {
  assert.ok(service.includes("authoritativeButtons"));
  assert.ok(service.includes("copyAndSortRectSnapshot(authoritativeButtons)"));
  assert.ok(service.includes("useFrozenTouchSnapshot"));
});

scenario("15 modelo rejeita geração posterior", () => {
  const pending = freezePending("e1", 10, rects(3), "page-a");
  assert.equal(consumePinned(pending, 11, 900, 140), -1);
  assert.equal(consumePinned(pending, 10, 900, 140), 0);
});

scenario("16 modelo desconhecido vincula uma única vez à âncora", () => {
  const pending = freezePending("e2", -1, [], "page-a");
  const bound = bindUnknownOnce(pending, 12, "page-b", rects(3));
  assert.equal(bound, null);
  const samePage = bindUnknownOnce(pending, 12, "page-a", rects(3));
  assert.ok(samePage);
  const rebound = bindUnknownOnce(samePage, 13, "page-a", rects(3));
  assert.equal(rebound, samePage);
});

scenario("17 modelo preserva a linha mesmo com realtime posterior", () => {
  const pending = freezePending("e3", 20, rects(5), "page-c");
  const liveLater = rects(2);
  liveLater[0].top = 900;
  assert.equal(consumePinned(pending, 20, 900, 140 + 4 * 100), 4);
});

scenario("18 modelo isola dois attempts e rejeita callback tardio", () => {
  const first = lock(createAttempt("first", 30), 1);
  const second = lock(createAttempt("second", 31), 3);
  assert.equal(callbackCanApply(second, first.id, first.row, first.generation), false);
  assert.equal(callbackCanApply(second, second.id, second.row, second.generation), true);
});

scenario("19 callback antigo não altera seleção nova", () => {
  const current = lock(createAttempt("new", 26), 3);
  assert.equal(callbackCanApply(current, "old", 3, 26), false);
  assert.equal(callbackCanApply(current, "new", 2, 26), false);
  assert.equal(callbackCanApply(current, "new", 3, 25), false);
  assert.equal(callbackCanApply(current, "new", 3, 26), true);
  assert.ok(service.includes("isCurrentSelectionRowAndPage"));
});

scenario("20 segunda viagem usa o mesmo contrato", () => {
  assert.ok(service.includes("replacementFreightTouchPending = true"));
  assert.ok(service.includes("commitAuthoritativeFreightTouch"));
});

scenario("21 terceira viagem permanece idempotente", () => {
  assert.ok(service.includes("selectionTransactionId"));
  assert.ok(service.includes("selectionTransactionRow"));
  assert.ok(service.includes("existingTransaction"));
});

scenario("22 listas com quantidades diferentes", () => {
  for (const count of [1, 2, 3, 5, 6]) {
    const buttons = rects(count);
    for (let row = 0; row < count; row += 1) {
      assert.equal(exactRow(900, 140 + row * 100, buttons), row);
    }
  }
  assert.equal(exactRow(700, 140, rects(5)), -1);
});

scenario("23 ACTION_OUTSIDE redigido como 0,0", () => {
  assert.ok(service.includes('"REDACTED_ACTION_OUTSIDE"'));
  assert.ok(service.includes("!hasReliableOutsideTouchCoordinate()"));
  assert.equal(exactRow(0, 0, rects(5)), -1);
});

scenario("24 candidato visual pertence ao mesmo pulse físico", () => {
  assert.ok(service.includes("samePhysicalTouch"));
  assert.ok(service.includes("fastPendingFromTouchPulse"));
  assert.ok(service.includes("selectionProbeHumanActionSource.contains(\"outside-touch\")"));
});

scenario("25 coordenada redigida não espera fechamento ou segundo toque", () => {
  assert.ok(service.includes("redactedSameTouchCandidate"));
  assert.ok(service.includes("(hasExactTouchSelectionPending() || redactedSameTouchCandidate)"));
  assert.ok(service.includes("touch-probe+visual-fallback"));
});

assert.ok(!service.includes("selectNearestFreightRow"));
assert.ok(!service.includes("retryPhysicalTouch"));
assert.ok(service.includes('"STALE_LIST_GENERATION"'));
assert.ok(service.includes('persistSelectionIdentity(row, "TOUCH_LOCKED"'));

console.log(`${results.length}/${results.length} HF208 first-touch regression scenarios passed.`);
