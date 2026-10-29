import { watchPrivateUser } from "../../services/privateUserProfiles";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { ModalSelect } from "../ui/ModalSelect";
import { createPortal } from "react-dom";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/Button";
import {
  deleteSeniorProfile,
  endSeniorOperationalSuspension,
  reactivateSeniorAccount,
  removeDriverFromFleetSenior,
  reverseSeniorSuspension,
  suspendSeniorAccount,
} from "../../services/seniorAccountAdministrationService";

export interface SeniorMemberActionsProps {
  member: any;
  user: any;
  companyId: string;
  companyName: string;
  onUpdated?: (patch: Record<string, unknown>) => void;
  triggerLabel?: string;
  showStatusBadges?: boolean;
  triggerClassName?: string;
}

export function SeniorMemberActions({
  member,
  user,
  companyId,
  companyName,
  onUpdated,
  triggerLabel = "Ações administrativas",
  showStatusBadges = true,
  triggerClassName = "h-8 px-3 rounded-lg text-[11px]",
}: SeniorMemberActionsProps) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState("indefinite");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const onUpdatedRef = useRef(onUpdated);
  onUpdatedRef.current = onUpdated;
  useEffect(() => {
    if (!pendingActionId || !member.userId) return;
    return watchPrivateUser(member.userId, snapshot => {
      const latest = snapshot.data();
      if (!latest || latest.accountActionState !== "COMPLETED" || latest.pendingAccountCommand) return;
      onUpdatedRef.current?.({ accountStatus: latest.accountStatus, suspension: latest.suspension || { active: false },
        deleted: latest.deleted === true, accountActionState: "COMPLETED" });
      setPendingActionId(null);
      toast.success("Ação administrativa concluída no servidor.");
    });
  }, [pendingActionId, member.userId]);

  const name = useMemo(() => `${user?.firstName || user?.name || "Usuário"} ${user?.lastName || ""}`.trim(), [user]);
  const operationalSuspended = member?.suspensionType === "operational" || member?.suspension?.type === "operational" || user?.operationalSuspension?.active === true;
  const accountStatus = user?.accountStatus || member?.accountStatus || user?.status;
  const accountSuspended = accountStatus === "suspended";
  const accountDeleted = accountStatus === "deleted" || user?.deleted === true || user?.softDeleted === true;
  const accountLabel = pendingActionId ? "Ação em processamento" : accountDeleted ? "Perfil excluído" : accountSuspended ? "Conta suspensa" : "Conta ativa";

  const reset = () => { setAction(null); setReason(""); setDuration("indefinite"); setConfirmed(false); };
  const close = () => { if (!busy) { reset(); setOpen(false); } };

  const execute = async () => {
    if (!action || busy) return;
    if ((action === "suspend" || action === "delete" || action === "remove") && !reason.trim() && action !== "remove") return;
    if (action === "delete" && !confirmed) return;
    setBusy(true);
    try {
      const expiresAt = action === "suspend" && duration !== "indefinite"
        ? new Date(Date.now() + Number(duration) * 60 * 60 * 1000).toISOString()
        : undefined;
      if (action === "remove") {
        await removeDriverFromFleetSenior(member.userId, companyId, reason.trim() || "Ação solicitada pelo Painel Sênior");
        onUpdated?.({ removedFromFleet: true });
      } else if (action === "suspend") {
        await suspendSeniorAccount(member.userId, reason.trim(), expiresAt, companyId);
        onUpdated?.({ accountStatus: "suspended", suspension: { active: true, expiresAt: expiresAt || null } });
      } else if (action === "reactivate") {
        await reactivateSeniorAccount(member.userId, companyId);
        onUpdated?.({ accountStatus: "active", suspension: { active: false } });
      } else if (action === "end-operational") {
        await endSeniorOperationalSuspension(member.userId, companyId);
        onUpdated?.({ operationalSuspendedUntil: new Date().toISOString(), operationalSuspension: { active: false } });
      } else if (action === "reverse") {
        await reverseSeniorSuspension(member.userId, companyId, member?.suspension?.actionId);
        onUpdated?.({ accountStatus: "active", suspension: { ...(user?.suspension || {}), active: false } });
      } else if (action === "delete") {
        await deleteSeniorProfile(member.userId, reason.trim(), confirmed, companyId);
        onUpdated?.({ accountStatus: "deleted", deleted: true, softDeleted: true });
      }
      reset();
      setOpen(false);
    } catch (error) {
      console.error("[NVU Senior] administrative operation failed", error);
      if ((error as any)?.code === "ADMIN_ACTION_PENDING") { setPendingActionId((error as any).actionId); onUpdated?.({ accountActionState: "PENDING" }); toast.info((error as Error).message); reset(); setOpen(false); return; }
      toast.error(error instanceof Error ? error.message : "Não foi possível concluir a operação no servidor.");
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {showStatusBadges && (
          <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${accountDeleted ? "bg-red-100 text-red-700" : accountSuspended ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
            {accountLabel}
          </span>
        )}
        {showStatusBadges && operationalSuspended && <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-700">Suspensão operacional</span>}
        <Button type="button" variant="outline" className={triggerClassName} onClick={() => setOpen(true)} disabled={busy || Boolean(pendingActionId)}>{triggerLabel}</Button>
      </div>
      {open && createPortal(
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-nvu-surface p-5 shadow-2xl border border-slate-200 dark:border-nvu-line">
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="text-base font-bold text-slate-900 dark:text-white">Ações do funcionário</h3><p className="mt-1 text-xs text-slate-500">{name} · {user?.email || "Sem e-mail"}</p><p className="text-[11px] text-slate-400">Frota: {companyName} · Status: {accountLabel}</p></div>
              <button type="button" onClick={close} disabled={busy} aria-label="Fechar" className="text-slate-400">×</button>
            </div>
            {!action ? (
              <div className="grid gap-2 pt-4">
                <button type="button" className="rounded-xl border px-3 py-3 text-left text-sm font-semibold" onClick={() => setAction("remove")}>Remover da frota<span className="block text-[11px] font-normal text-slate-500 mt-1">Remove somente o vínculo desta frota e preserva a conta e o histórico.</span></button>
                {!operationalSuspended && !accountSuspended && !accountDeleted && <button type="button" className="rounded-xl border border-amber-200 px-3 py-3 text-left text-sm font-semibold text-amber-700" onClick={() => setAction("suspend")}>Suspender conta<span className="block text-[11px] font-normal text-slate-500 mt-1">Atualiza Authentication, Firestore e sessões.</span></button>}
                {operationalSuspended && <button type="button" className="rounded-xl border border-amber-200 px-3 py-3 text-left text-sm font-semibold text-amber-700" onClick={() => setAction("end-operational")}>Encerrar suspensão operacional<span className="block text-[11px] font-normal text-slate-500 mt-1">Finaliza somente a suspensão operacional ativa.</span></button>}
                {accountSuspended && <><button type="button" className="rounded-xl border px-3 py-3 text-left text-sm font-semibold" onClick={() => setAction("reactivate")}>Reativar conta<span className="block text-[11px] font-normal text-slate-500 mt-1">Reativa a conta pelo backend administrativo.</span></button><button type="button" className="rounded-xl border border-violet-200 px-3 py-3 text-left text-sm font-semibold text-violet-700" onClick={() => setAction("reverse")}>Reverter suspensão<span className="block text-[11px] font-normal text-slate-500 mt-1">Reverte a suspensão administrativa registrada.</span></button></>}
                <button type="button" className="rounded-xl border border-red-200 px-3 py-3 text-left text-sm font-semibold text-red-700" onClick={() => setAction("delete")}>Excluir perfil/conta<span className="block text-[11px] font-normal text-slate-500 mt-1">Soft-delete recuperável; dados históricos compartilhados serão preservados.</span></button>
              </div>
            ) : (
              <div className="space-y-3 pt-4">
                {(action === "suspend" || action === "delete") && <label className="block text-xs font-semibold">Motivo<textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" placeholder="Informe o motivo" /></label>}
                {action === "suspend" && <label className="block text-xs font-semibold">Prazo<ModalSelect title="Prazo da suspensão" value={duration} onChange={e => setDuration(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"><option value="1">1 hora</option><option value="24">1 dia</option><option value="168">7 dias</option><option value="720">30 dias</option><option value="indefinite">Indeterminado</option></ModalSelect></label>}
                {action === "delete" && <label className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Confirmo a exclusão recuperável do perfil/conta e entendo que o acesso será revogado.</label>}
                <div className="flex gap-2 justify-end"><Button type="button" variant="outline" onClick={() => reset()} disabled={busy}>Voltar</Button><Button type="button" variant={action === "delete" || action === "remove" ? "danger" : "primary"} onClick={() => void execute()} disabled={busy || (action === "delete" && !confirmed) || ((action === "suspend" || action === "delete") && !reason.trim())}>{busy ? "Processando..." : action === "remove" ? "Remover da frota" : action === "suspend" ? "Suspender conta" : action === "reactivate" ? "Reativar conta" : action === "end-operational" ? "Encerrar suspensão" : action === "reverse" ? "Reverter suspensão" : "Excluir perfil/conta"}</Button></div>
              </div>
            )}
          </div>
        </div>, document.body
      )}
    </>
  );
}
