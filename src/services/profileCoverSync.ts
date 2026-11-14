import type { ProfileCoverTarget } from "../lib/profileCover";
import { getProfileCover, listPendingProfileCovers, updateProfileCover, type ProfileCoverRecord } from "./profileCoverStore";

export function createProfileCoverSync(dependencies: {
  currentUserId: () => string | undefined;
  sessionGeneration: () => number;
  online: () => boolean;
  upload: (record: ProfileCoverRecord) => Promise<string>;
  publish: (record: ProfileCoverRecord, url: string) => Promise<void>;
}) {
  const running = new Map<string, Promise<void>>();
  async function sync(viewerId: string, target: ProfileCoverTarget): Promise<void> {
    const generation = dependencies.sessionGeneration();
    const assertSession = () => {
      if (dependencies.currentUserId() !== viewerId || dependencies.sessionGeneration() !== generation) throw new Error("PROFILE_COVER_SESSION_CHANGED");
    };
    assertSession();
    if (target.scope === "driver" && target.profileId !== viewerId) throw new Error("PROFILE_COVER_NOT_OWNER");
    const key = `${viewerId}:${target.scope}:${target.profileId}`;
    const previous = running.get(key);
    if (previous) { await previous.catch(() => undefined); assertSession(); return sync(viewerId, target); }
    const task = (async () => {
      for (;;) {
        assertSession();
        if (!dependencies.online()) return;
        let record = await getProfileCover(viewerId, target);
        assertSession();
        if (!record || record.status !== "pending") return;
        try {
          let url = record.remoteUrl;
          if (!record.removed && !url) url = await dependencies.upload(record);
          assertSession();
          const uploaded = await updateProfileCover(record, { remoteUrl: url, failure: false });
          if (!uploaded) continue;
          record = uploaded;
          assertSession();
          await dependencies.publish(record, url);
          assertSession();
          // Only the server acknowledgement permits the synchronized state.
          const confirmed = await updateProfileCover(record, { status: "synced", failure: false });
          if (confirmed) return;
        } catch (error) {
          assertSession();
          await updateProfileCover(record, { failure: true });
          throw error;
        }
      }
    })();
    running.set(key, task);
    try { await task; } finally { if (running.get(key) === task) running.delete(key); }
  }
  async function syncPending(viewerId: string): Promise<void> {
    const generation = dependencies.sessionGeneration();
    for (const record of await listPendingProfileCovers(viewerId)) {
      if (dependencies.currentUserId() !== viewerId || dependencies.sessionGeneration() !== generation) return;
      try { await sync(viewerId, record); } catch { /* Durable record remains available for retry. */ }
    }
  }
  return { sync, syncPending };
}
