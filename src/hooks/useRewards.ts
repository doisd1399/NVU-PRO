import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { rewardService } from "../services/rewardService";
import type { RewardCampaign, RewardOffer } from "../lib/rewards";
import type { RewardPayment } from "../lib/rewardPayments";

const EMPTY_C: RewardCampaign[] = [], EMPTY_O: RewardOffer[] = [];
/** Campanhas e ofertas da empresa (gestão), em tempo real. */
export function useCompanyRewards(companyId: string | null | undefined) {
  const [state, setState] = useState<{ key: string; campaigns: RewardCampaign[]; offers: RewardOffer[]; ready: boolean; error: boolean }>({ key: "", campaigns: EMPTY_C, offers: EMPTY_O, ready: false, error: false });
  useEffect(() => {
    if (!companyId) return;
    return rewardService.subscribeCompany(companyId, (campaigns, offers) => setState({ key: companyId, campaigns, offers, ready: true, error: false }),
      () => setState(current => ({ ...current, key: companyId, ready: true, error: true })));
  }, [companyId]);
  return !companyId ? { campaigns: EMPTY_C, offers: EMPTY_O, ready: true, error: false } : state.key === companyId ? state : { campaigns: EMPTY_C, offers: EMPTY_O, ready: false, error: false };
}
const EMPTY_P: RewardPayment[] = [];
/** Pagamentos da folha da empresa (gestão), em tempo real, e o dia de pagamento combinado. */
export function useCompanyPayments(companyId: string | null | undefined) {
  const [state, setState] = useState<{ key: string; payments: RewardPayment[]; payDay: number | null; ready: boolean; error: boolean }>({ key: "", payments: EMPTY_P, payDay: null, ready: false, error: false });
  useEffect(() => {
    if (!companyId) return;
    const fail = () => setState(current => ({ ...current, key: companyId, ready: true, error: true }));
    const stops = [
      rewardService.subscribeCompanyPayments(companyId, payments => setState(current => ({ ...current, key: companyId, payments, ready: true, error: false })), fail),
      rewardService.subscribePayDay(companyId, payDay => setState(current => ({ ...current, key: companyId, payDay })), () => undefined),
    ];
    return () => stops.forEach(stop => stop());
  }, [companyId]);
  return !companyId ? { payments: EMPTY_P, payDay: null as number | null, ready: true, error: false } : state.key === companyId ? state : { payments: EMPTY_P, payDay: null as number | null, ready: false, error: false };
}

/**
 * Escutas do motorista (ofertas, recebimentos e chave Pix) COMPARTILHADAS: várias telas usam os mesmos dados (painel, menu, aviso de conclusão, página
 * Pagamentos) e antes cada uma abria as suas escutas e refazia a tela a cada atualização. Agora há uma escuta por motorista, mantida por 60 s depois do último uso.
 */
type DriverSnapshot = { offers: RewardOffer[]; offersReady: boolean; offersError: boolean; payments: RewardPayment[]; paymentsReady: boolean; paymentsError: boolean; pix: { type: string; key: string } | null };
type DriverStore = { snapshot: DriverSnapshot; listeners: Set<() => void>; stops: (() => void)[]; release: ReturnType<typeof setTimeout> | null };
const EMPTY_SNAPSHOT: DriverSnapshot = { offers: EMPTY_O, offersReady: false, offersError: false, payments: EMPTY_P, paymentsReady: false, paymentsError: false, pix: null };
const driverStores = new Map<string, DriverStore>();
function driverStore(driverId: string): DriverStore {
  let store = driverStores.get(driverId);
  if (!store) { store = { snapshot: EMPTY_SNAPSHOT, listeners: new Set(), stops: [], release: null }; driverStores.set(driverId, store); }
  return store;
}
function patchDriver(store: DriverStore, patch: Partial<DriverSnapshot>) { store.snapshot = { ...store.snapshot, ...patch }; store.listeners.forEach(listener => listener()); }
function subscribeDriver(driverId: string, listener: () => void) {
  const store = driverStore(driverId);
  if (store.release) { clearTimeout(store.release); store.release = null; }
  store.listeners.add(listener);
  if (!store.stops.length) {
    store.stops = [
      rewardService.subscribeDriver(driverId, offers => patchDriver(store, { offers, offersReady: true, offersError: false }), () => patchDriver(store, { offersReady: true, offersError: true })),
      rewardService.subscribeDriverPayments(driverId, payments => patchDriver(store, { payments, paymentsReady: true, paymentsError: false }), () => patchDriver(store, { paymentsReady: true, paymentsError: true })),
      rewardService.subscribePix(driverId, pix => patchDriver(store, { pix }), () => undefined),
    ];
  }
  return () => {
    store.listeners.delete(listener);
    if (store.listeners.size === 0) store.release = setTimeout(() => { if (store.listeners.size === 0) { store.stops.forEach(stop => stop()); store.stops = []; store.snapshot = EMPTY_SNAPSHOT; driverStores.delete(driverId); } }, 60_000);
  };
}
const NO_STORE_SNAPSHOT: DriverSnapshot = { ...EMPTY_SNAPSHOT, offersReady: true, paymentsReady: true };
function useDriverSnapshot(driverId: string | null | undefined): DriverSnapshot {
  const id = driverId || "";
  const subscribe = useMemo(() => (listener: () => void) => id ? subscribeDriver(id, listener) : () => undefined, [id]);
  return useSyncExternalStore(subscribe, () => id ? driverStore(id).snapshot : NO_STORE_SNAPSHOT, () => NO_STORE_SNAPSHOT);
}
/** Ofertas de recompensa do motorista, em tempo real (escuta compartilhada). */
export function useDriverRewards(driverId: string | null | undefined) {
  const snap = useDriverSnapshot(driverId);
  return useMemo(() => ({ offers: snap.offers, ready: snap.offersReady, error: snap.offersError }), [snap.offers, snap.offersReady, snap.offersError]);
}
/** Recebimentos do motorista e a chave Pix que ele cadastrou (escuta compartilhada). */
export function useDriverPayments(driverId: string | null | undefined) {
  const snap = useDriverSnapshot(driverId);
  return useMemo(() => ({ payments: snap.payments, pix: snap.pix, ready: snap.paymentsReady, error: snap.paymentsError }), [snap.payments, snap.pix, snap.paymentsReady, snap.paymentsError]);
}
/** Leitura pontual (sem refazer a tela): usada na hora do toque, por exemplo para achar a oferta de um trabalho da fila. */
export function getDriverRewardOffers(driverId: string | null | undefined): RewardOffer[] {
  return driverId ? driverStores.get(driverId)?.snapshot.offers || EMPTY_O : EMPTY_O;
}
/** Mantém a escuta do motorista ativa sem refazer a tela quando os dados mudam (para quem só lê no momento do toque). */
export function useKeepDriverRewards(driverId: string | null | undefined): void {
  const id = driverId || "";
  const subscribe = useMemo(() => (listener: () => void) => id ? subscribeDriver(id, listener) : () => undefined, [id]);
  useSyncExternalStore(subscribe, () => 0, () => 0);
}
