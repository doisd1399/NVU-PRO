import { httpsCallable } from "firebase/functions";
import { auth, functions } from "../lib/firebase";

type Lookup = { ids?: string[]; email?: string; companyId?: string; existenceOnly?: boolean };
type Profile = Record<string, any> & { id: string };
export async function lookupPrivateProfiles(input: Lookup) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Sessão indisponível.");
  const result = await httpsCallable<Lookup, { profiles: Profile[]; exists?: boolean }>(functions, "readPrivateUserProfiles")(input);
  if (auth.currentUser?.uid !== uid) throw new Error("Sessão alterada durante a consulta.");
  return result.data;
}
export async function queryPrivateUsers(input: Lookup) {
  const result = await lookupPrivateProfiles(input);
  const docs = result.profiles.map(profile => ({ id: profile.id, exists: () => true, data: () => profile }));
  return { docs, empty: docs.length === 0, size: docs.length };
}
export async function readPrivateUser(userId: string, companyId?: string) {
  const result = await queryPrivateUsers({ ids: [userId], ...(companyId ? { companyId } : {}) });
  return result.docs[0] || { id: userId, exists: () => false, data: () => undefined };
}
/** Only pending Senior actions poll private status; account changes cancel publication. */
export function watchPrivateUser(userId: string, next: (snapshot: Awaited<ReturnType<typeof readPrivateUser>>) => void) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const uid = auth.currentUser?.uid;
  const poll = async () => {
    try { const snapshot = await readPrivateUser(userId); if (!stopped && auth.currentUser?.uid === uid) next(snapshot); }
    catch { /* The durable action remains available on the next refresh. */ }
    if (!stopped && auth.currentUser?.uid === uid) timer = setTimeout(poll, 5000);
  };
  void poll();
  return () => { stopped = true; clearTimeout(timer); };
}
