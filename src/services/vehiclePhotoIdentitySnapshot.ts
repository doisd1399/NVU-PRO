import { vehiclePhotoKey, type VehiclePhotoIdentity } from "../lib/vehiclePhotoIdentity";

const PREFIX = "nvu-vehicle-photo-identity:";
const VERSION = 2;
export type VehiclePhotoSnapshotScope = { viewerId?: string; simulatorId?: string };
export type VehiclePhotoIdentitySnapshot = VehiclePhotoIdentity & {
  companyId: string; operationId?: string; evidenceAt?: number; source: "operation" | "last-used";
  operationCompanyId?: string; companyName?: string; companyLogo?: string;
  viewerId?: string; scopeSimulatorId?: string; version: 2; savedAt: number;
};
const companyKey = (id: string) => String(id || "all").trim() || "all";
const baseKey = (userId: string, companyId: string) => `${PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(companyKey(companyId))}`;
const keyFor = (userId: string, companyId: string, scope: VehiclePhotoSnapshotScope) =>
  `${baseKey(userId, companyId)}:${encodeURIComponent(scope.simulatorId || "all")}:${encodeURIComponent(scope.viewerId || "session")}`;

export function readVehiclePhotoIdentitySnapshot(userId: string, companyId: string, scope: VehiclePhotoSnapshotScope = {}): VehiclePhotoIdentitySnapshot | null {
  if (typeof localStorage === "undefined" || !userId) return null;
  try {
    const value = JSON.parse(localStorage.getItem(keyFor(userId, companyId, scope)) || localStorage.getItem(baseKey(userId, companyId)) || "null");
    if (!value || ![1, VERSION].includes(value.version) || value.userId !== userId || companyKey(value.companyId) !== companyKey(companyId)) return null;
    if (typeof value.simulatorId !== "string" || typeof value.vehicleId !== "string" || !value.simulatorId.trim() || !value.vehicleId.trim()) return null;
    if (value.version === VERSION && (value.viewerId !== (scope.viewerId || "") || value.scopeSimulatorId !== (scope.simulatorId || "all"))) return null;
    if (value.version === 1 && scope.simulatorId && scope.simulatorId !== "all" && value.simulatorId !== scope.simulatorId) return null;
    vehiclePhotoKey(value);
    return { ...value, companyId: companyKey(companyId), version: VERSION };
  } catch { return null; }
}

export function writeVehiclePhotoIdentitySnapshot(snapshot: Omit<VehiclePhotoIdentitySnapshot, "version" | "savedAt">, scope: VehiclePhotoSnapshotScope = {}): void {
  if (typeof localStorage === "undefined" || !snapshot.userId) return;
  try {
    vehiclePhotoKey(snapshot);
    const value = { ...snapshot, companyId: companyKey(snapshot.companyId), viewerId: scope.viewerId || "", scopeSimulatorId: scope.simulatorId || "all", version: VERSION, savedAt: Date.now() };
    localStorage.setItem(keyFor(snapshot.userId, snapshot.companyId, scope), JSON.stringify(value));
  } catch { /* Bytes remain durable; callers do not claim snapshot persistence. */ }
}

export function clearVehiclePhotoIdentitySnapshot(userId: string, companyId: string, scope: VehiclePhotoSnapshotScope = {}): void {
  try {
    localStorage.removeItem(keyFor(userId, companyId, scope));
    localStorage.removeItem(baseKey(userId, companyId));
  } catch { /* optional cleanup */ }
}
