import assert from "node:assert/strict";
import {
  getProLaunchAvailability,
  type ProLaunchContext,
} from "../src/lib/proLaunchAvailability";

const context = (status: string, progress: number, total = 12): ProLaunchContext => ({
  job: { status, progress },
  totalDeliveries: total,
  hasContract: true,
  hasUser: true,
  hasCompany: true,
});

const pending = getProLaunchAvailability(context("pending", 0));
assert.equal(pending.state, "pending");
assert.equal(pending.canLaunch, false);
assert.match(pending.message, /aguardando início/i);

const ready = getProLaunchAvailability(context("active", 4));
assert.equal(ready.state, "ready");
assert.equal(ready.canLaunch, true);
assert.equal(ready.message, "");

const delayed = getProLaunchAvailability(context("delayed", 4));
assert.equal(delayed.state, "ready");
assert.equal(delayed.canLaunch, true);

const awaiting = getProLaunchAvailability(context("awaiting_completion", 4));
assert.equal(awaiting.state, "awaiting-completion");
assert.equal(awaiting.canLaunch, true);

const closed = getProLaunchAvailability(context("completed", 12));
assert.equal(closed.state, "closed");
assert.equal(closed.canLaunch, false);
assert.match(closed.message, /concluída ou encerrada/i);

const missing = getProLaunchAvailability({
  job: null,
  totalDeliveries: 0,
  hasContract: false,
  hasUser: true,
  hasCompany: true,
});
assert.equal(missing.state, "missing-operation");
assert.equal(missing.canLaunch, false);
assert.match(missing.message, /Inicie uma operação/i);

const incomplete = getProLaunchAvailability({
  ...context("active", 1),
  hasContract: false,
});
assert.equal(incomplete.state, "invalid-context");
assert.equal(incomplete.canLaunch, false);
assert.match(incomplete.message, /confirmar o contexto/i);

console.log("[test-pro-launch-availability] PASS");
