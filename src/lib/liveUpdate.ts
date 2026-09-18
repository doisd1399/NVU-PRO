import {
  checkOta,
  getOtaDiagnostic,
  otaManager,
  signalOtaReady,
  startOtaManager,
} from "./otaManager";

/** Compatibilidade de imports antigos: a implementação oficial está no OTAManager. */
export const checkSelfHostedLiveUpdate = (
  reason: "startup" | "resume" | "interval" | "manual" | "visibility" = "manual",
) => checkOta(reason === "visibility" ? "resume" : reason);

export const markLiveUpdateReady = signalOtaReady;
export { getOtaDiagnostic, otaManager, startOtaManager };
