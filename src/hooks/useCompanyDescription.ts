import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { normalizeCompanyDescription } from "../lib/companyProfileDescription";
import { companyDescriptionKey, COMPANY_DESCRIPTION_CHANGED, readCompanyDescription } from "../services/companyDescriptionStore";
import { retryCompanyDescriptionSync, saveCompanyDescription } from "../services/companyDescriptionService";

export function useCompanyDescription(viewerId: string, companyId: string, canEdit: boolean, known: Record<string, any>) {
  const key = companyDescriptionKey(viewerId, companyId);
  const [local, setLocal] = useState(() => canEdit ? readCompanyDescription(viewerId, companyId) : null);
  const [remote, setRemote] = useState({ key, text: normalizeCompanyDescription(known.profileDescription), confirmed: false });
  useEffect(() => {
    let active = true;
    const hydrate = () => setLocal(canEdit ? readCompanyDescription(viewerId, companyId) : null);
    hydrate();
    setRemote({ key, text: normalizeCompanyDescription(known.profileDescription), confirmed: false });
    const change = (event: Event) => {
      if (event instanceof StorageEvent ? event.key === key : (event as CustomEvent).detail?.key === key) hydrate();
    };
    const stop = onSnapshot(doc(db, "frotas", companyId), { includeMetadataChanges: true }, snapshot => {
      const { fromCache, hasPendingWrites } = snapshot.metadata;
      if (active && !hasPendingWrites && (snapshot.exists() || !fromCache)) {
        setRemote({ key, text: normalizeCompanyDescription(snapshot.data()?.profileDescription), confirmed: !fromCache });
      }
    }, () => { /* Preserve the known identity on temporary read failure. */ });
    window.addEventListener(COMPANY_DESCRIPTION_CHANGED, change); window.addEventListener("storage", change);
    return () => { active = false; stop(); window.removeEventListener(COMPANY_DESCRIPTION_CHANGED, change); window.removeEventListener("storage", change); };
  }, [key, canEdit, known.profileDescription]);
  const current = canEdit && local?.viewerId === viewerId && local.companyId === companyId ? local : null;
  const canonical = remote.key === key ? remote : { text: normalizeCompanyDescription(known.profileDescription), confirmed: false };
  return {
    text: current?.status === "pending" || (current && !canonical.confirmed) ? current.text : canonical.text,
    pending: current?.status === "pending", failed: Boolean(current?.failed),
    save: (text: string) => { if (!canEdit) throw new Error("Somente administradores podem editar a descrição."); return saveCompanyDescription(viewerId, companyId, text); },
    retry: retryCompanyDescriptionSync,
  };
}
