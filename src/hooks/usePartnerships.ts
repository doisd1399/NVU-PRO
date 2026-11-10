import { useEffect, useMemo, useState } from "react";
import { partnershipService } from "../services/partnershipService";
import type { Partnership } from "../lib/partnerships";

export type PartnershipsState = { rows: Partnership[]; ready: boolean; error: boolean };
const EMPTY: Partnership[] = [];

/** Parcerias da empresa ativa (tempo real). Sem empresa, devolve lista vazia e pronta. */
export function usePartnerships(companyId: string | null | undefined): PartnershipsState {
  const [state, setState] = useState<PartnershipsState & { key: string }>({ rows: EMPTY, ready: false, error: false, key: "" });
  useEffect(() => {
    if (!companyId) return;
    const key = companyId;
    return partnershipService.subscribeCompany(companyId,
      rows => setState({ rows, ready: true, error: false, key }),
      () => setState(current => ({ rows: current.key === key ? current.rows : EMPTY, ready: true, error: true, key })));
  }, [companyId]);
  const id = companyId || "";
  // Parcerias canceladas/recusadas que a própria empresa excluiu da lista não aparecem mais.
  const rows = useMemo(() => state.key === id ? state.rows.filter(row => !row.hiddenFor.includes(id)) : EMPTY, [state, id]);
  if (!companyId) return { rows: EMPTY, ready: true, error: false };
  return state.key === companyId ? { rows, ready: state.ready, error: state.error } : { rows: EMPTY, ready: false, error: false };
}
