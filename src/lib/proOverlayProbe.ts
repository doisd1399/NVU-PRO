import { Capacitor, registerPlugin } from "@capacitor/core";

export type ProOverlayProbeStage =
  | "NOT_RUN"
  | "WAITING_CONSENT"
  | "STARTING"
  | "OVERLAY_OK"
  | "NOT_GRANTED"
  | "ADD_VIEW_FAILED"
  | "DENIED"
  | "CAPTURE_FAILED"
  | "SERVICE_ERROR"
  | "CONSENT_ERROR"
  | "STOPPED"
  | "UNAVAILABLE"
  | string;

export interface ProOverlayProbeStatus {
  stage: ProOverlayProbeStage;
  active?: boolean;
  detail?: string;
  checkedAt?: number;
}

interface ProOverlayProbePlugin {
  run(): Promise<ProOverlayProbeStatus>;
  stop(): Promise<ProOverlayProbeStatus>;
  getStatus(): Promise<ProOverlayProbeStatus>;
}

export const ProOverlayProbe = registerPlugin<ProOverlayProbePlugin>("ProOverlayProbe");

export const isProOverlayProbeAvailable = (): boolean =>
  Capacitor.isNativePlatform()
  && Capacitor.getPlatform() === "android"
  && Capacitor.isPluginAvailable("ProOverlayProbe");
