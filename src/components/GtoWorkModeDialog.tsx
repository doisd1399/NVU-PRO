import { CachedImage } from "./common/CachedImage";
import { Camera, CircleDot, Sparkles, X, Settings2, MonitorPlay } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { isSimpleAutomationNativeAvailable, SimpleAutomation } from "../lib/simpleAutomationNative";
import { preloadRoute } from "../lib/routePreload";
import {
  isProOverlayProbeAvailable,
  ProOverlayProbe,
  type ProOverlayProbeStatus,
} from "../lib/proOverlayProbe";

export type GtoWorkMode = "print" | "simple" | "max";

type WorkModeDialogVariant = "gto" | "simple";

interface GtoWorkModeDialogProps {
  open: boolean;
  variant: WorkModeDialogVariant;
  simulatorLabel?: string;
  busy?: boolean;
  vehiclePhoto?: string | null;
  vehicleName?: string;
  vehiclePhotoPending?: boolean;
  onClose: () => void;
  onSelect: (mode: GtoWorkMode) => void | Promise<void>;
}

export function GtoWorkModeDialog({
  open,
  variant,
  simulatorLabel,
  busy = false,
  vehiclePhoto,
  vehicleName,
  vehiclePhotoPending = false,
  onClose,
  onSelect,
}: GtoWorkModeDialogProps) {
  const [maxStep, setMaxStep] = useState(false);
  const [proStep, setProStep] = useState(false);
  const [overlayReady, setOverlayReady] = useState(false);
  const [proError, setProError] = useState("");
  const [probeStatus, setProbeStatus] = useState<ProOverlayProbeStatus | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [vehiclePhotoFailed, setVehiclePhotoFailed] = useState(false);
  // The dashboard supplies the same locally persisted bytes used by its vehicle card.
  const effectiveVehiclePhoto = vehiclePhoto;
  const isGto = variant === "gto";
  // Max remains implemented and callable through the existing onSelect contract,
  // but its card is intentionally hidden from the standard "Iniciar trabalho" chooser.
  const showMaxMode = false;
  const title = isGto
    ? "Iniciar trabalho GTO"
    : `Iniciar trabalho ${simulatorLabel || "do simulador"}`;

  useEffect(() => {
    if (!open) { setMaxStep(false); setProStep(false); setProError(""); }
    else void preloadRoute("/driver/trip").catch(() => undefined);
  }, [open]);

  useEffect(() => {
    setVehiclePhotoFailed(false);
  }, [effectiveVehiclePhoto]);

  useEffect(() => {
    if (!open || !proStep || !isSimpleAutomationNativeAvailable()) return;
    const refresh = () => { void SimpleAutomation.getStatus()
      .then(status => setOverlayReady(Boolean(status.persistentOverlayPermission)))
      .catch(() => setOverlayReady(false)); };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [open, proStep]);

  const startWithTemporaryBubble = async () => {
    if (!isProOverlayProbeAvailable() || probeBusy) return;
    setProError("");
    setProbeBusy(true);
    let startedHere = false;
    try {
      const existing = await ProOverlayProbe.getStatus();
      setProbeStatus(existing);
      if (existing.active) {
        await onSelect("simple");
        return;
      }
      const pro = await SimpleAutomation.getStatus();
      if (pro.persistentOverlayPermission) {
        await onSelect("simple");
        return;
      }
      await ProOverlayProbe.run();
      startedHere = true;
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise(resolve => window.setTimeout(resolve, 500));
        const result = await ProOverlayProbe.getStatus();
        setProbeStatus(result);
        if (result.active || result.stage === "OVERLAY_OK") {
          await onSelect("simple");
          // Wait for the foreground service to complete Android's async start.
          // A rejected launch must not leave screen capture running.
          for (let check = 0; check < 12; check++) {
            const running = (await SimpleAutomation.getStatus()).running;
            if (running) return;
            await new Promise(resolve => window.setTimeout(resolve, 250));
          }
          throw new Error("O serviço Pro não confirmou a abertura. A captura temporária foi encerrada para permitir nova tentativa.");
        }
        if (result.stage === "ALREADY_GRANTED") {
          const current = await SimpleAutomation.getStatus();
          if (current.persistentOverlayPermission) {
            await onSelect("simple");
            return;
          }
          throw new Error("A sessão de captura anterior terminou. Autorize uma nova captura para continuar.");
        }
        if (["DENIED", "NOT_GRANTED", "CAPTURE_FAILED", "SERVICE_ERROR", "CONSENT_ERROR", "STOPPED", "UNAVAILABLE"].includes(result.stage)) {
          throw new Error(result.detail || "O Android não liberou a bolha temporária. Use a primeira opção.");
        }
      }
      throw new Error("A autorização demorou. Tente novamente ou use a primeira opção.");
    } catch (error) {
      if (startedHere) await ProOverlayProbe.stop().catch(() => undefined);
      setProError(error instanceof Error ? error.message : "Não foi possível iniciar a bolha temporária.");
    } finally {
      setProbeBusy(false);
    }
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-[2px] p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="work-mode-title"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="w-full max-w-md max-h-[85dvh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-nvu-surface shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-slate-100 dark:border-white/5">
          <div>
            <h2
              id="work-mode-title"
              className="text-[16px] font-bold text-slate-900 dark:text-white"
            >
              {title}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-nvu-muted">
              {proStep
                ? "Escolha como deseja liberar a bolha NVU para esta operação."
                : maxStep
                ? "O modo automático Max usa detecção inteligente de tela e a bolha NVU."
                : isGto
                  ? "Escolha como deseja registrar esta operação no GTO."
                  : "Escolha como deseja registrar esta operação no Modo pro."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
          >
            <X size={17} />
          </button>
        </div>

        <div className="p-3 space-y-2.5">
          {effectiveVehiclePhoto && !vehiclePhotoFailed && !proStep && !maxStep ? (
            <div data-testid="work-mode-vehicle-card" className="overflow-hidden rounded-xl border border-slate-200 dark:border-white/10">
              <CachedImage
                src={effectiveVehiclePhoto}
                alt="Veículo atual"
                loading="eager"
                onError={() => setVehiclePhotoFailed(true)}
                className="w-full h-36 object-cover"
              />
              {vehicleName && <p className="px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white">{vehicleName}</p>}
              {vehiclePhotoPending && <p role="status" className="px-3 pb-2 text-[11px] text-slate-500 dark:text-nvu-muted">Foto salva no aparelho; sincronização pendente.</p>}
            </div>
          ) : effectiveVehiclePhoto && !proStep && !maxStep ? (
            <div role="status" className="w-full h-36 rounded-xl bg-slate-100 dark:bg-white/5 flex items-center justify-center px-4 text-center text-xs text-slate-500 dark:text-nvu-muted">
              Não foi possível carregar a fotografia agora.
            </div>
          ) : null}
          {proStep ? (
            <>
              <button type="button" disabled={busy || probeBusy} onClick={() => {
                setProError("");
                if (overlayReady) void onSelect("simple");
                else void SimpleAutomation.openOverlaySettings().catch(() => setProError("Não foi possível abrir as configurações do Android."));
              }} className="w-full rounded-xl border border-cyan-300 dark:border-cyan-400/30 bg-cyan-50 dark:bg-cyan-400/5 p-3.5 text-left disabled:opacity-50">
                <div className="flex items-start gap-3"><Settings2 size={20} className="text-cyan-600 shrink-0" /><div>
                  <div className="font-bold text-[14px] text-slate-900 dark:text-white">1 · Bolha permanente {overlayReady ? "— pronta para iniciar" : ""}</div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-nvu-muted">{overlayReady
                    ? "A sobreposição já está autorizada. Toque para iniciar o Modo Pro."
                    : "Siga as telas do Android. Se o interruptor estiver bloqueado, o guia mostra onde ativar ‘Permitir configurações restritas’. Depois volte para iniciar."}</p>
                  <div className="mt-2 text-xs font-semibold text-cyan-700 dark:text-cyan-300">{overlayReady ? "Iniciar Modo Pro" : "Abrir passo a passo"}</div>
                </div></div>
              </button>
              {!overlayReady && <button type="button" disabled={busy || probeBusy || !isProOverlayProbeAvailable()} onClick={() => void startWithTemporaryBubble()} className="w-full rounded-xl border border-blue-300 dark:border-blue-400/30 bg-blue-50 dark:bg-blue-400/5 p-3.5 text-left disabled:opacity-50">
                <div className="flex items-start gap-3"><MonitorPlay size={20} className="text-blue-600 shrink-0" /><div>
                  <div className="font-bold text-[14px] text-slate-900 dark:text-white">2 · Bolha temporária com captura autorizada</div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-nvu-muted">Autorize a captura de tela do Android. Ela fica ativa durante o Modo Pro para manter a bolha visível. Ao finalizar cada viagem, a NVU usa a mesma sessão para ler o recebimento. A bolha continua disponível para as próximas viagens enquanto a captura estiver ativa.</p>
                  <div className="mt-2 text-xs font-semibold text-blue-700 dark:text-blue-300">{probeBusy ? "Aguardando autorização…" : "Testar captura autorizada"}</div>
                </div></div>
              </button>}
              {probeStatus && <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-3 text-xs">
                <div className="font-semibold text-slate-700 dark:text-nvu-text">Resultado: {probeStatus.stage}</div>
                {probeStatus.detail && <div className="mt-1 text-slate-500 dark:text-nvu-muted">{probeStatus.detail}</div>}
              </div>}
              {probeStatus && <button type="button" disabled={probeBusy} onClick={() => setProbeStatus(null)} className="text-xs font-semibold text-blue-700 dark:text-blue-300 p-2">Ver resultado</button>}
              {proError && <p role="alert" className="text-xs text-rose-600">{proError}</p>}
              <button type="button" disabled={probeBusy} onClick={() => setProStep(false)} className="text-xs font-semibold text-slate-600 dark:text-nvu-text-soft p-2">Voltar</button>
            </>
          ) : !maxStep ? (
            <>
              <button
                type="button"
                onClick={() => void onSelect("print")}
                disabled={busy}
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-nvu-surface hover:bg-slate-100 dark:hover:bg-nvu-strip disabled:opacity-60 active:scale-[0.995] transition-all p-3.5 text-left"
              >
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                    <Camera size={20} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-[14px] text-slate-900 dark:text-white">
                      Modo print
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-nvu-muted">
                      Abre o lançamento manual de viagem para informar origem, destino e enviar a captura do recebimento.
                    </p>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => { setProStep(true); setProError(""); }}
                disabled={busy}
                className="w-full rounded-xl border border-cyan-200/80 dark:border-cyan-400/20 bg-cyan-50/70 dark:bg-cyan-400/5 hover:bg-cyan-50 dark:hover:bg-cyan-400/10 disabled:opacity-60 active:scale-[0.995] transition-all p-3.5 text-left"
              >
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-xl bg-cyan-600 text-white flex items-center justify-center shrink-0">
                    <Sparkles size={19} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-[14px] text-slate-900 dark:text-white">
                      Modo pro
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-nvu-muted">
                      {isGto
                        ? "Escolha como ativar a bolha NVU e registre a viagem no simulador."
                        : "Escolha como ativar a bolha NVU e registre a viagem no simulador."}
                    </p>
                  </div>
                </div>
              </button>

              {isGto && showMaxMode && (
                <button
                  type="button"
                  onClick={() => setMaxStep(true)}
                  disabled={busy}
                  className="w-full rounded-xl border border-violet-200/80 dark:border-violet-400/20 bg-violet-50/70 dark:bg-violet-400/5 hover:bg-violet-50 dark:hover:bg-violet-400/10 disabled:opacity-60 active:scale-[0.995] transition-all p-3.5 text-left"
                >
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0">
                      <CircleDot size={19} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-[14px] text-slate-900 dark:text-white">
                        Modo automático Max
                      </div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-nvu-muted">
                        Detecção inteligente de tela, fretes e conclusão com a bolha NVU exclusiva do GTO.
                      </p>
                    </div>
                  </div>
                </button>
              )}
            </>
          ) : (
            <>
              <div className="rounded-xl border border-violet-200/80 dark:border-violet-400/20 bg-violet-50/70 dark:bg-violet-400/5 p-3.5">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0">
                    <CircleDot size={20} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-[14px] text-slate-900 dark:text-white">
                      Preparar modo automático Max
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-nvu-muted">
                      A NVU vai solicitar as permissões necessárias, ativar a bolha e abrir o GTO com detecção inteligente.
                    </p>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onSelect("max")}
                disabled={busy}
                className="w-full rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 active:scale-[0.995] transition-all px-4 py-3.5 text-white text-[14px] font-bold flex items-center justify-center gap-2"
              >
                <CircleDot size={18} />
                Ativar modo automático Max
              </button>
              <button
                type="button"
                onClick={() => setMaxStep(false)}
                disabled={busy}
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 px-4 py-3 text-[13px] font-semibold text-slate-600 dark:text-nvu-text-soft hover:bg-slate-50 dark:hover:bg-white/5"
              >
                Voltar
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
