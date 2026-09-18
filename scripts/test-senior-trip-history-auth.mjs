import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = fs.readFileSync(
  path.join(root, "src/pages/driver/TripHistory.tsx"),
  "utf8",
);

const checks = [
  [
    "TripHistory consome a sessão Senior validada",
    /const \{ currentUser, activeRole, isSeniorAuthenticated \} = useSessionStore\(\);/,
  ],
  [
    "sessionStorage permanece apenas como compatibilidade",
    /const legacySeniorAccess = sessionStorage\.getItem\("seniorAccess"\) === "true";/,
  ],
  [
    "autorização Senior combina a sessão validada com o legado",
    /const isSeniorAccess = isSeniorAuthenticated \|\| legacySeniorAccess;/,
  ],
  [
    "edição de valor continua protegida pela autorização Senior",
    /if \(isSeniorAccess\)[\s\S]{0,900}valorEditadoNoPainelSenior/,
  ],
];

for (const [label, pattern] of checks) {
  if (!pattern.test(source)) throw new Error(`FAIL: ${label}`);
  console.log(`PASS: ${label}`);
}

console.log(`SENIOR TRIP HISTORY AUTH PASS (${checks.length}/${checks.length})`);
