import { randomUUID } from "node:crypto";

/** A small PNG for Storage integrity tests, never a simulated game result. */
export async function createEmulatorReceipt(admin: any, companyId: string, uid: string, name: string) {
  if (!process.env.FIREBASE_STORAGE_EMULATOR_HOST || !String(admin.app().options.projectId).startsWith("demo-")) {
    throw new Error("Receipt fixtures require an isolated Storage Emulator.");
  }
  const bucket = `${admin.app().options.projectId}.appspot.com`;
  const path = `trip-receipts/${companyId}/${uid}/${name.replace(/[^a-zA-Z0-9._-]/g, "_")}.png`;
  const token = randomUUID();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZK0AAAAASUVORK5CYII=", "base64");
  await admin.storage().bucket(bucket).file(path).save(png, { metadata: {
    contentType: "image/png", metadata: { uploadedBy: uid, firebaseStorageDownloadTokens: token },
  }});
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}
