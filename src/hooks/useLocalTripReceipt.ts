import { useEffect, useState } from "react";
import { auth } from "../lib/firebase";
import { getOfflineReceipt } from "../lib/offlineReceiptStore";

/** Preview the saved proof without uploading it or borrowing another account's image. */
export function useLocalTripReceipt(trip: any): string {
  const [preview, setPreview] = useState<{ key: string; url: string } | null>(null);
  const key = String(trip?.offlineReceiptKey || "");
  const companyId = String(trip?.companyId || trip?.empresaId || "");
  const driverId = String(trip?.driverId || trip?.motoristaId || "");
  const remote = String(trip?.comprovanteUrl || "");
  useEffect(() => {
    if (!key || remote || auth.currentUser?.uid !== driverId) return;
    let active = true, url = "";
    void getOfflineReceipt(key).then(receipt => {
      if (!active || !receipt || receipt.userId !== driverId || receipt.companyId !== companyId || auth.currentUser?.uid !== driverId) return;
      url = URL.createObjectURL(receipt.blob); setPreview({ key, url });
    }).catch(() => undefined);
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [key, companyId, driverId, remote]);
  return remote || (auth.currentUser?.uid === driverId && preview?.key === key ? preview.url : "");
}
