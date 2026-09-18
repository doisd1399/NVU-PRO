import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const companyTab = fs.readFileSync(path.join(root, "src/pages/admin/fleet/CompanyTab.tsx"), "utf8");
const companyContext = fs.readFileSync(path.join(root, "src/context/CompanyContext.tsx"), "utf8");
const appContext = fs.readFileSync(path.join(root, "src/context/AppContext.tsx"), "utf8");
const seniorPanel = fs.readFileSync(path.join(root, "src/pages/admin/SeniorPanel.tsx"), "utf8");

const checks = [
  ["CompanyTab mantém resolução local", /useState<any \| null>\(null\)/],
  ["CompanyTab usa fallback local da empresa resolvida", /allCompanies\.find\(\(company\) => company\.id === activeCompanyId\)[\s\S]*?resolvedCompany\?\.id === activeCompanyId/],
  ["CompanyTab grava resolução bem-sucedida", /if \(company\) setResolvedCompany\(company\)/],
  ["CompanyTab não fica preso quando a resolução conclui", /companyResolution\.status === "failed"/],
  ["CompanyContext deduplica a Promise por empresa", /companyDocumentLoadsRef\.current\.get\(companyId\)/],
  ["CompanyContext mantém fallback getDoc", /return getDoc\(companyRef\)/],
  ["SeniorPanel prepara a empresa antes da navegação", /primeCompanyProfile\(company\)[\s\S]*?setActiveCompanyId\(companyId\)/],
  ["AppContext preserva a empresa inspecionada pelo Sênior", /normalizedCompanyId[\s\S]*?seniorInspectionCompanyId[\s\S]*?isSeniorAuthenticated[\s\S]*?normalizedCompanyId === seniorInspectionCompanyId[\s\S]*?return;/],
  ["AppContext não exige membership operacional para inspeção Sênior", /empresa inspecionada pelo Painel Sênior é um escopo de leitura[\s\S]*?não existir em[\s\S]*?memberships/],
];

const combined = `${companyTab}\n${companyContext}\n${appContext}\n${seniorPanel}`;
const failed = checks.filter(([, pass]) => !pass.test(combined));
if (failed.length) {
  console.error("[test-senior-company-resolution] falhas:");
  failed.forEach(([label]) => console.error(`- ${label}`));
  process.exit(1);
}

console.log(`[test-senior-company-resolution] ${checks.length}/${checks.length} aprovados`);
