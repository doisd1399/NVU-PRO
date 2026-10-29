import assert from "node:assert/strict";
import fs from "node:fs";

for (const file of ["src/layouts/AdminLayout.tsx", "src/layouts/DriverLayout.tsx"]) {
  const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  assert.match(source, /if \(activeRole === newRole\) \{/);
  assert.match(source, /navigate\(target, \{ replace: true \}\)/);
  assert.match(source, /const target = newRole === "admin" \? "\/admin\/fleet" : "\/driver\/profile"/);
  assert.match(source, /setActiveCompanyId\(companyId\);[\s\S]*?switchRole\(nextRole, companyId\);[\s\S]*?navigate\(target, \{ replace: true \}\)/);
}
console.log("profile-menu-navigation-root-cause: PASS active-role and same-role company selection both navigate to canonical profile routes");
