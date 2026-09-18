import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const profile = read("src/pages/driver/Profile.tsx");
const isolated = read("src/pages/admin/DriverProfileIsolated.tsx");
const boundary = read("src/components/common/AppErrorBoundary.tsx");
const app = read("src/App.tsx");
const publicProfile = read("src/pages/PublicProfile.tsx");
const senior = read("src/pages/admin/SeniorPanel.tsx");
const rules = read("firestore.rules");

assert.match(
  profile,
  /<div className="w-full flex flex-col gap-3 sm:gap-4 pb-8">/,
  "perfil do motorista deve usar o container de largura total do hero de referência",
);
assert.doesNotMatch(
  profile,
  /max-w-7xl mx-auto w-full pb-6/,
  "perfil do motorista não pode voltar ao contêiner desktop largo",
);
assert.match(
  isolated,
  /max-w-2xl mx-auto flex flex-col gap-3 sm:gap-4 w-full pb-8/,
  "perfil administrativo deve continuar sendo a referência de largura",
);
assert.doesNotMatch(
  boundary,
  /Recarregue o aplicativo para restaurar a sessão/,
  "boundary global não pode mascarar exceção de renderização como restauração de sessão",
);
assert.match(boundary, /Tentar novamente/, "boundary precisa oferecer retry local");
assert.match(boundary, /não relacionada à sessão/, "diagnóstico deve distinguir renderização de sessão");
assert.match(app, /\/public\/company\/:companyId/, "rota pública de empresa deve existir");
assert.match(app, /\/public\/driver\/:driverId/, "rota pública de motorista deve existir");
assert.match(
  app,
  /path="\/admin"[\s\S]*?<ProtectedRoute allowedRole="admin">/,
  "rotas administrativas devem manter guard de role",
);
assert.match(
  app,
  /path="\/driver"[\s\S]*?<ProtectedRoute allowedRole="driver">/,
  "rotas do motorista devem manter guard de role",
);
assert.doesNotMatch(publicProfile, /collection\(db, "users"\)|collection\(db, "companyMembers"\)/, "perfil público não pode carregar coleções privadas");
assert.match(publicProfile, /doc\(db, "frotas",/, "perfil público deve ler apenas identidade de empresa pública");
assert.match(publicProfile, /collection\(db, "historico_viagens"\)/, "perfil público deve usar histórico já público");
assert.match(senior, /getCountFromServer/, "Senior deve usar contagem agregada no fallback");
assert.doesNotMatch(senior, /getDocs\(collection\(db, "frotas"\)\)/, "Senior não pode baixar toda a coleção para contar empresas");
assert.doesNotMatch(senior, /getIdToken\(true\)/, "aprovação Senior não deve renovar token a cada clique");
assert.match(senior, /runTransaction\(db, async \(transaction\) => \{[\s\S]*status: "rejected"/, "rejeição deve ter transação de estado");
assert.doesNotMatch(rules, /match \/companyMembers\/\{id\} \{\s*allow read, write: if isAuthenticated\(\);/s, "companyMembers não pode ter escrita ampla para qualquer autenticado");
assert.doesNotMatch(rules, /match \/trabalhos\/\{id\} \{\s*allow read, create, delete: if isAuthenticated\(\);/s, "trabalhos não pode ter mutações amplas para qualquer autenticado");
assert.match(rules, /function isCompanyManager\(companyId\)/, "regras devem centralizar o ator autorizado por empresa");
assert.match(rules, /allow delete: if isAuthenticated\(\) && isCompanyManager\(resource\.data\.companyId\);/, "exclusões administrativas devem exigir ator autorizado");

console.log("public-profile-senior-authorization: PASS");
