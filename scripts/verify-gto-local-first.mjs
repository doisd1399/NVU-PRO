import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const checks = [
  ["src/services/gtoCanonicalState.ts", "isNativeAndroid()", "escuta canônica desativada no Android"],
  ["src/services/gtoCanonicalState.ts", "return () => {};", "fallback sem listener remoto"],
  ["src/lib/gtoObserver.ts", "syncPendingTrips()", "ação de sincronização explícita"],
  ["src/lib/gtoObserver.ts", '"LOCAL_SAVED"', "estado local salvo"],
  ["src/components/GtoObserverSetup.tsx", "syncPendingTrips", "botão de sincronização opcional"],
];

const failures = [];
for (const [relative, marker, description] of checks) {
  const content = await readFile(resolve(root, relative), "utf8");
  if (!content.includes(marker)) failures.push(`${relative}: ${description}`);
}

if (failures.length > 0) {
  console.error("GTO local-first: falha nas verificações:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`GTO local-first: ${checks.length} verificações aprovadas.`);
