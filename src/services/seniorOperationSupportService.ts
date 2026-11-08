import { doc, updateDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { canonicalOperationCommandService } from "../application/operation/CanonicalOperationCommandService";
import { isManagedOperation, isOpenSupportJob, type SupportJob } from "../lib/seniorOperationSupport";

type CompanyRef = { id: string; operationalCommandVersion?: unknown };
const running = (job: SupportJob) => ["active", "delayed", "awaiting_completion"].includes(String(job.status));

/**
 * Painel Sênior: cancela o trabalho de qualquer empresa. Empresa com comandos operacionais usa o comando do servidor (que
 * confere a permissão do Sênior e libera veículo/reboque); empresa antiga muda o status do documento (as regras permitem ao
 * Sênior) e libera o veículo/reboque quando nenhum outro trabalho em execução os usa.
 */
export async function seniorCancelOperation(company: CompanyRef, job: SupportJob, companyJobs: readonly SupportJob[]): Promise<void> {
  if (!company?.id || !job?.id) throw new Error("Selecione a empresa e o trabalho.");
  if (!isOpenSupportJob(job)) throw new Error("Este trabalho já foi encerrado.");
  if (isManagedOperation(company, job)) {
    await canonicalOperationCommandService.executeManaged({ action: "cancel", companyId: company.id, jobId: job.id });
    return;
  }
  await canonicalOperationCommandService.setLifecycleStatus(job.id, { status: "cancelled" });
  const stillUsed = (key: "vehicleId" | "trailerId", id: string) =>
    companyJobs.some(other => other.id !== job.id && running(other) && other.deleted !== true && String((other as any)[key] || "") === id);
  const release = async (collectionName: "veiculos" | "reboques", key: "vehicleId" | "trailerId") => {
    const id = String((job as any)[key] || "");
    if (!id || stillUsed(key, id)) return;
    try { await updateDoc(doc(db, collectionName, id), { status: "available" }); }
    catch (error) { console.warn(`[NVU Senior] ${collectionName} não liberado após o cancelamento`, error); }
  };
  await release("veiculos", "vehicleId");
  await release("reboques", "trailerId");
}

/** Painel Sênior: liga outro veículo da mesma empresa ao trabalho (o servidor confere permissão, empresa e disponibilidade). */
export async function seniorChangeOperationVehicle(companyId: string, jobId: string, vehicleId: string): Promise<void> {
  if (!companyId || !jobId || !vehicleId) throw new Error("Selecione o trabalho e o veículo.");
  await canonicalOperationCommandService.executeManaged({ action: "changeVehicle", companyId, jobId, vehicleId });
}

/** Mensagem útil para o Sênior: usa o motivo do servidor quando é uma recusa conhecida. */
export function supportFailureMessage(error: unknown, fallback: string): string {
  const code = String((error as any)?.code || ""), message = String((error as any)?.message || "");
  return /^functions\/(failed-precondition|permission-denied|not-found|invalid-argument)$/.test(code) && message && !/^internal$/i.test(message)
    ? message : (/permission|insufficient/i.test(code + message) ? "Sem permissão para esta ação. Entre novamente no Painel Sênior." : fallback);
}
