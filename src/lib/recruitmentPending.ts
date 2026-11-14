/** What waits for the company's managers: full applications (Recursos Humanos) and legacy one-tap requests (Motoristas). */
export type PendingRecruitment = { applications: number; legacyRequests: number };

export function pendingRecruitment(companyId: string | null | undefined,
  applications: Array<Record<string, any>>, requests: Array<Record<string, any>>): PendingRecruitment {
  const id = String(companyId || "");
  if (!id) return { applications: 0, legacyRequests: 0 };
  return {
    applications: applications.filter(row => row.companyId === id && row.status === "pending" && row.isCurrent !== false &&
      String(row.type || row.registrationType || "driver_application") !== "company_registration").length,
    legacyRequests: requests.filter(row => row.empresaId === id && row.status === "pending").length,
  };
}

export const pendingRecruitmentMessage = ({ applications, legacyRequests }: PendingRecruitment) => {
  const parts: string[] = [];
  if (applications) parts.push(applications === 1 ? "1 inscrição aguardando análise" : `${applications} inscrições aguardando análise`);
  if (legacyRequests) parts.push(legacyRequests === 1 ? "1 solicitação antiga de entrada" : `${legacyRequests} solicitações antigas de entrada`);
  return parts.join(" · ");
};
