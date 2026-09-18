export type LiveUpdateStatusPhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "verifying"
  | "staged"
  | "completed"
  | "failed"
  | "rolled_back";

export type LiveUpdateStatusDetail = {
  phase: LiveUpdateStatusPhase;
  bundleId?: string;
  errorCode?: string;
  timestamp?: number;
};

export const LIVE_UPDATE_STATUS_EVENT = "nvu-live-update-status";

let latestLiveUpdateStatus: LiveUpdateStatusDetail | null = null;

export function getLatestLiveUpdateStatus(): LiveUpdateStatusDetail | null {
  return latestLiveUpdateStatus;
}

export function dispatchLiveUpdateStatus(
  detail: LiveUpdateStatusDetail,
): void {
  latestLiveUpdateStatus = {
    ...detail,
    timestamp: detail.timestamp || Date.now(),
  };
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<LiveUpdateStatusDetail>(LIVE_UPDATE_STATUS_EVENT, {
      detail: latestLiveUpdateStatus,
    }),
  );
}
