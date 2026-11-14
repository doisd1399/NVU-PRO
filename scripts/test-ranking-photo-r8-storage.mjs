import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, doc, setDoc, getFirestore } from "firebase/firestore";
import { connectStorageEmulator, getDownloadURL, getStorage, ref, uploadBytes, getBytes } from "firebase/storage";

const projectId = process.env.GCLOUD_PROJECT || "demo-r8-storage";
const apps = [];
async function makeUser(label, companyId) {
  const app = initializeApp({ apiKey: "demo-api-key", authDomain: "localhost", projectId, storageBucket: `${projectId}.appspot.com` }, label);
  apps.push(app);
  const auth = getAuth(app); connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app); connectFirestoreEmulator(db, "127.0.0.1", 8085);
  const storage = getStorage(app); connectStorageEmulator(storage, "127.0.0.1", 9199);
  const credential = await createUserWithEmailAndPassword(auth, `${label}@example.test`, "Password123!");
  await setDoc(doc(db, "users", credential.user.uid), { companyId, role: "driver" });
  return { auth, db, storage, uid: credential.user.uid, companyId };
}
const a = await makeUser("storage-a", "company-a");
const b = await makeUser("storage-b", "company-b");
// 1x1 transparent PNG: the test must prove that stored bytes are a real image,
// not arbitrary text mislabeled as image/webp.
const bytes = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
));
const path = `empresas/${a.companyId}/vehicle-photos-gto/${a.uid}/vehicle.webp`;
const uploaded = await uploadBytes(ref(a.storage, path), bytes, { contentType: "image/png" });
assert.equal(uploaded.metadata.contentType, "image/png");
const url = await getDownloadURL(uploaded.ref);
assert.match(url, /vehicle\.webp/);
const downloadedByOwner = await getBytes(ref(a.storage, path));
assert.deepEqual([...new Uint8Array(downloadedByOwner)], [...bytes]);
const downloadedByOther = await getBytes(ref(b.storage, path));
assert.deepEqual([...new Uint8Array(downloadedByOther)], [...bytes]);
await assert.rejects(() => uploadBytes(ref(b.storage, `empresas/${a.companyId}/vehicle-photos-gto/${a.uid}/foreign.webp`), bytes, { contentType: "image/webp" }));
console.log("PASS Storage Emulator upload autenticado de imagem com tenant e UID corretos");
console.log("PASS download autenticado pelo proprietário preserva bytes");
console.log("PASS download autorizado por outro usuário retorna a mesma foto pública controlada");
console.log("PASS upload em caminho de outra identidade é negado");
console.log("R8_STORAGE_AUTHENTICATED_PASS 4 checks");
await Promise.all(apps.map(deleteApp));
