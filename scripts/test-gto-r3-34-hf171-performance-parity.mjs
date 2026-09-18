import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const checks = [];
const expect = (condition, message) => {
  checks.push({ condition: Boolean(condition), message });
};

const runtimePerformance = read("src/lib/runtimePerformance.ts");
const app = read("src/App.tsx");
const seniorPanel = read("src/pages/admin/SeniorPanel.tsx");
const firebase = read("src/lib/firebase.ts");
const appContext = read("src/context/AppContext.tsx");

expect(
  runtimePerformance.includes('import { Capacitor } from "@capacitor/core";'),
  "runtimePerformance deve conhecer o runtime nativo Capacitor",
);
expect(
  runtimePerformance.includes("const nativeWebView = Capacitor.isNativePlatform();"),
  "Android deve ser identificado explicitamente como WebView nativo",
);
expect(
  runtimePerformance.includes("nativeWebView ||") &&
    runtimePerformance.includes("allowSecondaryRouteWarmup: !constrained") &&
    runtimePerformance.includes("allowRankingWarmup: !constrained"),
  "warm-ups secundários e Ranking devem ser desabilitados no Android nativo",
);
expect(
  runtimePerformance.includes("backgroundImageLimit: constrained ? 0"),
  "imagens especulativas devem ser desabilitadas em runtime constrangido",
);
expect(
  app.includes('CapacitorApp.addListener("appStateChange"') &&
    app.includes("nvu-session-refresh") &&
    app.includes("wasInactiveForMs >= 12_000"),
  "o retorno ao foreground deve continuar integrado ao ciclo de sessão, mas ignorar pausas curtas",
);
expect(
  appContext.includes('if (reason !== "manual" && isInteractionFirstRoute(getForegroundPathname()))') &&
    appContext.includes("minimumIntervalMs"),
  "refresh automático deve permanecer limitado por rota e intervalo",
);
expect(
  seniorPanel.includes("void hydrateCompanyRelations(companies).catch") &&
    !seniorPanel.includes('getDocs(collection(db, "frotas"))') &&
    seniorPanel.includes("const membersByCompany = useMemo") &&
    seniorPanel.includes("const monthlyTripsByCompany = useMemo"),
  "SeniorPanel não deve bloquear o primeiro paint, baixar toda frotas como fallback ou recalcular filtros aninhados",
);
expect(
  seniorPanel.includes('httpsCallable') &&
    seniorPanel.includes('"syncCompanyApprovalNews"') &&
    seniorPanel.includes('setCompaniesTotalCount(activeCount)'),
  "contagem do Painel deve continuar server-authoritative quando o callable responde",
);
expect(
  firebase.includes('getAuth(app)') &&
    firebase.includes('getFunctions(app, "us-central1")'),
  "Firebase Auth e Functions devem continuar usando os contratos atuais",
);

const failed = checks.filter((check) => !check.condition);
console.log(`HF171 performance/parity: ${checks.length - failed.length}/${checks.length} checks aprovados`);
if (failed.length > 0) {
  failed.forEach((check) => console.error(`FAIL: ${check.message}`));
  process.exit(1);
}
