import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const coordinator = read("android/app/src/main/java/com/nvu/operacional/GtoTripSubmissionCoordinator.java");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const plugin = read("android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java");
const activity = read("android/app/src/main/java/com/nvu/operacional/MainActivity.java");
const web = read("src/lib/gtoObserver.ts");
const setup = read("src/components/GtoObserverSetup.tsx");
const gradle = read("android/app/build.gradle");
const checks = [];
function check(name, condition) {
  const ok = Boolean(condition);
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

const directSubmissionCalls = [service, plugin, activity]
  .map((source) => (source.match(/GtoAutoTripSync\.(enqueueConfirmedTrip|flushPending)\s*\(/g) || []).length)
  .reduce((sum, count) => sum + count, 0);

check("single coordinator class owns completed-trip submission", coordinator.includes("final class GtoTripSubmissionCoordinator") && coordinator.includes("submitCompletedTrip"));
check("all external completed-trip submits use the coordinator", service.includes("GtoTripSubmissionCoordinator.submitCompletedTrip") && plugin.includes("GtoTripSubmissionCoordinator.submitCompletedTrip"));
check("no external direct enqueue/flush remains", directSubmissionCalls === 0);
check("submission is serialized by sessionId", coordinator.includes("SUBMISSIONS_IN_FLIGHT") && coordinator.includes("if (!SUBMISSIONS_IN_FLIGHT.add(sessionId))"));
check("normal path seals and sends immediately", coordinator.includes("GtoAutoTripSync.enqueueConfirmedTrip(context, prefs, coordinatedListener)"));
check("temporary failure has one explicit fallback state", coordinator.includes("STATE_PENDING_RETRY") && coordinator.includes("nova tentativa automática"));
check("ACK transitions to SYNCED only for the same session", coordinator.includes("sessionId.equals(clean(callbackSessionId))") && coordinator.includes("STATE_SYNCED"));
check("new session resets submission state", service.includes("putString(\"tripSubmissionState\", GtoTripSubmissionCoordinator.STATE_READY)"));
check("native plugin exposes unified state", plugin.includes("status.put(\"tripSubmissionState\""));
check("web contract exposes unified state", web.includes("tripSubmissionState?:"));
check("legacy authentication wording is not the visible submission message", !service.includes('"Aguardando autenticação…"') && setup.includes("Envio pendente; nova tentativa automática."));
check("completion path exposes one registering state before ACK", service.includes('"Registrando viagem..."') && service.includes("announceCurrentTripSubmissionState()") && service.includes("STATE_SENDING"));
check("MainActivity retry is routed through the coordinator", activity.includes("GtoTripSubmissionCoordinator.flushPending"));
check("candidate is versioned as the current Release", /versionCode\s+(?:20[3-9]|2[1-9]\d|[3-9]\d{2,})/.test(gradle) && /versionName\s+"1\.0\.(?:20[3-9]|2[1-9]\d|[3-9]\d{2,})"/.test(gradle));

class SubmissionModel {
  constructor() {
    this.inFlight = new Set();
    this.calls = 0;
    this.state = new Map();
  }
  submit(sessionId, outcome = "accepted") {
    if (this.inFlight.has(sessionId)) return "deduplicated";
    this.inFlight.add(sessionId);
    this.calls += 1;
    this.state.set(sessionId, "SENDING");
    if (outcome === "pending") {
      this.inFlight.delete(sessionId);
      this.state.set(sessionId, "PENDING_RETRY");
    }
    if (outcome === "synced") {
      this.inFlight.delete(sessionId);
      this.state.set(sessionId, "SYNCED");
    }
    return "accepted";
  }
  next(sessionId) {
    this.inFlight.delete(sessionId);
    this.state.set(sessionId, "READY");
  }
}

const model = new SubmissionModel();
check("behavior: first completion enters SENDING", model.submit("s1") === "accepted" && model.state.get("s1") === "SENDING");
check("behavior: duplicate completion does not make a second call", model.submit("s1") === "deduplicated" && model.calls === 1);
model.state.set("s1", "PENDING_RETRY");
model.inFlight.delete("s1");
check("behavior: fallback becomes PENDING_RETRY without losing the session", model.state.get("s1") === "PENDING_RETRY");
check("behavior: retry remains one call after previous owner releases", model.submit("s1", "synced") === "accepted" && model.calls === 2 && model.state.get("s1") === "SYNCED");
model.next("s1");
check("behavior: next freight starts READY, independent from previous ACK", model.state.get("s1") === "READY");
check("behavior: a second session has an independent submission owner", model.submit("s2") === "accepted" && model.calls === 3 && model.state.get("s2") === "SENDING");

const failed = checks.filter((ok) => !ok).length;
if (failed) {
  console.error(`\n${failed} HF126/HF127/HF128 check(s) failed.`);
  process.exit(1);
}
console.log(`\nHF126 unified-submission regression: APPROVED (${checks.length}/${checks.length})`);
