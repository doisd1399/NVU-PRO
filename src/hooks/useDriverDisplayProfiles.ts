import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { driverDisplayIdentity } from "../lib/driverDisplayIdentity";

/** Only exact linked legacy forms are read, once per scope/profile revision.
 * Modern profiles already contain their approved identity and need no fetch. */
export function useDriverDisplayProfiles<T extends { id: string }>(profiles: T[], companyId: string, uid: string) {
  const scope = JSON.stringify([uid, companyId]);
  const [forms, setForms] = useState<{ scope: string; rows: Record<string, any> }>({ scope: "", rows: {} });
  const linkedIds = [...new Set(profiles.filter((profile: any) => profile.approvedIdentityVersion !== 2 &&
    (profile.profileNameSource !== "user_edit" || profile.profilePhotoSource !== "user_edit"))
    .map((profile: any) => profile.approvedIdentityApplicationId ||
    (profile.currentRecruitmentStatus === "approved" ? profile.currentRecruitmentApplicationId : ""))
    .filter((id): id is string => typeof id === "string" && Boolean(id) && !id.includes("/")))];
  const idsKey = JSON.stringify(linkedIds.sort());
  useEffect(() => {
    let active = true;
    if (!uid || !companyId) return;
    const missing = linkedIds.filter(id => forms.scope !== scope || !Object.hasOwn(forms.rows, id));
    if (!missing.length) return;
    void (async () => {
      // Bound concurrency on large fleets; one failed legacy form cannot hide others.
      const rows: Record<string, any> = {};
      for (let offset = 0; offset < missing.length; offset += 8) {
        await Promise.all(missing.slice(offset, offset + 8).map(async id => {
          try {
            const snapshot = await getDoc(doc(db, "recruitment_applications", id));
            const data = snapshot.data();
            rows[id] = data?.companyId === companyId ? { ...data, id } : null;
          } catch { rows[id] = null; }
        }));
        if (!active) return;
      }
      if (active) setForms(current => ({ scope, rows: { ...(current.scope === scope ? current.rows : {}), ...rows } }));
    })();
    return () => { active = false; };
  }, [scope, idsKey]);
  return useMemo(() => profiles.map((profile: any) => {
    const id = profile.approvedIdentityApplicationId || profile.currentRecruitmentApplicationId;
    return { ...profile, ...driverDisplayIdentity(profile, forms.scope === scope ? forms.rows[id] : null) } as T;
  }), [profiles, forms, scope]);
}
