import { useMemo, useSyncExternalStore } from "react";
import { partnershipService } from "../services/partnershipService";
import { partnershipTripRecords } from "../lib/partnershipTrips";
import type { Partnership } from "../lib/partnerships";

type Store = { records: Record<string, unknown>[]; listeners: Set<() => void>; stop: (() => void) | null; release: ReturnType<typeof setTimeout> | null };
const stores = new Map<string, Store>();
const NONE: Record<string, unknown>[] = [];

/** Uma única escuta das parcerias por empresa, compartilhada por todas as telas que somam viagens (resumo, histórico, relatórios). */
function storeFor(companyId: string): Store {
  let store = stores.get(companyId);
  if (!store) { store = { records: NONE, listeners: new Set(), stop: null, release: null }; stores.set(companyId, store); }
  return store;
}
function subscribe(companyId: string, listener: () => void) {
  const store = storeFor(companyId);
  if (store.release) { clearTimeout(store.release); store.release = null; }
  store.listeners.add(listener);
  if (!store.stop) {
    const apply = (rows: Partnership[]) => { store.records = partnershipTripRecords(rows.filter(row => !row.hiddenFor.includes(companyId)), companyId); store.listeners.forEach(fn => fn()); };
    // Quem não pode ler parcerias (motorista) simplesmente não soma nada.
    try { store.stop = partnershipService.subscribeCompany(companyId, apply, () => undefined); } catch { store.stop = () => undefined; }
  }
  return () => {
    store.listeners.delete(listener);
    if (store.listeners.size === 0) store.release = setTimeout(() => { if (store.listeners.size === 0) { store.stop?.(); store.stop = null; store.records = NONE; } }, 120_000);
  };
}

export function usePartnershipTrips(companyId: string): Record<string, unknown>[] {
  const id = companyId || "";
  const sub = useMemo(() => (listener: () => void) => id ? subscribe(id, listener) : () => undefined, [id]);
  return useSyncExternalStore(sub, () => id ? storeFor(id).records : NONE, () => NONE);
}
