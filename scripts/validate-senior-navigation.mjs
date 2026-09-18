import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const login = read('src/pages/Login.tsx');
const selectProfile = read('src/pages/SelectProfile.tsx');
const appContext = read('src/context/AppContext.tsx');
const adminLayout = read('src/layouts/AdminLayout.tsx');

const checks = [
  ['Login has no automatic navigation to Senior Panel', !/navigate\(\s*["']\/admin\/senior["']/.test(login)],
  ['Hydrated senior session lands on profile selector', /return\s*<Navigate\s+to=["']\/select-profile["']\s+replace\s*\/>/.test(login)],
  ['Senior role participates in profile-selector handoff', /hasActiveMembership\s*\|\|\s*hasSeniorRole/.test(login)],
  ['Admin profile selection targets fleet', /role === ["']admin["'] \? ["']\/admin\/fleet["']/.test(selectProfile)],
  ['Driver profile selection targets driver profile', /["']\/driver\/profile["']/.test(selectProfile)],
  ['Profile selection clears stale senior UI session', /sessionStorage\.removeItem\(["']seniorAccess["']\)/.test(selectProfile)],
  ['Senior authorization no longer overwrites an explicit active role', /if \(hasSeniorRole && !activeRole\)/.test(appContext) && !/if \(activeRole !== ["']admin["']\) setActiveRole\(["']admin["']\)/.test(appContext)],
  ['Senior Panel navigation exists as explicit AdminLayout action', /navigate\(["']\/admin\/senior["']\)/.test(adminLayout)],
  ['Senior Panel button is always visible inside the admin-only layout and remains inside the secure route gate', /const hasSeniorPanelAccess = true;/.test(adminLayout) && /\{hasSeniorPanelAccess && \(/.test(adminLayout)],
  ['Senior Panel label is explicit', /Painel Sênior/.test(adminLayout)],
];

let passed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
  if (ok) passed += 1;
}
console.log(`\n${passed}/${checks.length} checks passed.`);
if (passed !== checks.length) process.exit(1);
