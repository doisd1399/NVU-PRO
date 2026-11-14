import React from "react";
import { useNavigate } from "react-router-dom";
import { UserCheck } from "lucide-react";
import { pendingRecruitment, pendingRecruitmentMessage } from "../../lib/recruitmentPending";

/** Company profile: tells the managers that candidates are waiting, and where to answer them. Hidden when nothing waits. */
export function CompanyRecruitmentNotice({ companyId, applications, requests }: {
  companyId: string | null | undefined; applications: Array<Record<string, any>>; requests: Array<Record<string, any>>;
}) {
  const navigate = useNavigate();
  const pending = pendingRecruitment(companyId, applications, requests);
  if (!pending.applications && !pending.legacyRequests) return null;
  const go = (activeTab: "hr" | "drivers") => navigate("/admin/fleet", { state: { activeTab } });
  return <section data-testid="company-recruitment-notice" aria-label="Candidatos aguardando"
    className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3">
    <UserCheck size={18} className="shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
    <p className="min-w-0 flex-1 text-[13px] font-semibold text-amber-900 dark:text-amber-100" role="status">{pendingRecruitmentMessage(pending)}</p>
    <div className="flex flex-wrap gap-2">
      {pending.applications > 0 && <button type="button" onClick={() => go("hr")} className="rounded-xl bg-amber-600 px-3 py-1.5 text-[12px] font-bold text-white">Abrir Recursos Humanos</button>}
      {pending.legacyRequests > 0 && <button type="button" onClick={() => go("drivers")} className="rounded-xl border border-amber-300 dark:border-amber-500/40 px-3 py-1.5 text-[12px] font-bold text-amber-900 dark:text-amber-100">Ver solicitações</button>}
    </div>
  </section>;
}
