import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const files = {
  config: "src/config/legacyNotifications.ts",
  context: "src/context/NotificationsContext.tsx",
  service: "src/services/notificationService.ts",
  identity: "src/services/userIdentityService.ts",
  functions: "functions/src/index.ts",
  rules: "firestore.rules",
  indexes: "firestore.indexes.json",
};

const content = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [key, read(file)]),
);

const checks = [
  {
    name: "Leitura histórica controlável",
    ok:
      content.config.includes("readHistory:") &&
      content.context.includes("legacyNotificationCompatibility.readHistory"),
  },
  {
    name: "Realtime legado controlável",
    ok:
      content.config.includes("listenRealtime:") &&
      content.context.includes("legacyNotificationCompatibility.listenRealtime"),
  },
  {
    name: "Fallback de escrita controlável",
    ok:
      content.config.includes("writeFallback:") &&
      content.service.includes("legacyFallbackEnabled: legacyNotificationCompatibility.writeFallback"),
  },
  {
    name: "Resolução/migração legada controlável",
    ok:
      content.config.includes("resolveLegacy:") &&
      content.service.includes("legacyNotificationCompatibility.resolveLegacy") &&
      content.identity.includes("legacyNotificationCompatibility.resolveLegacy"),
  },
  {
    name: "Push legado controlável no servidor",
    ok:
      content.functions.includes("ENABLE_LEGACY_NOTIFICATION_PUSH") &&
      content.functions.includes("LEGACY_NOTIFICATION_PUSH_ENABLED"),
  },
  {
    name: "Compatibilidade preservada por padrão",
    ok:
      content.config.includes("defaultValue = true") &&
      content.functions.includes("defaultValue = true"),
  },
];

const sourceFiles = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", "lib", "dist", ".git"].includes(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (/\.(?:ts|tsx|js|mjs|rules|json)$/.test(entry.name)) sourceFiles.push(fullPath);
  }
}
walk(path.join(root, "src"));
walk(path.join(root, "functions", "src"));

const directLegacyReferences = sourceFiles
  .filter((file) => /["']notificacoes["']/.test(fs.readFileSync(file, "utf8")))
  .map((file) => path.relative(root, file).replaceAll(path.sep, "/"))
  .sort();

const approvedDirectReferences = new Set([
  files.context,
  files.service,
  files.identity,
  files.functions,
]);
const unexpectedReferences = directLegacyReferences.filter(
  (file) => !approvedDirectReferences.has(file),
);

console.log("Auditoria de compatibilidade das notificações legadas\n");
for (const check of checks) {
  console.log(`${check.ok ? "[OK]" : "[FALHA]"} ${check.name}`);
}
console.log("\nReferências diretas controladas:");
for (const file of directLegacyReferences) console.log(`- ${file}`);

if (unexpectedReferences.length) {
  console.log("\nReferências diretas inesperadas:");
  for (const file of unexpectedReferences) console.log(`- ${file}`);
}

const failed = checks.filter((check) => !check.ok);
if (failed.length || unexpectedReferences.length) {
  process.exitCode = 1;
} else {
  console.log("\nResultado: preparado para desativação gradual, com compatibilidade ativa por padrão.");
}
