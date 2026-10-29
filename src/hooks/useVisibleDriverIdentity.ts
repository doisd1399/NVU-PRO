import { useEffect, useMemo, useState } from "react";
import { collection, documentId, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { driverDisplayIdentity } from "../lib/driverDisplayIdentity";

/** Live, bounded identity projection for authenticated public-profile views.
 * Trip snapshots remain untouched; only the person's displayed identity changes. */
export function useVisibleDriverIdentity(ids: string[], enabled: boolean) {
  const key = JSON.stringify([...new Set(ids.filter(Boolean))].sort());
  const [snapshot, setSnapshot] = useState<{ key: string; rows: Record<string, ReturnType<typeof driverDisplayIdentity>> }>({ key: "", rows: {} });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const ids = JSON.parse(key) as string[];
    const batches: Record<number, Record<string, ReturnType<typeof driverDisplayIdentity>>> = {};
    const stops: Array<() => void> = [];
    for (let offset = 0; offset < ids.length; offset += 30) {
      const batch = offset;
      stops.push(onSnapshot(query(collection(db, "public_users"), where(documentId(), "in", ids.slice(offset, offset + 30))), rows => {
        if (!active) return;
        batches[batch] = Object.fromEntries(rows.docs.map(row => [row.id, driverDisplayIdentity({ ...row.data(), id: row.id })]));
        setSnapshot({ key, rows: Object.assign({}, ...Object.values(batches)) });
      }, () => { /* Keep trip data visible; never import the provider identity. */ }));
    }
    return () => { active = false; stops.forEach(stop => stop()); };
  }, [key, enabled]);
  return useMemo(() => enabled && snapshot.key === key ? snapshot.rows : {}, [snapshot, key, enabled]);
}
