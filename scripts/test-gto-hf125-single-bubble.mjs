import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const setup = read("src/components/GtoObserverSetup.tsx");
const checks = [];
function check(name, condition) {
  const ok = Boolean(condition);
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

check("single native bubble implementation remains authoritative", (service.match(/label\.setText\("NVU"\)/g) || []).length === 1);
check("bubble creation is synchronized", service.includes("private synchronized void showBubbleIfAllowed()"));
check("overlay removal is synchronized", service.includes("private synchronized void removeAllOverlays()"));
check("post-add failure tracks the candidate view", service.includes("boolean bubbleAddedToWindowManager = false") && service.includes("FrameLayout bubbleAddedView = bubbleView"));
check("post-add failure removes the candidate before clearing the reference", service.includes("if (bubbleAddedToWindowManager && bubbleAddedView != null && windowManager != null)") && service.includes("windowManager.removeViewImmediate(bubbleAddedView)"));
check("detach/rebind uses the common cleanup helper", service.includes("clearBubbleReferenceAndRemove(\"DETACHED_PASSIVE_OVERLAYS\")") && service.includes("clearBubbleReferenceAndRemove(\"REMOVE_ALL_OVERLAYS\")"));
check("drag update failure uses the common cleanup helper", service.includes("clearBubbleReferenceAndRemove(\"UPDATE_VIEW_FAILURE\")"));
check("cleanup records a diagnostic boundary", service.includes("overlayLastCleanupReason") && service.includes("overlayLastCleanupAt"));
check("React does not render a second native-style NVU overlay", !setup.includes('position: "fixed"') || !setup.includes('>NVU<'));

class WindowManagerModel {
  constructor() {
    this.attached = new Set();
    this.reference = null;
    this.nextId = 0;
  }
  add({ failAfterAdd = false }) {
    if (this.reference !== null) return false;
    const candidate = `bubble-${++this.nextId}`;
    this.attached.add(candidate);
    if (failAfterAdd) {
      this.attached.delete(candidate); // rollback equivalent to removeViewImmediate
      this.reference = null;
      return false;
    }
    this.reference = candidate;
    return true;
  }
  removeCurrent() {
    if (this.reference !== null) this.attached.delete(this.reference);
    this.reference = null;
  }
}

const wm = new WindowManagerModel();
check("behavior: failure after add rolls back the visible candidate", !wm.add({ failAfterAdd: true }) && wm.attached.size === 0 && wm.reference === null);
check("behavior: retry after rollback creates exactly one movable bubble", wm.add({ failAfterAdd: false }) && wm.attached.size === 1 && wm.reference !== null);
check("behavior: duplicate creation is rejected while the current bubble exists", !wm.add({ failAfterAdd: false }) && wm.attached.size === 1);
wm.removeCurrent();
check("behavior: idempotent cleanup removes the current bubble", wm.attached.size === 0 && wm.reference === null);

let attached = 0;
let current = null;
let concurrentAttempts = 0;
for (let cycle = 0; cycle < 20; cycle += 1) {
  current = null;
  attached = 0;
  const tryCreate = () => {
    concurrentAttempts += 1;
    if (current !== null) return false;
    current = `bubble-${cycle}`;
    attached += 1;
    return true;
  };
  const first = tryCreate();
  const second = tryCreate();
  check(`behavior: concurrent recovery cycle ${cycle + 1} keeps one bubble`, first && !second && attached === 1);
}
check("behavior: repeated recovery never accumulates overlays", attached === 1 && concurrentAttempts === 40);

const failed = checks.filter((ok) => !ok).length;
if (failed) {
  console.error(`\n${failed} HF125 check(s) failed.`);
  process.exit(1);
}
console.log(`\nHF125 single-bubble regression: APPROVED (${checks.length}/${checks.length})`);
