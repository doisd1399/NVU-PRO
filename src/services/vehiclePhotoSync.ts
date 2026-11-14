import { vehiclePhotoKey, type VehiclePhotoIdentity } from "../lib/vehiclePhotoIdentity";
import { getVehiclePhotoRecord, listPendingVehiclePhotos, updateVehiclePhotoRecord, type VehiclePhotoRecord } from "./vehiclePhotoStore";
import { vehiclePhotoErrorCode } from "./vehiclePhotoErrors";

export function createVehiclePhotoSync(dependencies: {
  currentUserId: () => string | undefined;
  upload: (record: VehiclePhotoRecord) => Promise<string>;
  writeMetadata: (record: VehiclePhotoRecord, url: string) => Promise<void>;
}) {
  const running = new Map<string, Promise<void>>();
  const queues = new Map<string, Promise<void>>();
  const assertOwner = (identity: VehiclePhotoIdentity) => {
    if (dependencies.currentUserId() !== identity.userId) throw new Error("VEHICLE_PHOTO_SESSION_CHANGED");
  };
  async function sync(identity: VehiclePhotoIdentity): Promise<void> {
    const key = vehiclePhotoKey(identity);
    const existing = running.get(key);
    if (existing) {
      await existing.catch(() => undefined);
      return sync(identity); // A second selection during an upload must also be sent.
    }
    const task = (async () => {
      for (;;) {
        let record = await getVehiclePhotoRecord(identity);
        if (!record || (record.status !== "pending" && !record.needsPublication)) return;
        assertOwner(record);
        let url = record.remoteUrl;
        if (!url) {
          try { url = await dependencies.upload(record); }
          catch (error) {
            if (dependencies.currentUserId() === record.userId)
              await updateVehiclePhotoRecord(record, { failure: { stage: "upload", code: vehiclePhotoErrorCode(error, "publish"), attempts: Math.min(100, (record.failure?.attempts || 0) + 1), at: Date.now() } });
            throw error;
          }
        }
        assertOwner(record);
        const updated = await updateVehiclePhotoRecord(record, { remoteUrl: url, needsPublication: true });
        if (!updated) continue; // A newer locally selected image won the race.
        record = updated;
        assertOwner(record);
        try { await dependencies.writeMetadata(record, url); }
        catch (error) {
          if (dependencies.currentUserId() === record.userId)
            await updateVehiclePhotoRecord(record, { failure: { stage: "publish", code: vehiclePhotoErrorCode(error, "publish"), attempts: Math.min(100, (record.failure?.attempts || 0) + 1), at: Date.now() } });
          throw error;
        }
        assertOwner(record);
        const confirmed = await updateVehiclePhotoRecord(record, { status: "synced", needsPublication: false, failure: undefined });
        if (confirmed && (await getVehiclePhotoRecord(identity))?.status !== "pending") return;
      }
    })();
    running.set(key, task);
    try { await task; } finally { running.delete(key); }
  }
  async function drainPending(userId: string): Promise<void> {
    assertOwner({ userId, simulatorId: "check", vehicleId: "check" });
    for (const record of await listPendingVehiclePhotos(userId)) {
      assertOwner(record);
      try { await sync(record); }
      catch (error) {
        if (dependencies.currentUserId() !== userId) throw error;
        // Keep all unsent images; failure on one vehicle does not erase another.
        console.warn("[NVU] Foto preservada localmente para sincronização:", error);
      }
    }
  }
  async function syncPending(userId: string): Promise<void> {
    assertOwner({ userId, simulatorId: "check", vehicleId: "check" });
    if (queues.has(userId)) return queues.get(userId)!;
    const task = drainPending(userId);
    queues.set(userId, task);
    try { await task; } finally { if (queues.get(userId) === task) queues.delete(userId); }
  }
  return { sync, syncPending };
}
