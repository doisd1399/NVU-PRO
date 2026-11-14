import type { WindowsPluginStateCode, WindowsPluginVersions } from "./windowsAutomation";

export type PrepareStepStatus = "done" | "active" | "todo" | "blocked";
export type PrepareStep = { id: "game" | "plugin" | "loaded" | "connected"; label: string; detail: string; status: PrepareStepStatus };
export type PluginStateView = { label: string; tone: "ok" | "wait" | "warn" | "error"; needsPrepare: boolean; blocked: boolean; canOpenGame: boolean; steps: PrepareStep[] };

const labels: Record<WindowsPluginStateCode, [string, PluginStateView["tone"]]> = {
  game_missing: ["Jogo não localizado", "warn"],
  absent: ["Plugin ausente", "warn"],
  foreign: ["Arquivo de terceiros no lugar do plugin", "error"],
  outdated: ["Plugin desatualizado", "warn"],
  restart_required: ["Instalado — reabra o jogo", "wait"],
  ready_to_open: ["Pronto — abra o jogo", "wait"],
  waiting_load: ["Aguardando o jogo carregar o plugin", "wait"],
  not_loaded: ["O jogo não carregou o plugin", "error"],
  connected: ["Conectado", "ok"],
  paused: ["Conectado · jogo pausado", "ok"],
  disconnected: ["Desconectado", "warn"],
  package_invalid: ["Plugin da NVU ausente — reinstale a NVU", "error"],
};
const v = (value: string | null | undefined) => value || "—";

/**
 * Presentation of the canonical state. The three versions are shown separately on purpose:
 * expected (this application), installed (file in the game folder) and loaded (reported by the running game).
 */
export function describePluginState(input: { state: WindowsPluginStateCode | undefined; versions?: WindowsPluginVersions | null; gameFound: boolean }): PluginStateView {
  const state = input.state ?? (input.gameFound ? "absent" : "game_missing");
  const versions = input.versions ?? { expected: null, installed: null, loaded: null };
  const [label, tone] = labels[state];
  const onDisk = ["ready_to_open", "waiting_load", "not_loaded", "restart_required", "connected", "paused", "disconnected"].includes(state);
  const loadedOk = !!versions.expected && versions.loaded === versions.expected;
  const live = state === "connected" || state === "paused";
  const steps: PrepareStep[] = [
    { id: "game", label: "Jogo localizado", detail: input.gameFound ? "Instalação encontrada" : "Escolha a pasta do jogo", status: input.gameFound ? "done" : "active" },
    { id: "plugin", label: `Plugin NVU ${v(versions.expected)} instalado`,
      detail: state === "outdated" ? `Instalado ${v(versions.installed)} · esperado ${v(versions.expected)}` : state === "foreign" ? "Há outro arquivo com o mesmo nome; a NVU não o altera"
        : onDisk ? `Instalado ${v(versions.installed ?? versions.expected)}` : "Ainda não instalado",
      status: state === "foreign" ? "blocked" : onDisk ? "done" : input.gameFound ? "active" : "todo" },
    { id: "loaded", label: "Plugin carregado pelo jogo", detail: loadedOk ? `Carregado ${v(versions.loaded)}` : versions.loaded ? `O jogo carregou ${versions.loaded}; esperado ${v(versions.expected)}`
        : state === "restart_required" || state === "ready_to_open" || state === "waiting_load" ? "Abra (ou reabra) o simulador" : state === "not_loaded" ? "Reabra o simulador e aceite o aviso da SCS" : "Depende do passo anterior",
      status: loadedOk ? "done" : ["restart_required", "ready_to_open", "waiting_load"].includes(state) ? "active" : state === "not_loaded" ? "blocked" : "todo" },
    { id: "connected", label: "Conectado à NVU", detail: live ? (state === "paused" ? "Jogo pausado" : "Recebendo telemetria") : state === "disconnected" ? "A comunicação parou" : "Aguardando o jogo", status: live ? "done" : state === "disconnected" ? "blocked" : "todo" },
  ];
  return { label, tone, needsPrepare: state === "absent" || state === "outdated", blocked: state === "foreign" || state === "package_invalid",
    canOpenGame: ["ready_to_open", "restart_required", "not_loaded", "waiting_load"].includes(state), steps };
}
