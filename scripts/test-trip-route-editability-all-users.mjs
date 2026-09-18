import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const history = fs.readFileSync(path.join(root, "src/pages/driver/TripHistory.tsx"), "utf8");
const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
const modalStart = history.indexOf("      {/* Edit Modal */}");
const modal = modalStart >= 0 ? history.slice(modalStart) : "";
const submitBlockStart = modal.indexOf("onSubmit={async");
const submitBlock = submitBlockStart >= 0 ? modal.slice(submitBlockStart, modal.indexOf("              <div className=\"p-5", submitBlockStart)) : "";

const checks = [
  ["rota autorizada sem requisito exclusivo de sênior", /const canEditTrip[\s\S]*?if \(!currentUser \|\| !trip\.id\) return false;[\s\S]*?getCanonicalTripDriverId\(trip\) === currentUser\.id/.test(history)],
  ["admin pode editar rota da empresa ativa", /activeRole === "admin"[\s\S]*?getCanonicalTripCompanyId\(trip\) === activeCompanyId/.test(history)],
  ["payload de edição envia origem e destino", /updateTrip\(editingTrip\.id, \{[\s\S]*?origem,[\s\S]*?destino,[\s\S]*?\}\)/.test(submitBlock)],
  ["payload do modal não envia valor", !/\bvalor\b|valorEditadoNoPainelSenior|valorEditadoPor|valorEditadoEm/.test(submitBlock)],
  ["modal não possui input de valor", !/<input[\s\S]*?name="valor"/.test(modal)],
  ["modal não possui metadados de edição de valor", !/valorEditadoNoPainelSenior|valorEditadoPor|valorEditadoEm/.test(modal)],
  ["regra aceita somente origem e destino no fluxo de rota", /affectedKeys\(\)\s*\.hasOnly\(\['origem', 'destino'\]\)/.test(rules)],
  ["regra mantém integridade do valor", /preservesTripValueIntegrity\(\)/.test(rules)],
];

const failed = checks.filter(([, pass]) => !pass);
if (failed.length) {
  console.error("[test-trip-route-editability-all-users] falhas:");
  failed.forEach(([label]) => console.error(`- ${label}`));
  process.exit(1);
}

console.log(`[test-trip-route-editability-all-users] ${checks.length}/${checks.length} aprovados`);
