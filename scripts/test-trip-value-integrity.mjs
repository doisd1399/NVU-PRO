import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const recordTrip = read("src/pages/driver/RecordTrip.tsx");
const tripHistory = read("src/pages/driver/TripHistory.tsx");
const rules = read("firestore.rules");
const gtoOcr = read("src/services/gtoOcrService.ts");
const proNativeRelativePath = "android/app/src/main/java/com/nvu/operacional/SimpleProNativeSubmissionCoordinator.java";
const proNativePath = fs.existsSync(path.join(root, proNativeRelativePath))
  ? path.join(root, proNativeRelativePath)
  : path.join(root, "../android-project/app/src/main/java/com/nvu/operacional/SimpleProNativeSubmissionCoordinator.java");
const proNative = fs.readFileSync(proNativePath, "utf8");

const checks = [
  [
    "RecordTrip mantém estado de detecção automática do valor",
    /valorDetectadoAutomaticamente/,
  ],
  [
    "RecordTrip marca OCR quando o valor é detectado",
    /setValorDetectadoAutomaticamente\(true\)/,
  ],
  [
    "RecordTrip impede edição do valor OCR",
    /readOnly=\{valorDetectadoAutomaticamente\}/,
  ],
  [
    "RecordTrip registra a origem do valor no lançamento",
    /valorDeteccaoMetodo[\s\S]{0,160}valorBloqueadoPorDeteccao/,
  ],
  [
    "TripHistory exibe edição de rota para usuário autorizado",
    /const canEditTrip[\s\S]*?getCanonicalTripDriverId\(trip\) === currentUser\.id/,
  ],
  [
    "TripHistory mantém guarda de salvamento da rota",
    /if \(!editingTrip \|\| !canEditTrip\(editingTrip\)\)/,
  ],
  [
    "TripHistory libera valor somente no acesso Senior",
    /if \(isSeniorAccess\)[\s\S]{0,900}valorCents[\s\S]{0,700}valorEditadoNoPainelSenior/,
  ],
  [
    "TripHistory mantém valor protegido para os demais perfis",
    /Apenas origem e destino podem ser alterados\. O valor recebido permanece protegido\./,
  ],
  [
    "TripHistory não deriva exclusão de canEditTrip",
    /const canDeleteTrip[\s\S]{0,420}activeRole === "driver"/,
  ],
  [
    "Firestore possui função de integridade do valor",
    /function preservesTripValueIntegrity\(\)/,
  ],
  [
    "Firestore protege valor e proveniência no update",
    /preservesTripValueIntegrity\(\) &&/,
  ],
  [
    "Firestore separa delete do update",
    /allow update:[\s\S]{0,900}allow delete:/,
  ],
  [
    "Firestore não permite que alteração de ganho dependa apenas de admin",
    /function preservesTripValueIntegrity[\s\S]{0,500}return isSenior\(\) \|\|/,
  ],
  [
    "GTO Print marca crop numérico como fonte autoritativa",
    /promoteValue\(candidate, "numeric-crop"\)/,
  ],
  [
    "GTO Print rejeita conflito do OCR amplo",
    /conflicting value ignored[\s\S]{0,260}candidateSource/,
  ],
  [
    "Pro nativo exige dois centavos explícitos",
    /decimal\.length\(\) != 2/,
  ],
  [
    "Pro nativo rejeita valor sem separador",
    /separator < 1 \|\| separator >= cleaned\.length\(\) - 1/,
  ],
];

let passed = 0;
for (const [label, pattern] of checks) {
  const source = label.startsWith("RecordTrip")
    ? recordTrip
    : label.startsWith("TripHistory")
      ? tripHistory
      : label.startsWith("GTO Print")
        ? gtoOcr
        : label.startsWith("Pro nativo")
          ? proNative
          : rules;
  if (!pattern.test(source)) {
    throw new Error(`FAIL: ${label}`);
  }
  passed += 1;
  console.log(`PASS: ${label}`);
}

console.log(`TRIP VALUE INTEGRITY PASS (${passed}/${checks.length})`);
