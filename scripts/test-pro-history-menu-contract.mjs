import fs from "node:fs";
import assert from "node:assert/strict";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const service = read("../android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java");
const coordinator = read("../android/app/src/main/java/com/nvu/operacional/SimpleProNativeSubmissionCoordinator.java");
const plugin = read("../android/app/src/main/java/com/nvu/operacional/SimpleAutomationPlugin.java");
const menu = read("../src/components/GlobalMenu.tsx");
const bridge = read("../src/components/SimpleAutomationCompletionBridge.tsx");

assert.match(service, /FLAG_WATCH_OUTSIDE_TOUCH/);
const menuWindow = service.match(/menuParams = new WindowManager\.LayoutParams\([\s\S]*?menuParams\.gravity = Gravity\.TOP \| Gravity\.START;/)?.[0] || "";
assert.notEqual(menuWindow, "", "menu window params must be present");
assert.doesNotMatch(menuWindow, /FLAG_NOT_TOUCH_MODAL/);
assert.match(service, /ACTION_OUTSIDE\) \{[\s\S]*closeMenu\(\);[\s\S]*return true;/);
assert.match(service, /historyExpanded/);
assert.match(service, /historyMenuButton\(\)/);
assert.match(service, /operationHistoryJson/);
assert.match(service, /historyScopeJobId/);
assert.match(service, /safe\(tripId\).*duplicate|duplicate.*safe\(tripId\)/);
assert.match(service, /VIAGEM REGISTRADA/);
assert.match(coordinator, /recordConfirmedTrip\(/);
assert.match(plugin, /public void recordConfirmedTrip/);
assert.match(bridge, /await SimpleAutomation\.recordConfirmedTrip/);
assert.match(bridge, /history_updated/);
assert.match(menu, /event\.preventDefault\(\)/);
assert.match(menu, /event\.stopPropagation\(\)/);

console.log("PASS: Pro history source, confirmation gate, idempotency and touch-safe menu contract");
