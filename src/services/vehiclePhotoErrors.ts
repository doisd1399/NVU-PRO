export type VehiclePhotoErrorStage = "metadata" | "download" | "decode" | "cache" | "publish";

export function vehiclePhotoErrorCode(failure: unknown, stage: VehiclePhotoErrorStage): string {
  const error = failure as { code?: unknown; name?: string; message?: string } | null;
  const values = [typeof error?.code === "string" ? error.code : "", error?.name || "", error?.message || ""];
  const explicit = values.find((value) => /^VEHICLE_PHOTO_[A-Z0-9_]+$/.test(value));
  if (explicit) return explicit;
  const raw = values.join(" ");
  const access = raw.match(/permission-denied|unauthenticated|unavailable|not-found/i);
  if (access) return access[0].toLowerCase();
  if (/abort|timeout|deadline-exceeded/i.test(raw)) return `VEHICLE_PHOTO_${stage.toUpperCase()}_TIMEOUT`;
  if (/failed to fetch|network|load failed/i.test(raw)) return `VEHICLE_PHOTO_${stage.toUpperCase()}_NETWORK`;
  if (/decode|decod|invalid image|compact/i.test(raw)) return "VEHICLE_PHOTO_DECODE_INVALID";
  if (/quota|indexeddb|storage/i.test(raw)) return "VEHICLE_PHOTO_CACHE_FAILED";
  return `VEHICLE_PHOTO_${stage.toUpperCase()}_FAILED`;
}

export function vehiclePhotoFailure(failure: unknown, stage: VehiclePhotoErrorStage): Error {
  return Object.assign(new Error(vehiclePhotoErrorCode(failure, stage), { cause: failure }), { code: vehiclePhotoErrorCode(failure, stage), stage });
}
