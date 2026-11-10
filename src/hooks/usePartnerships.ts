import { useEffect, useState } from "react";
import { partnershipService } from "../services/partnershipService";
import type { Partnership } from "../lib/partnerships";

export type PartnershipsState = { rows: Partnership[]; ready: boolean; error: boolean };

/** Parcerias da empresa ativa (tempo real). Sem empresa, devolve lista vazia e pronta. */
export function usePartnerships(companyId: string | null | undefined): PartnershipsState {
  const [state, setState] = useState<PartnershipsState & { key: string }>({ rows: [], ready: false, error: false, key: "" });
  useEffect(() => {
    if (!companyId) return;
    const key = companyId;
    return partnershipService.subscribeCompany(companyId,
      rows => setState({ rows, ready: true, error: false, key }),
      () => setState(current => ({ rows: current.key === key ? current.rows : [], ready: true, error: true, key })));
  }, [companyId]);
  if (!companyId) return { rows: [], ready: true, error: false };
  return state.key === companyId ? state : { rows: [], ready: false, error: false };
}
