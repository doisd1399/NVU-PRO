import fs from "node:fs";
import assert from "node:assert/strict";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const driver = read("../src/layouts/DriverLayout.tsx");
const admin = read("../src/layouts/AdminLayout.tsx");
const ranking = read("../src/pages/RankingGlobal.tsx");
const app = read("../src/App.tsx");
const menu = read("../src/components/GlobalMenu.tsx");
const service = read("../android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java");
const plugin = read("../android/app/src/main/java/com/nvu/operacional/SimpleAutomationPlugin.java");

for (const source of [driver, admin]) {
  assert.match(source, /nvu-toggle-shell-menu/);
  assert.match(source, /setIsMobileMenuOpen\(\(open\) => !open\)/);
  assert.doesNotMatch(source, /handleOpenShellMenu = \(\) => setIsMobileMenuOpen\(true\)/);
}
assert.match(ranking, /nvu-toggle-shell-menu/);
assert.doesNotMatch(ranking, /nvu-open-shell-menu/);
assert.match(app, /function RankingShellRoute\(\)/);
assert.match(app, /<AdminLayout>\{ranking\}<\/AdminLayout>/);
assert.match(app, /<DriverLayout>\{ranking\}<\/DriverLayout>/);
assert.match(menu, /data-nvu-menu-overlay/);
assert.match(service, /removeBubbleForSensitiveScreen\("MEDIA_PROJECTION_CONSENT"\)/);
assert.match(service, /removeViewImmediate\(bubbleView\)/);
assert.match(service, /putBoolean\("captureUiHidden", true\)/);
assert.match(service, /overlayLastError.*overlay-permission|overlayLastError.*overlay-permission/);
assert.match(plugin, /TYPE_APPLICATION_OVERLAY/);
assert.match(plugin, /projectionPermissionState/);

console.log("PASS: shell toggle, shared Ranking GlobalMenu and sensitive-screen overlay contract");
