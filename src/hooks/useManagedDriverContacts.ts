import { useEffect, useState } from "react";
import { lookupPrivateProfiles } from "../services/privateUserProfiles";
/** Contacts are requested only while the management screen is mounted, never persisted. */
export function useManagedDriverContacts(uid: string, companyId: string, ids: string[]) {
  const key = JSON.stringify([uid, companyId, [...new Set(ids)].sort()]);
  const [snapshot, setSnapshot] = useState<{ key: string; profiles: Record<string, any>[] }>({key:"",profiles:[]});
  useEffect(() => {
    let active = true;
    if (!uid || !companyId || !ids.length) return;
    const unique = [...new Set(ids)];
    void (async () => {
      const profiles: Record<string, any>[] = [];
      for (let offset = 0; offset < unique.length; offset += 30) {
        try {
          const result = await lookupPrivateProfiles({ids:unique.slice(offset,offset+30),companyId});
          profiles.push(...result.profiles.map(row => ({id:row.id,name:row.name,profilePhotoURL:row.profilePhotoURL,email:row.email,whatsapp:row.whatsapp})));
        } catch { /* Removed relationships must not retain their private contacts. */ }
        if (!active) return;
      }
      if (active) setSnapshot({key,profiles});
    })();
    return () => { active = false; };
  }, [key]);
  return snapshot.key === key ? snapshot.profiles : [];
}
