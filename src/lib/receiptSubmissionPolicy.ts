/** A Print receipt must reach Storage before its trip can be committed remotely. */
export function hasPendingReceiptUpload(data: Record<string, unknown>): boolean {
  return Boolean(String(data.offlineReceiptKey || "").trim());
}

export function shouldQueueTripLocally(
  data: Record<string, unknown>,
  isOffline: boolean,
  allowOfflineQueue = true,
): boolean {
  if (hasPendingReceiptUpload(data) && !allowOfflineQueue) {
    throw new Error("OFFLINE_RECEIPT_UPLOAD_REQUIRED");
  }
  return allowOfflineQueue && (isOffline || hasPendingReceiptUpload(data));
}

export function assertRemoteTripReceiptReady(data: Record<string, unknown>): void {
  if (hasPendingReceiptUpload(data) ||
      (data.imageHash && !String(data.comprovanteUrl || "").trim())) {
    throw new Error("TRIP_RECEIPT_UPLOAD_REQUIRED");
  }
}
