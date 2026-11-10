import { useEffect, useState } from "react";
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
/** Ofertas de recompensa do motorista, em tempo real. */
export function useDriverRewards(driverId: string | null | undefined) {
  const [state, setState] = useState<{ key: string; offers: RewardOffer[]; ready: boolean; error: boolean }>({ key: "", offers: EMPTY_O, ready: false, error: false });
  useEffect(() => {
    if (!driverId) return;
    return rewardService.subscribeDriver(driverId, offers => setState({ key: driverId, offers, ready: true, error: false }), () => setState(current => ({ ...current, key: driverId, ready: true, error: true })));
  }, [driverId]);
  return !driverId ? { offers: EMPTY_O, ready: true, error: false } : state.key === driverId ? state : { offers: EMPTY_O, ready: false, error: false };
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
/** Recebimentos do motorista e a chave Pix que ele cadastrou. */
export function useDriverPayments(driverId: string | null | undefined) {
  const [state, setState] = useState<{ key: string; payments: RewardPayment[]; pix: { type: string; key: string } | null; ready: boolean; error: boolean }>({ key: "", payments: EMPTY_P, pix: null, ready: false, error: false });
  useEffect(() => {
    if (!driverId) return;
    const stops = [
      rewardService.subscribeDriverPayments(driverId, payments => setState(current => ({ ...current, key: driverId, payments, ready: true, error: false })), () => setState(current => ({ ...current, key: driverId, ready: true, error: true }))),
      rewardService.subscribePix(driverId, pix => setState(current => ({ ...current, key: driverId, pix })), () => undefined),
    ];
    return () => stops.forEach(stop => stop());
  }, [driverId]);
  return !driverId ? { payments: EMPTY_P, pix: null as { type: string; key: string } | null, ready: true, error: false } : state.key === driverId ? state : { payments: EMPTY_P, pix: null as { type: string; key: string } | null, ready: false, error: false };
}
