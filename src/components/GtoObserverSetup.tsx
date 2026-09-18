import React, { useCallback, useEffect, useMemo, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Eye, Play, ShieldCheck, Square, Truck } from "lucide-react";
import { toast } from "sonner";
import {
  GtoObserver,
  type GtoObserverContext,
  type GtoObserverStatus,
  isGtoObserverAvailable,
  isNativeAndroid,
} from "../lib/gtoObserver";
import { useGtoCanonicalState } from "../hooks/useGtoCanonicalState";

const stateLabel = (state?: string) => {
  switch (state) {
    case "WAITING_FREIGHT":
      return "Aguardando escolha do frete";
    case "CONFIRMING_FREIGHT":
      return "Confirmando frete selecionado";
    case "TRIP_IN_PROGRESS":
      return "Viagem em andamento";
    case "RESULT_DETECTED":
      return "Resultado detectado";
    case "AWAITING_BONUS_VALIDATION":
      return "Verificando bônus de vídeo";
    case "RESULT_CONFIRMED":
      return "Resultado normal validado";
    case "REJECTED_BONUS":
      return "Viagem recusada por bônus";
    case "CANCELLED":
      return "Viagem cancelada";
    default:
      return "Pronto";
  }
};

const readSelectedFreight = (raw?: string) => {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as {
      destination?: string;
      km?: string;
      offeredValue?: string;
    };
    return [parsed.destination, parsed.km, parsed.offeredValue]
      .filter(Boolean)
      .join(" · ");
  } catch {
    return "";
  }
};

