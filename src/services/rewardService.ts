import { collection, onSnapshot, query, where, type Unsubscribe } from "firebase/firestore";
import { db, functions } from "../lib/firebase";
import { httpsCallable } from "../lib/regionalCallable";
import { doc, onSnapshot as watchDoc } from "firebase/firestore";
import { normalizeCampaign, normalizeOffer, type RewardCampaign, type RewardOffer } from "../lib/rewards";
import { normalizePayment, type RewardPayment } from "../lib/rewardPayments";

const call = async <T,>(name: string, data: Record<string, unknown>, timeout = 30_000): Promise<T> => (await httpsCallable<Record<string, unknown>, T>(functions, name, { timeout })(data)).data;
export type CampaignPayload = { companyId: string; contractId: string; vehicleId: string; name: string; startDate?: string; endDate?: string; perTripCents: number; goalCents: number; audience: "all" | "selected"; driverIds: string[]; requestId: string };

/** Recompensas: toda escrita passa pelos callables (o cliente só lê o Firestore). */
export const rewardService = {
  create: (payload: CampaignPayload) => call<{ success: true; campaignId: string; drivers: number; failed: { driverId: string; driverName: string; message: string }[] }>("createRewardCampaign", payload, 180_000),
  update: (campaignId: string, patch: { name?: string; perTripCents?: number; goalCents?: number; expectedRevision?: number }) => call<{ success: true; revision: number; notified: number }>("updateRewardCampaign", { campaignId, ...patch }, 60_000),
  hide: (campaignId: string) => call<{ success: true }>("hideRewardCampaign", { campaignId }),
  prepareCompany: (companyId: string) => call<{ success: boolean; enabled: boolean; ready: boolean }>("prepareCompanyOperationalCommands", { companyId, enable: true }, 60_000),
  respond: (offerId: string, decision: "accept" | "decline") => call<{ success: true; status: string }>("respondRewardOffer", { offerId, decision }),
  cancel: (campaignId: string) => call<{ success: true }>("cancelRewardCampaign", { campaignId }, 120_000),
  setPayDay: (companyId: string, payDay: number) => call<{ success: true; payDay: number }>("setRewardPayDay", { companyId, payDay }),
  setPix: (type: string, key: string) => call<{ success: true; type: string; key: string }>("setRewardPix", { type, key }),
  generatePayroll: (companyId: string, requestId: string) => call<{ success: true; payments: number; totalCents: number; replayed: boolean; partial: boolean }>("generateRewardPayroll", { companyId, requestId }, 120_000),
  markPaid: (paymentId: string, proof: { url: string; readCents: number | null; override?: boolean }, e2eId?: string) => call<{ success: true; status: string }>("markRewardPaid", { paymentId, e2eId: e2eId || "", proof }),
  confirmReceived: (paymentId: string) => call<{ success: true; status: string }>("confirmRewardReceived", { paymentId }),
  contest: (paymentId: string, reason: string) => call<{ success: true; status: string }>("contestRewardPayment", { paymentId, reason }),
  cancelPayment: (paymentId: string) => call<{ success: true; status: string }>("cancelRewardPayment", { paymentId }),
  subscribeCompanyPayments(companyId: string, onData: (rows: RewardPayment[]) => void, onError: (error: unknown) => void): Unsubscribe {
    return onSnapshot(query(collection(db, "rewardPayments"), where("companyId", "==", companyId)),
      snap => onData(snap.docs.map(row => normalizePayment(row.id, row.data())).sort((a, b) => b.payrollAtMs - a.payrollAtMs || a.driverName.localeCompare(b.driverName))), onError);
  },
  subscribeDriverPayments(driverId: string, onData: (rows: RewardPayment[]) => void, onError: (error: unknown) => void): Unsubscribe {
    return onSnapshot(query(collection(db, "rewardPayments"), where("driverId", "==", driverId)),
      snap => onData(snap.docs.map(row => normalizePayment(row.id, row.data())).sort((a, b) => b.payrollAtMs - a.payrollAtMs)), onError);
  },
  subscribePayDay(companyId: string, onData: (payDay: number | null) => void, onError: (error: unknown) => void): Unsubscribe {
    return watchDoc(doc(db, "rewardSettings", companyId), snap => { const day = snap.exists() ? Number(snap.get("payDay")) : NaN; onData(Number.isInteger(day) && day >= 0 && day <= 6 ? day : null); }, onError);
  },
  subscribePix(userId: string, onData: (pix: { type: string; key: string } | null) => void, onError: (error: unknown) => void): Unsubscribe {
    return watchDoc(doc(db, "rewardPayees", userId), snap => onData(snap.exists() && snap.get("pixKey") ? { type: String(snap.get("pixType") || ""), key: String(snap.get("pixKey")) } : null), onError);
  },
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
