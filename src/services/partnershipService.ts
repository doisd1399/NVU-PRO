import { collection, onSnapshot, query, where, type Unsubscribe } from "firebase/firestore";
import { db, functions } from "../lib/firebase";
import { httpsCallable } from "../lib/regionalCallable";
import { normalizePartnership, type Partnership } from "../lib/partnerships";

export type OfferPayload = {
  contractorCompanyId: string; executorCompanyId: string; operationName: string; totalTrips: number;
  trailerRequirement: string | null; durationDays: number; conditions: string; goalAmountCents: number | null; agreedAmountCents: number | null; requestId: string;
};

const call = async <T,>(name: string, data: Record<string, unknown>, timeout = 20_000): Promise<T> => {
  const result = await httpsCallable<Record<string, unknown>, T>(functions, name, { timeout })(data);
  return result.data;
};

/** Parcerias B2P: toda escrita passa pelos callables (o cliente só lê o Firestore). */
export const partnershipService = {
  createOffer: (payload: OfferPayload) => call<{ success: true; partnershipId: string; replayed: boolean; executorReady?: boolean }>("createPartnershipOffer", payload),
  respond: (partnershipId: string, decision: "accept" | "decline") =>
    call<{ success: true; status: string }>("respondPartnershipOffer", { partnershipId, decision }),
  settle: (partnershipId: string, action: "paid" | "received", proof?: { url: string; readCents: number | null; override?: boolean }) => call<{ success: true; status: string }>("settlePartnershipPayment", { partnershipId, action, ...(proof ? { proof } : {}) }),
  /** Liga a confirmação operacional da empresa (exigida para aceitar). O servidor só liga se não houver trabalhos simultâneos em conflito. */
  prepareCompany: (companyId: string) => call<{ success: boolean; enabled: boolean; ready: boolean }>("prepareCompanyOperationalCommands", { companyId, enable: true }, 60_000),
  /** Chave Pix da recebedora (executora) para a pagadora ver no acordo. */
  setPix: (partnershipId: string, type: string, key: string) => call<{ success: true; type: string; key: string }>("setPartnershipPix", { partnershipId, type, key }),
  /** Exclui da lista da empresa uma parceria cancelada ou recusada. */
  hide: (partnershipId: string, companyId: string) => call<{ success: true }>("hidePartnership", { partnershipId, companyId }),
  cancel: (partnershipId: string) => call<{ success: true }>("cancelPartnershipOffer", { partnershipId }),
  designateDriver: (input: { partnershipId: string; driverId: string; vehicleId: string; cancelRunning?: boolean }) =>
    call<{ success: true; partnershipId: string; jobId: string }>("designatePartnershipDriver", input, 30_000),

  /** Parcerias em que a empresa é contratante OU executora (duas consultas simples, sem índice composto). */
  subscribeCompany(companyId: string, onData: (rows: Partnership[]) => void, onError: (error: unknown) => void): Unsubscribe {
    const sides = new Map<string, Map<string, Partnership>>([["contractor", new Map()], ["executor", new Map()]]);
    const emit = () => {
      const merged = new Map<string, Partnership>();
      sides.forEach(rows => rows.forEach((row, id) => merged.set(id, row)));
      onData([...merged.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.id.localeCompare(b.id)));
    };
    const listen = (side: "contractor" | "executor", field: string) => onSnapshot(
      query(collection(db, "partnerships"), where(field, "==", companyId)),
      snapshot => {
        const rows = sides.get(side)!;
        rows.clear();
        snapshot.forEach(item => rows.set(item.id, normalizePartnership(item.id, item.data())));
        emit();
      }, onError);
    const stops = [listen("contractor", "contractorCompanyId"), listen("executor", "executorCompanyId")];
    return () => stops.forEach(stop => stop());
  },

  /** Parcerias atribuídas ao motorista (para ler resultados da própria operação). */
  subscribeDriver(driverId: string, onData: (rows: Partnership[]) => void, onError: (error: unknown) => void): Unsubscribe {
    return onSnapshot(query(collection(db, "partnerships"), where("driverId", "==", driverId)),
      snapshot => onData(snapshot.docs.map(item => normalizePartnership(item.id, item.data()))), onError);
  },
};