export default function GtoObserverSetup({
  context,
}: {
  context: GtoObserverContext;
}) {
  const nativeAndroid = useMemo(() => isNativeAndroid(), []);
  const pluginAvailable = useMemo(
    () => nativeAndroid && isGtoObserverAvailable(),
    [nativeAndroid],
  );
  const [status, setStatus] = useState<GtoObserverStatus | null>(null);
  const canonicalState = useGtoCanonicalState(context.driverId);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!nativeAndroid || !pluginAvailable) return;
    try {
      let current = await GtoObserver.getStatus();
      // If the driver previously enabled the observer and Android recreated/killed
      // the process, recover it only while the NVU activity is visible. This avoids
      // background-start restrictions on modern Android versions.
      if (
        current.enabled &&
        !current.running &&
        current.overlayPermission &&
        current.usageAccess
      ) {
        current = await GtoObserver.recoverObserver();
      }
      setStatus(current);
    } catch (error) {
      console.error("Falha ao consultar/recuperar observador GTO:", error);
    }
  }, [nativeAndroid, pluginAvailable]);

  useEffect(() => {
    if (!nativeAndroid || !pluginAvailable) return;
    void refresh();

    let removeListener: (() => Promise<void>) | undefined;
    void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) {
        window.setTimeout(() => void refresh(), 250);
      }
    }).then((handle) => {
      removeListener = () => handle.remove();
    });

    const interval = window.setInterval(() => void refresh(), 1800);
    return () => {
      window.clearInterval(interval);
      void removeListener?.();
    };
  }, [nativeAndroid, pluginAvailable, refresh]);

  useEffect(() => {
    if (!nativeAndroid || !pluginAvailable || !status?.running) return;
    void GtoObserver.setContext(context).catch((error) =>
      console.error("Falha ao atualizar contexto GTO:", error),
    );
  }, [context, nativeAndroid, pluginAvailable, status?.running]);

  if (!nativeAndroid) return null;

  if (!pluginAvailable) {
    return (
      <div className="bg-white dark:bg-[#121213] border border-amber-200 dark:border-amber-500/30 sm:rounded-2xl rounded-xl p-3 sm:p-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
            <Truck size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[13px] sm:text-[14px] font-bold text-slate-900 dark:text-white">
              Automação GTO
            </h3>
            <p className="text-[10px] sm:text-[11px] text-amber-700 dark:text-amber-300 mt-1">
              A interface web está atualizada, mas este APK não possui o módulo nativo GTO. Instale a versão do APK com o Observador GTO.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const configureOrStart = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const current = await GtoObserver.getStatus();
      if (!current.overlayPermission) {
        await GtoObserver.openOverlaySettings();
        return;
      }
      if (!current.usageAccess) {
        await GtoObserver.openUsageAccessSettings();
        return;
      }
      if (!current.preciseTouchPermission) {
        await GtoObserver.openPreciseTouchSettings();
        return;
      }

      await GtoObserver.setContext(context);
      const result = await GtoObserver.startObserver();
      if (result.started) {
        toast.success("Botão NVU ativado. Abra o simulador para iniciar a automação.");
      } else {
        toast.error(result.startError || "O serviço GTO não confirmou a inicialização.");
      }
      window.setTimeout(() => void refresh(), 400);
    } catch (error) {
      console.error(error);
      toast.error("Não foi possível ativar o observador GTO.");
    } finally {
      setBusy(false);
    }
  };

  const openGto = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await GtoObserver.setContext(context);
      // R3.28: the Android recording consent is intentionally requested only after
      // the simulator is already foreground. openGto() arms that native flow.
      const current = await GtoObserver.getStatus();
      setStatus(current);
      const result = await GtoObserver.openGto();
      if (!result.installed) {
        toast.error("Global Truck Online não foi encontrado neste aparelho.");
      } else if (!result.opened || result.prepared === false) {
        toast.error(result.error || "Não foi possível preparar a etapa atual antes de abrir o GTO.");
      }
    } catch (error) {
      console.error(error);
      toast.error("Não foi possível abrir o GTO.");
    } finally {
      setBusy(false);
    }
  };

  const syncPendingTrips = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await GtoObserver.syncPendingTrips();
      if (result.remoteSyncRequested) {
        toast.success("Sincronização remota iniciada para as pendências locais.");
        window.setTimeout(() => void refresh(), 1200);
      } else {
        toast.error("Não foi possível iniciar a sincronização remota.");
      }
    } catch (error) {
      console.error("Falha ao sincronizar pendências GTO:", error);
      toast.error("Não foi possível sincronizar as pendências GTO.");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await GtoObserver.stopObserver();
      toast.success("Observador GTO desativado.");
      window.setTimeout(() => void refresh(), 350);
    } catch (error) {
      console.error(error);
      toast.error("Não foi possível desativar o observador GTO.");
    } finally {
      setBusy(false);
    }
  };

  const primaryLabel = !status?.overlayPermission
    ? "Permitir botão sobre o jogo"
    : !status?.usageAccess
      ? "Permitir detectar o GTO"
      : !status?.preciseTouchPermission
        ? "Ativar seleção precisa"
        : !status?.running
          ? "Ativar botão GTO"
          : !status?.projectionActive
            ? "Autorizar leitura e abrir GTO"
            : "Abrir Global Truck Online";

  const selectedFreight = readSelectedFreight(status?.selectedFreight);
  // The running Android observer is the live authority for the current device.
  // Firestore canonical state is a durable mirror and may legitimately lag while a
  // transition is being synchronized; it must never overwrite the driver's live stage.
  const canonicalTripState = status?.running && status?.tripState
    ? status.tripState
    : canonicalState?.state || status?.tripState || "IDLE";
  const driverStageIsCurrent = Boolean(
    status?.driverStageMessage
      && (!status?.tripStateChangedAt || !status?.driverStageAt || status.driverStageAt >= status.tripStateChangedAt),
  );
  const submissionState = status?.tripSubmissionState || "READY";
  const submissionMessage = submissionState === "SENDING"
    ? "Enviando viagem automaticamente."
    : submissionState === "PENDING_RETRY"
      ? "Envio pendente; nova tentativa automática."
      : submissionState === "LOCAL_SAVED"
        ? "Viagem protegida localmente; envio automático em segundo plano."
        : submissionState === "SYNCED"
          ? "Viagem registrada com sucesso."
          : "";
  // Lifecycle/background is orthogonal to the driver's current operation. A stale
  // foreground label must not hide the live stage of a consecutive freight.
  const backgroundLifecycleOnly = Boolean(
    status?.observerLifecycleStatus === "GTO_BACKGROUND_OBSERVER_ACTIVE"
      && ![
        "WAITING_FREIGHT",
        "CONFIRMING_FREIGHT",
        "TRIP_IN_PROGRESS",
        "RESULT_DETECTED",
        "AWAITING_BONUS_VALIDATION",
        "RESULT_CONFIRMED",
        "REJECTED_BONUS",
      ].includes(canonicalTripState),
  );

  return (
    <div className="bg-white dark:bg-[#121213] border border-slate-200 dark:border-slate-800 sm:rounded-2xl rounded-xl p-3 sm:p-4 shadow-[0_2px_12px_rgba(0,0,0,0.025)]">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 flex items-center justify-center shrink-0">
          <Truck size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-[13px] sm:text-[14px] font-bold text-slate-900 dark:text-white">
                Automação GTO
              </h3>
              <p className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Frete, rota, conclusão e envio acompanhados automaticamente pelo botão NVU fixo.
              </p>
            </div>
            <span
              className={`shrink-0 text-[9px] sm:text-[10px] px-2 py-1 rounded-full font-semibold ${
                status?.running && status?.observerHealthy !== false
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                  : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {status?.running ? (status.observerHealthy === false ? "Instável" : "Ativo") : "Inativo"}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-1.5 mt-3 text-[10px] sm:text-[11px]">
            <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <ShieldCheck size={12} />
              Sobreposição: {status?.overlayPermission ? "ok" : "pendente"}
            </div>
            <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <Eye size={12} />
              Detecção GTO: {status?.usageAccess ? "ok" : "pendente"}
            </div>
            <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <ShieldCheck size={12} />
              Toque preciso: {status?.preciseTouchPermission ? "ok" : "pendente"}
            </div>
            <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <Eye size={12} />
              Leitura da tela: {status?.screenAnalysisPaused
                ? "pausada fora do GTO"
                : status?.projectionActive
                  ? "ativa"
                  : "sob demanda"}
            </div>
          </div>

          {status?.running && (
            <div className="mt-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 px-2.5 py-2 text-[10px] sm:text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5">
              <div className="font-medium text-cyan-700 dark:text-cyan-300">
                Fluxo: 1. escolher frete → 2. realizar rota → 3. receber no GTO → 4. envio automático
              </div>
              {!backgroundLifecycleOnly
                && driverStageIsCurrent
                && status.driverStageMessage && (
                <div>
                  Etapa atual: <strong>{status.driverStageMessage}</strong>
                </div>
              )}
              {backgroundLifecycleOnly ? (
                <div className="text-cyan-700 dark:text-cyan-300">
                  Observador: <strong>ativo · aguardando o retorno do GTO; sessão preservada.</strong>
                </div>
              ) : !driverStageIsCurrent ? (
                <div>
                  Etapa atual: <strong>{stateLabel(canonicalTripState)}</strong>
                </div>
              ) : null}
              <div>
                Estado: <strong>{stateLabel(canonicalTripState)}</strong>
              </div>
              <div>Tela: <strong>{status.screenAnalysisPaused ? "PAUSADA_FORA_DO_GTO" : (status.screenState || "UNKNOWN")}</strong></div>
              {status.touchDiagnosticMode && (status.physicalTouchExpectedAt || status.physicalTouchAttemptAt) && (
                <div className="mt-2 rounded-md border border-cyan-200 bg-cyan-50/80 px-2 py-1.5 font-mono text-[9px] leading-4 text-cyan-950 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-100">
                  <div className="font-bold">DIAGNÓSTICO ACEITAR HF208</div>
                  <div>
                    SENSOR: {status.touchPulseSensorVisible ? "READY" : "OFF"} · TOUCH: {status.physicalTouchEventReceived ? "YES" : "NO"} · OUTSIDE: {status.physicalActionOutsideReceived ? "YES" : "NO"}
                  </div>
                  <div>
                    X/Y: {Math.round(status.physicalTouchRawX ?? -1)},{Math.round(status.physicalTouchRawY ?? -1)} · SPACE: {status.physicalTouchCoordinateSpace || "UNRESOLVED"}
                  </div>
                  <div>
                    ACCEPTS: {status.physicalTouchAcceptRectCount ?? 0} · ROW: {(status.physicalTouchResolvedRow ?? -1) >= 0 ? status.physicalTouchResolvedRow : "NONE"}
                  </div>
                  <div>
                    TARGET: {status.physicalTouchTargetLocked ? "LOCKED" : "WAITING"} · VALIDATION: {status.physicalTouchValidationResult || "WAITING"} · COMMIT: {status.physicalTouchCommitResult || "WAITING"}
                  </div>
                  {!status.physicalTouchTargetLocked && (
                    <div>REASON: {status.physicalTouchResolutionReason || "WAITING_TOUCH"}</div>
                  )}
                  <div>STAGE: {status.physicalTouchStage || "IDLE"}</div>
                </div>
              )}
              {status.observerLifecycleStatus === "GTO_BACKGROUND_OBSERVER_ACTIVE" && (
                <div className="text-cyan-700 dark:text-cyan-300">
                  Ciclo de vida: <strong>Observador NVU ativo · GTO fechado, minimizado ou em segundo plano não encerra o serviço.</strong>
                </div>
              )}
              {status.screenAnalysisPaused && (
                <div className="text-cyan-700 dark:text-cyan-300">
                  Leitura: <strong>pausada fora do GTO · estado preservado em {stateLabel(status.tripStateWhenAnalysisPaused || canonicalTripState)}.</strong>
                </div>
              )}
              {selectedFreight && (
                <div>
                  {canonicalTripState === "TRIP_IN_PROGRESS" ? "Frete atual" : "Frete detectado"}: <strong>{selectedFreight}</strong>
                </div>
              )}
              {status.activeTripFreightListVisible && canonicalTripState === "TRIP_IN_PROGRESS" && (
                <div className="text-cyan-700 dark:text-cyan-300">
                  Lista reaberta: <strong>encerrando o contexto anterior e preparando o próximo frete automaticamente.</strong>
                </div>
              )}
              {status.selectionConfirmationStatus === "FAILED" && (
                <div className="text-amber-700 dark:text-amber-300">
                  Frete não confirmado: <strong>{status.selectionFailureReason || "a linha ficou encoberta, ilegível ou as leituras divergiram."}</strong>{" "}
                  Feche notificações, afaste o painel NVU, reabra a lista e selecione novamente. Nenhum dado foi registrado.
                </div>
              )}
              {status.resultValue && <div>Resultado detectado: {status.resultValue}</div>}
              {!status.resultValue && (status.resultValueEvidenceCount || 0) > 0 && (
                <div className="text-amber-700 dark:text-amber-300">
                  Resultado: <strong>valor aguardando uma segunda leitura concordante.</strong>
                </div>
              )}
              {status.resultValueEvidenceConflict && !status.resultValue && (
                <div className="text-red-600 dark:text-red-400">
                  Resultado: <strong>leituras do valor divergiram; nenhum valor foi presumido.</strong>
                </div>
              )}
              {submissionMessage && (
                <div className={submissionState === "PENDING_RETRY"
                  ? "text-amber-700 dark:text-amber-300"
                  : submissionState === "LOCAL_SAVED"
                    ? "text-emerald-700 dark:text-emerald-300"
                    : "text-cyan-700 dark:text-cyan-300"}>
                  Envio: <strong>{submissionMessage}</strong>
                </div>
              )}
              {(status.gtoDurableQueueCount || 0) > 0 && (
                <div className="text-emerald-700 dark:text-emerald-300">
                  Fila de envio: <strong>{status.gtoDurableQueueCount} entrega(s) protegida(s); {status.gtoSubmissionAutoSendEnabled === false ? "modo local" : "envio automático ativo"}.</strong>
                </div>
              )}
              {status.gtoTripIntegrityStatus && (
                <div>Integridade: <strong>{status.gtoTripIntegrityStatus}</strong></div>
              )}
              {status.runtimePermissionError && (
                <div className="text-red-600 dark:text-red-400">
                  Permissões: <strong>{status.runtimePermissionError}</strong>
                </div>
              )}
              {status.projectionPermissionInFlight && (
                <div className="text-cyan-700 dark:text-cyan-300">
                  Captura: <strong>aguardando autorização do Android.</strong>
                </div>
              )}
              {status.projectionActive && status.captureReadyForAnalysis === false && (
                <div className="text-cyan-700 dark:text-cyan-300">
                  Captura: <strong>estabilizando orientação e quadros no GTO ({status.captureStableFrames || 0}/3).</strong>
                </div>
              )}
              {status.captureReadyForAnalysis && status.captureWidth && status.captureHeight && (
                <div>
                  Captura GTO: <strong>estável em {status.captureWidth}×{status.captureHeight}</strong>
                </div>
              )}
              {status.projectionReauthRequired
                && !status.projectionActive
                && !status.projectionPermissionInFlight
                && !status.projectionSessionBound
                && !status.projectionSurfacePending
                && !status.projectionGrantValidated && (
                <div className="text-amber-700 dark:text-amber-300">
                  Leitura da tela: <strong>autorize novamente pela NVU antes de retornar ao GTO.</strong>
                </div>
              )}
              {status.resultTouchFallbackReady && (
                <div className="text-amber-700 dark:text-amber-300">
                  Recebimento: <strong>o Android não informou o toque. Confirme o recebimento pelo botão NVU para preservar a entrega.</strong>
                </div>
              )}
              {status.resultTouchFallbackRequired && !status.resultTouchFallbackReady && (
                <div className="text-amber-700 dark:text-amber-300">
                  Recebimento: <strong>sensor de toque indisponível; validação visual reforçada ativa.</strong>
                </div>
              )}
              {status.resultTouchFallbackContinuityBroken && (
                <div className="text-red-600 dark:text-red-400">
                  Recebimento: <strong>a continuidade do GTO foi interrompida antes da confirmação.</strong>
                </div>
              )}
              {status.resultSnapshotError && (
                <div className="text-red-600 dark:text-red-400">
                  Recuperação do resultado: <strong>{status.resultSnapshotError}</strong>
                </div>
              )}
              {status.logoutCleanupError && (
                <div className="text-red-600 dark:text-red-400">
                  Sessão GTO: <strong>{status.logoutCleanupError}</strong>
                </div>
              )}
              {status.projectionError && (
                <div className="text-red-600 dark:text-red-400">
                  Captura: <strong>{status.projectionError}</strong>
                </div>
              )}
              {status.overlayError && (
                <div className="text-red-600 dark:text-red-400">
                  Overlay: <strong>{status.overlayError}</strong>
                </div>
              )}
              {status.menuOverlayError && (
                <div className="text-red-600 dark:text-red-400">
                  Painel flutuante: <strong>{status.menuOverlayError}</strong>
                </div>
              )}
              {status.statusOverlayError && (
                <div className="text-amber-700 dark:text-amber-300">
                  Avisos flutuantes: <strong>{status.statusOverlayError}</strong>
                </div>
              )}
              {status.notificationError && (
                <div className="text-amber-700 dark:text-amber-300">
                  Serviço em segundo plano: <strong>{status.notificationError}</strong>
                </div>
              )}
              {status.touchPulseSensorError && (
                <div className="text-amber-700 dark:text-amber-300">
                  Sensor de seleção: <strong>{status.touchPulseSensorError}</strong> — confirmação visual reforçada ativa.
                </div>
              )}
              {status.lastFreightConflict && (
                <div className="text-amber-700 dark:text-amber-300">
                  Frete: <strong>leitura conflitante bloqueada; selecione novamente para evitar dados errados.</strong>
                </div>
              )}
              {status.gtoTripSyncError && (
                <div className="text-red-600 dark:text-red-400">
                  Envio: <strong>{status.gtoTripSyncError}</strong>
                </div>
              )}
              {status.gtoTripIntegrityError && (
                <div className="text-red-600 dark:text-red-400">
                  Integridade: <strong>{status.gtoTripIntegrityError}</strong>
                </div>
              )}
              {status.startError && (
                <div className="text-red-600 dark:text-red-400">
                  Serviço: <strong>{status.startError}</strong>
                </div>
              )}
              {status.frameProcessingError && (
                <div className="text-red-600 dark:text-red-400">
                  Leitura {status.frameProcessingErrorArea || "da tela"}: <strong>{status.frameProcessingError}</strong>
                </div>
              )}
              {status.lastEvent && <div className="truncate">Último evento: {status.lastEvent}</div>}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 mt-3">
            <button
              type="button"
              disabled={busy}
              onClick={status?.running ? openGto : configureOrStart}
              className="h-9 px-3 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[11px] sm:text-[12px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              <Play size={13} />
              {primaryLabel}
            </button>
            {(status?.gtoDurableQueueCount || 0) > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={syncPendingTrips}
                className="h-9 px-3 rounded-lg border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-[11px] sm:text-[12px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60"
              >
                Tentar enviar novamente
              </button>
            )}
            {status?.running && (
              <button
                type="button"
                disabled={busy}
                onClick={stop}
                className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-[11px] sm:text-[12px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60"
              >
                <Square size={12} />
                Desativar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
