import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const servicePath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const layoutPath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoOverlayLayoutPolicy.java");
const service = fs.readFileSync(servicePath, "utf8");
const layout = fs.readFileSync(layoutPath, "utf8");

let passed = 0;
const checks = [];
function check(name, ok) {
  checks.push({ name, ok: Boolean(ok) });
  if (ok) passed += 1;
}

const safeRight = service.slice(service.indexOf("private int freightOverlaySafeRight"), service.indexOf("private void keepOverlaysClearOfFreightPanel"));
const initial = service.slice(service.indexOf("private void applyInitialGtoBubblePosition"), service.indexOf("private boolean rebaseBubbleLayoutForCurrentDisplay"));

check("panel boundary reads current list timestamp", safeRight.includes("long listAt = lastFreightListSeenAt > 0L"));
check("panel boundary requires a positive panel timestamp", safeRight.includes("panelAt <= 0L"));
check("panel boundary requires a positive current-list timestamp", safeRight.includes("listAt <= 0L"));
check("panel boundary rejects panel timestamps older than the current list", safeRight.includes("Math.abs(panelAt - listAt) > 1200L"));
check("panel boundary rejects stale current-list evidence", safeRight.includes("now - listAt > 1200L"));
check("initial placement still uses the reference X anchor", initial.includes("GtoOverlayLayoutPolicy.referenceTopX"));
check("initial placement still uses the reference Y anchor", initial.includes("GtoOverlayLayoutPolicy.referenceTopY"));
check("defaults are not treated as explicit user drags", initial.includes("hasExplicitUserGtoBubblePosition()") && service.includes('"USER_DRAG_GTO_LANDSCAPE"'));
check("reference policy remains responsive", layout.includes("referenceTopX") && layout.includes("referenceTopY"));
check("no direct raw panel cache is used without freshness guards", !safeRight.includes("return clamp(panelLeft - dp(8), dp(72), screen.widthPixels);\n    }\n\n    private void keepOverlaysClearOfFreightPanel") || safeRight.includes("now - listAt > 1200L"));

for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}`);
console.log(`HF187 reference-position-current-panel: ${passed}/${checks.length}`);
if (passed !== checks.length) process.exit(1);
