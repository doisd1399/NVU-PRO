import assert from "node:assert/strict";
import fs from "node:fs";

const driver = fs.readFileSync(new URL("../src/layouts/DriverLayout.tsx", import.meta.url), "utf8");
const company = fs.readFileSync(new URL("../src/layouts/AdminLayout.tsx", import.meta.url), "utf8");
const globalMenu = fs.readFileSync(new URL("../src/components/GlobalMenu.tsx", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

assert.equal((driver.match(/<aside\b/g) || []).length, 0, "DriverLayout não deve possuir menu local");
assert.equal((company.match(/<aside\b/g) || []).length, 0, "AdminLayout não deve possuir menu local");
assert.equal((globalMenu.match(/<aside\b/g) || []).length, 1, "GlobalMenu deve possuir o único aside do menu");
assert.match(driver, /<GlobalMenu[\s\S]*profile="driver"/);
assert.match(company, /<GlobalMenu[\s\S]*profile="company"/);
assert.match(globalMenu, /data-nvu-unified-profile-menu=\{profile\}/);
assert.match(globalMenu, /data-nvu-menu-open=\{open \? "true" : "false"\}/);
assert.match(css, /\[data-nvu-unified-profile-menu\]\[data-nvu-menu-open="true"\][\s\S]*translate\(-50%, 0\)/);
assert.match(globalMenu, /nvu-floating-menu-card nvu-profile-menu-card/);
assert.match(globalMenu, /nvu-profile-logout-button/);
assert.match(globalMenu, /nvu-driver-logout-button/);
assert.match(globalMenu, /nvu-admin-logout-button/);
assert.match(css, /\.nvu-native-android \.nvu-profile-logout-button[\s\S]*color: #be123c/);
assert.match(css, /\.nvu-native-android \.nvu-admin-logout-button[\s\S]*color: #be123c/);
assert.match(css, /\.nvu-native-android \.nvu-native-sidebar[\s\S]*left: 50%/);
assert.match(css, /\.nvu-native-android \.nvu-admin-sidebar[\s\S]*left: 50%/);
assert.match(app, /path="\/admin"[\s\S]*<AdminLayout \/>/);
assert.match(app, /path="\/driver"[\s\S]*<DriverLayout \/>/);
console.log("unified-profile-menu: PASS single Driver/Company source, centered menu and red logout");
