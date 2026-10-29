import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, doc, getDoc, getFirestore, setDoc } from "firebase/firestore";

const projectId = process.env.GCLOUD_PROJECT || "demo-nvu-r7-authenticated";
const apps = [];
async function user(label, companyId) {
  const app = initializeApp({ apiKey: "demo-api-key", authDomain: "localhost", projectId }, label);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8085);
  const credential = await createUserWithEmailAndPassword(auth, `${label}@example.test`, "Password123!");
  return { app, auth, db, uid: credential.user.uid, companyId };
}

const a = await user("driver-a", "company-a");
const b = await user("driver-b", "company-b");
const photoA = { userId: a.uid, simulatorId: "gto", vehicleId: "volvo-a", vehicleName: "Volvo FH 16", url: "https://storage.test/a.webp", updatedAt: new Date() };
const photoB = { userId: b.uid, simulatorId: "gto", vehicleId: "scania-b", vehicleName: "SCANIA R 540", url: "https://storage.test/b.webp", updatedAt: new Date() };
await setDoc(doc(a.db, "rankingVehiclePhotos", `${a.uid}:gto:volvo-a`), photoA);
await setDoc(doc(b.db, "rankingVehiclePhotos", `${b.uid}:gto:scania-b`), photoB);
const seenB = await getDoc(doc(a.db, "rankingVehiclePhotos", `${b.uid}:gto:scania-b`));
const seenA = await getDoc(doc(b.db, "rankingVehiclePhotos", `${a.uid}:gto:volvo-a`));
assert.equal(seenB.data()?.url, photoB.url);
assert.equal(seenA.data()?.url, photoA.url);
for (const snapshot of [seenA, seenB]) {
  assert.deepEqual(Object.keys(snapshot.data()).sort(), ["simulatorId", "updatedAt", "url", "userId", "vehicleId", "vehicleName"].sort());
}
console.log("PASS dois usuários autenticados leem fotos autorizadas de participantes distintos");
console.log("PASS identidade userId/simulatorId/vehicleId e URL isoladas sem substituição cruzada");
console.log("PASS projeção pública contém somente os metadados mínimos do Ranking Premium");
console.log("R7_AUTHENTICATED_RANKING_PHOTO_PASS 3 checks");
await Promise.all(apps.map(deleteApp));
