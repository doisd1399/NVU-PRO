import assert from "node:assert/strict";
import fs from "node:fs";

const recordTrip = fs.readFileSync(new URL("../src/pages/driver/RecordTrip.tsx", import.meta.url), "utf8");
const globalMenu = fs.readFileSync(new URL("../src/components/GlobalMenu.tsx", import.meta.url), "utf8");
const controller = fs.readFileSync(new URL("../src/components/common/NvuStatusBarController.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

assert.doesNotMatch(recordTrip, /SystemBars|SystemBarType|useTheme|isNativeAndroid/);
assert.match(controller, /The NVU theme is the only authority/);
assert.match(controller, /location\.key/);
assert.match(controller, /theme === "dark"/);
assert.match(controller, /SystemBarsStyle\.Light/);
assert.match(controller, /isProfileBannerRoute/);
assert.match(controller, /SystemBarType\.StatusBar/);
assert.match(globalMenu, /data-nvu-menu-open=\{open \? "true" : "false"\}/);
assert.match(css, /\[data-nvu-unified-profile-menu\]\[data-nvu-menu-open="true"\]/);
assert.match(css, /\[data-nvu-unified-profile-menu\]\[data-nvu-menu-open="false"\]/);

console.log("recordtrip-menu-statusbar: PASS Print shell, menu state and global NVU theme status bar");
