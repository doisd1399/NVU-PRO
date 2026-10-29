import * as admin from "./firebaseAdmin";
import * as functions from "firebase-functions/v1";

const fail = (code: functions.https.FunctionsErrorCode, message: string): never => {
  throw new functions.https.HttpsError(code, message);
};
const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9.\-_]/g, "");

/** Verify the existing Print upload; no extra step is required from the driver. */
export async function verifyPrintReceipt(url: string, companyId: string, uid: string): Promise<string> {
  let receipt: URL;
  try { receipt = new URL(url); } catch { return fail("invalid-argument", "Comprovante inválido."); }
  const emulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  const emulator = Boolean(emulatorHost && receipt.host === emulatorHost);
  const firebaseUrl = (receipt.protocol === "https:" && receipt.hostname === "firebasestorage.googleapis.com") || emulator;
  const match = firebaseUrl ? receipt.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/) : null;
  if (!match) return fail("invalid-argument", "Envie o comprovante pelo aplicativo antes de registrar a viagem.");
  let bucket: string, path: string;
  try { bucket = decodeURIComponent(match[1]); path = decodeURIComponent(match[2]); }
  catch { return fail("invalid-argument", "Endereço do comprovante inválido."); }
  const options = admin.app().options;
  const projectId = options.projectId || process.env.GCLOUD_PROJECT;
  const allowedBuckets = [options.storageBucket, `${projectId}.appspot.com`, `${projectId}.firebasestorage.app`];
  const ownerPrefix = `trip-receipts/${sanitize(companyId)}/${sanitize(uid)}/`;
  const legacyPath = path.split("/");
  const legacyScoped = legacyPath[0] === "empresas" && legacyPath[1] === sanitize(companyId) && legacyPath[3] === sanitize(uid);
  if (!allowedBuckets.includes(bucket) || (!path.startsWith(ownerPrefix) && !legacyScoped) || path.endsWith("/")) {
    return fail("permission-denied", "O comprovante não pertence a este motorista e empresa.");
  }
  let metadata: any;
  try { [metadata] = await admin.storage().bucket(bucket).file(path).getMetadata(); }
  catch (error) {
    if (Number((error as any)?.code) === 404) return fail("invalid-argument", "O comprovante não foi encontrado. Reenvie a imagem preservada.");
    return fail("unavailable", "Não foi possível confirmar o comprovante agora. A viagem permanece salva para nova tentativa.");
  }
  if (!/^image\//i.test(String(metadata.contentType || "")) || Number(metadata.size) <= 0 ||
      Number(metadata.size) > 10 * 1024 * 1024 || metadata.metadata?.uploadedBy !== uid) {
    return fail("invalid-argument", "O comprovante enviado não é uma imagem válida deste motorista.");
  }
  return `${bucket}/${path}`;
}
