import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java");
const citySelector = read("src/components/driver/SimpleCitySelector.tsx");
const bridge = read("src/components/SimpleAutomationCompletionBridge.tsx");
const policy = read("src/services/simpleAutomationReceiptPolicy.ts");

const required = [
  [service, "final int buttonWidth = dp(68);", "largura da bolha simples compacta"],
  [service, "final int buttonHeight = dp(32);", "altura da bolha simples compacta"],
  [service, "GtoBubbleDismissPolicy.canCommitStop", "contrato seguro de remoção"],
  [service, "showSimpleBubbleRemoveTarget", "alvo de remoção da bolha"],
  [service, "stopSimpleFromFloatingBubble", "parada por arraste validado"],
  [service, "playReadyVoice", "áudio de rota pronta"],
  [service, "playTripCompletedVoice", "áudio de conclusão"],
  [service, "Viagem registrada com sucesso.", "chip de confirmação"],
  [service, "Finalize a viagem na tela de resultados e tente novamente.", "feedback nativo de tela incorreta"],
  [citySelector, "grid-cols-[1.75rem_minmax(0,1fr)]", "índice alfabético separado"],
  [citySelector, "h-6 w-6", "letras compactas"],
  [citySelector, "min-h-7", "cidades compactas"],
  [bridge, "Viagem registrada com sucesso.", "feedback Web de sucesso"],
  [policy, "Captura fora da tela correta", "política de tela incorreta"],
];

for (const [source, needle, label] of required) {
  if (!source.includes(needle)) throw new Error(`Contrato ausente: ${label} (${needle})`);
}

if (service.includes("Modo Automático Simples\\n") || service.includes("\\nSimulador:")) {
  throw new Error("O card nativo ainda expõe título de modo/simulador proibido");
}

console.log("PASS: simple compact parity, gesture removal, audio and capture feedback contracts");
