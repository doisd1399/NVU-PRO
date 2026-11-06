import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "../lib/firebase";
import {
  APP_GUIDES_COLLECTION, buildGuideStoragePath, readGuideRecord, validateGuideFile,
  type AppGuideId, type AppGuideRecord,
} from "../lib/appGuides";

export type AppGuideRecords = Partial<Record<AppGuideId, AppGuideRecord>>;

/** Quem lê é qualquer usuário autenticado; erro de leitura (offline, regra ainda não publicada) deixa o guia do app. */
export function watchAppGuides(onChange: (records: AppGuideRecords) => void, onError?: (error: unknown) => void): () => void {
  return onSnapshot(collection(db, APP_GUIDES_COLLECTION), snapshot => {
    const records: AppGuideRecords = {};
    snapshot.forEach(item => { const record = readGuideRecord(item.id, item.data()); if (record) records[record.id] = record; });
    onChange(records);
  }, error => onError?.(error));
}

const removeObject = async (path: string) => { try { await deleteObject(ref(storage, path)); } catch { /* já removido ou sem permissão: a ficha é a fonte da verdade */ } };

/** Painel Sênior: troca o guia. O arquivo novo vira o guia assim que a ficha é gravada; o anterior é apagado depois. */
export async function uploadAppGuide(id: AppGuideId, file: File, updatedBy: string, previous?: AppGuideRecord | null): Promise<AppGuideRecord> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const problem = validateGuideFile(file, head);
  if (problem) throw new Error(problem);
  const storagePath = buildGuideStoragePath(id, file.name);
  const objectRef = ref(storage, storagePath);
  await uploadBytes(objectRef, file, { contentType: "application/pdf", cacheControl: "public, max-age=300" });
  let downloadUrl = "";
  try {
    downloadUrl = await getDownloadURL(objectRef);
    await setDoc(doc(db, APP_GUIDES_COLLECTION, id), {
      id, fileName: file.name.slice(0, 120), storagePath, downloadUrl, size: file.size, contentType: "application/pdf", updatedBy, updatedAt: serverTimestamp(),
    });
  } catch (error) {
    await removeObject(storagePath);
    throw error;
  }
  if (previous?.storagePath && previous.storagePath !== storagePath) await removeObject(previous.storagePath);
  return { id, fileName: file.name, storagePath, downloadUrl, size: file.size, contentType: "application/pdf", updatedBy };
}

/** Painel Sênior: remove o arquivo enviado; o app volta a mostrar o guia que acompanha a versão instalada. */
export async function deleteAppGuide(id: AppGuideId, current: AppGuideRecord): Promise<void> {
  await deleteDoc(doc(db, APP_GUIDES_COLLECTION, id));
  await removeObject(current.storagePath);
}
