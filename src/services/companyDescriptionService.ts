import { onAuthStateChanged } from "firebase/auth";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { isAuthTeardownActive } from "../lib/authLifecycle";
import { normalizeCompanyDescription } from "../lib/companyProfileDescription";
import { createCompanyDescriptionSync, putCompanyDescription } from "./companyDescriptionStore";

const REQUEST = "nvu:company-description-sync";
let generation = 0;
const uid = () => isAuthTeardownActive() ? undefined : auth.currentUser?.uid;
const sync = createCompanyDescriptionSync({ uid, generation: () => generation, online: () => navigator.onLine !== false,
  publish: record => updateDoc(doc(db, "frotas", record.companyId), {
    profileDescription: record.text, profileDescriptionRevision: record.revision, profileDescriptionUpdatedAt: serverTimestamp(),
  }),
});
export function retryCompanyDescriptionSync() { window.dispatchEvent(new Event(REQUEST)); }

export async function saveCompanyDescription(viewerId: string, companyId: string, text: string): Promise<void> {
  const session = generation;
  if (uid() !== viewerId || !companyId || companyId.length > 180 || /[\/\0]/.test(companyId)) throw new Error("Abra o perfil novamente para salvar.");
  await putCompanyDescription({ viewerId, companyId, text: normalizeCompanyDescription(text), revision: crypto.randomUUID(), status: "pending" });
  if (uid() !== viewerId || generation !== session) throw new Error("Sua sessão mudou. A descrição continua salva neste aparelho.");
  retryCompanyDescriptionSync();
}
export function startCompanyDescriptionSync(): () => void {
  let stopped = false;
  const drain = () => { if (!stopped) void sync.drain().catch(() => undefined); };
  const visible = () => { if (document.visibilityState === "visible") drain(); };
  const authStop = onAuthStateChanged(auth, () => { generation++; drain(); });
  window.addEventListener(REQUEST, drain); window.addEventListener("online", drain); window.addEventListener("focus", drain);
  window.addEventListener("storage", drain); document.addEventListener("visibilitychange", visible);
  let nativeStop: (() => void) | undefined;
  void import("@capacitor/app").then(({ App }) => App.addListener("appStateChange", state => { if (state.isActive) drain(); }))
    .then(listener => { if (stopped) void listener.remove(); else nativeStop = () => { void listener.remove(); }; }).catch(() => undefined);
  drain();
  return () => {
    stopped = true; generation++; authStop(); nativeStop?.();
    window.removeEventListener(REQUEST, drain); window.removeEventListener("online", drain); window.removeEventListener("focus", drain);
    window.removeEventListener("storage", drain); document.removeEventListener("visibilitychange", visible);
  };
}
