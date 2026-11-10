import { useEffect, useState } from "react";
import { rewardService } from "../services/rewardService";
import type { RewardCampaign, RewardOffer } from "../lib/rewards";

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
