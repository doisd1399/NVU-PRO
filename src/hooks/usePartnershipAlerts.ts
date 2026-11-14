import { useEffect, useMemo, useState } from "react";
import { PARTNERSHIP_SEEN_EVENT, readPartnershipSeen } from "../lib/partnershipSeen";
import { partnershipAlerts, type Partnership, type PartnershipAlerts } from "../lib/partnerships";

/** Indicador da Central: ofertas para responder + novidades desde a última visita à página de Parcerias. */
export function usePartnershipAlerts(rows: Partnership[], companyId: string | null | undefined, userId: string | null | undefined): PartnershipAlerts {
  const [seen, setSeen] = useState(() => readPartnershipSeen(String(userId || ""), String(companyId || "")));
  useEffect(() => {
    const refresh = () => setSeen(readPartnershipSeen(String(userId || ""), String(companyId || "")));
    refresh();
    window.addEventListener(PARTNERSHIP_SEEN_EVENT, refresh); window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(PARTNERSHIP_SEEN_EVENT, refresh); window.removeEventListener("storage", refresh); };
  }, [companyId, userId]);
  return useMemo(() => partnershipAlerts(rows, String(companyId || ""), seen), [rows, companyId, seen]);
}
