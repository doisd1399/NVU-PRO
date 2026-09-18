import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const recordTrip = fs.readFileSync(
  path.join(root, "src/pages/driver/RecordTrip.tsx"),
  "utf8",
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);

const checks = [
  [
    "GTO print does not use the predefined route lock",
    recordTrip.includes("{predefinedRoutes && !isGtoPrintMode ? ("),
  ],
  [
    "origin input is explicitly editable",
    recordTrip.includes('aria-label="Origem da rota"')
      && recordTrip.includes("readOnly={false}"),
  ],
  [
    "destination input is explicitly editable",
    recordTrip.includes('aria-label="Destino da rota"')
      && recordTrip.includes("aria-label=\"Destino da rota\""),
  ],
  [
    "OCR value still blocks manual value changes",
    recordTrip.includes("if (valorDetectadoAutomaticamente) return;"),
  ],
  [
    "automatic OCR value remains read-only in the rendered input",
    recordTrip.includes("readOnly={valorDetectadoAutomaticamente}"),
  ],
  [
    "route values are still used in the final trip payload",
    recordTrip.includes("const finalOrigem =")
      && recordTrip.includes("const finalDestino =")
      && recordTrip.includes("origem: finalOrigem")
      && recordTrip.includes("destino: finalDestino"),
  ],
  [
    "release version is a valid Web semver",
    /^\d+\.\d+\.\d+$/.test(String(packageJson.version || "")),
  ],
];

let failures = 0;
for (const [label, passed] of checks) {
  if (passed) {
    console.log(`PASS ${label}`);
  } else {
    console.error(`FAIL ${label}`);
    failures += 1;
  }
}

if (failures > 0) process.exit(1);
console.log(`GTO_PRINT_ROUTE_EDITABILITY_PASS ${checks.length}/${checks.length}`);
