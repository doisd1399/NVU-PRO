import { collection, onSnapshot, query, where, type Unsubscribe } from "firebase/firestore";
import { db, functions } from "../lib/firebase";
import { httpsCallable } from "../lib/regionalCallable";
import { normalizeCampaign, normalizeOffer, type RewardCampaign, type RewardOffer } from "../lib/rewards";

const call = async <T,>(name: string, data: Record<string, unknown>, timeout = 30_000): Promise<T> => (await httpsCallable<Record<string, unknown>, T>(functions, name, { timeout })(data)).data;
export type CampaignPayload = { companyId: string; name: string; startDate: string; endDate: string; perTripCents: number; bonusCents: number; bonusGoalTrips: number; budgetCents: number; audience: "all" | "selected"; driverIds: string[]; requestId: string };

/** Recompensas: toda escrita passa pelos callables (o cliente só lê o Firestore). */
export const rewardService = {
  create: (payload: CampaignPayload) => call<{ success: true; campaignId: string; drivers: number }>("createRewardCampaign", payload, 60_000),
  respond: (offerId: string, decision: "accept" | "decline") => call<{ success: true; status: string }>("respondRewardOffer", { offerId, decision }),
  cancel: (campaignId: string) => call<{ success: true }>("cancelRewardCampaign", { campaignId }),
  subscribeCompany(companyId: string, onData: (campaigns: RewardCampaign[], offers: RewardOffer[]) => void, onError: (error: unknown) => void): Unsubscribe {
    let campaigns: RewardCampaign[] = [], offers: RewardOffer[] = [];
    const emit = () => onData([...campaigns].sort((a, b) => b.createdAtMs - a.createdAtMs), offers);
    const stops = [
      onSnapshot(query(collection(db, "rewardCampaigns"), where("companyId", "==", companyId)), snap => { campaigns = snap.docs.map(row => normalizeCampaign(row.id, row.data())); emit(); }, onError),
      onSnapshot(query(collection(db, "rewardOffers"), where("companyId", "==", companyId)), snap => { offers = snap.docs.map(row => normalizeOffer(row.id, row.data())); emit(); }, onError),
    ];
    return () => stops.forEach(stop => stop());
  },
  subscribeDriver(driverId: string, onData: (offers: RewardOffer[]) => void, onError: (error: unknown) => void): Unsubscribe {
    return onSnapshot(query(collection(db, "rewardOffers"), where("driverId", "==", driverId)),
      snap => onData(snap.docs.map(row => normalizeOffer(row.id, row.data())).sort((a, b) => b.createdAtMs - a.createdAtMs)), onError);
  },
};
