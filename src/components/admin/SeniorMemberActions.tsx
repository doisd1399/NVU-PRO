import { watchPrivateUser } from "../../services/privateUserProfiles";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { ModalSelect } from "../ui/ModalSelect";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/Button";
import { ArrowRight, ChevronLeft, Loader2, Play, RotateCcw, ShieldAlert, Trash2, UserMinus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ManagementDialog } from "./management/ManagementDialog";
import "./management/ManagementDashboard.css";
import "./management/OperationInfoSheet.css";
import "./management/SeniorSheets.css";
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

  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "NV";
  const needsReason = action === "suspend" || action === "delete";
  const actionLabel = action === "remove" ? "Remover da frota" : action === "suspend" ? "Suspender conta" : action === "reactivate" ? "Reativar conta"
    : action === "end-operational" ? "Encerrar suspensão" : action === "reverse" ? "Reverter suspensão" : "Excluir perfil/conta";
  const actionHint = action === "remove" ? "Remove somente o vínculo desta frota; a conta e o histórico continuam."
    : action === "suspend" ? "Atualiza Authentication, Firestore e sessões do funcionário."
    : action === "reactivate" ? "Reativa a conta pelo backend administrativo."
    : action === "end-operational" ? "Finaliza somente a suspensão operacional ativa."
    : action === "reverse" ? "Reverte a suspensão administrativa registrada."
    : "Exclusão recuperável: os dados históricos compartilhados são preservados e o acesso é revogado.";
  const danger = action === "delete" || action === "remove";
  const option = (id: string, label: string, hint: string, Icon: LucideIcon, pick: () => void, tone?: "warn" | "danger" | "accent") => (
    <button type="button" key={id} className="nvu-senior-action" data-action={id} data-tone={tone} onClick={pick}>
      <Icon aria-hidden="true" strokeWidth={1.7} />
      <span><strong>{label}</strong><small>{hint}</small></span>
      <span className="nvu-op-sheet-arrow"><ArrowRight size={22} strokeWidth={1.8} /></span>
    </button>
  );

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
      {open && (
        <ManagementDialog title="Ações do funcionário" variant="sheet" busy={busy} onClose={close}>
          <div className="nvu-senior-sheet" data-testid="senior-member-actions-sheet">
            <div className="nvu-senior-head">
              <span className="nvu-senior-avatar" aria-hidden="true">{initials}</span>
              <div><strong>{name}</strong><small>{user?.email || "Sem e-mail"}</small><small>Frota: {companyName}</small></div>
            </div>
            <div className="nvu-senior-chips">
              <span className="nvu-senior-chip" data-tone={pendingActionId ? "warn" : accountDeleted ? "danger" : accountSuspended ? "warn" : "ok"}><i />{accountLabel}</span>
              {operationalSuspended && <span className="nvu-senior-chip" data-tone="warn"><i />Suspensão operacional</span>}
            </div>
            {!action ? (
              <>
                <section className="nvu-senior-group" aria-label="Frota">
                  <h3>Frota</h3>
                  {option("remove", "Remover da frota", "Remove somente o vínculo desta frota e preserva a conta e o histórico.", UserMinus, () => setAction("remove"))}
                </section>
                {(!operationalSuspended && !accountSuspended && !accountDeleted || operationalSuspended || accountSuspended) && (
                  <section className="nvu-senior-group" aria-label="Conta">
                    <h3>Conta</h3>
                    {!operationalSuspended && !accountSuspended && !accountDeleted && option("suspend", "Suspender conta", "Atualiza Authentication, Firestore e sessões.", ShieldAlert, () => setAction("suspend"), "warn")}
                    {operationalSuspended && option("end-operational", "Encerrar suspensão operacional", "Finaliza somente a suspensão operacional ativa.", Play, () => setAction("end-operational"), "warn")}
                    {accountSuspended && option("reactivate", "Reativar conta", "Reativa a conta pelo backend administrativo.", Play, () => setAction("reactivate"), "accent")}
                    {accountSuspended && option("reverse", "Reverter suspensão", "Reverte a suspensão administrativa registrada.", RotateCcw, () => setAction("reverse"))}
                  </section>
                )}
                <section className="nvu-senior-group" aria-label="Zona de risco">
                  <h3>Zona de risco</h3>
                  {option("delete", "Excluir perfil/conta", "Soft-delete recuperável; dados históricos compartilhados serão preservados.", Trash2, () => setAction("delete"), "danger")}
                </section>
              </>
            ) : (
              <div className="nvu-senior-form">
                <button type="button" className="nvu-senior-back" onClick={() => reset()} disabled={busy}><ChevronLeft size={18} aria-hidden="true" />Voltar</button>
                <div><h3>{actionLabel}</h3><p>{actionHint}</p></div>
                {needsReason && <label className="nvu-senior-field">Motivo<textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="Informe o motivo" /></label>}
                {action === "suspend" && <label className="nvu-senior-field">Prazo<ModalSelect title="Prazo da suspensão" value={duration} onChange={e => setDuration(e.target.value)} className="nvu-senior-input"><option value="1">1 hora</option><option value="24">1 dia</option><option value="168">7 dias</option><option value="720">30 dias</option><option value="indefinite">Indeterminado</option></ModalSelect></label>}
                {action === "delete" && <label className="nvu-senior-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Confirmo a exclusão recuperável do perfil/conta e entendo que o acesso será revogado.</label>}
                <div className="nvu-central-dialog-actions">
                  <button type="button" onClick={() => reset()} disabled={busy}>Cancelar</button>
                  <button type="button" data-primary={danger ? undefined : "true"} data-orange={danger ? "true" : undefined} onClick={() => void execute()}
                    disabled={busy || (action === "delete" && !confirmed) || (needsReason && !reason.trim())}>
                    {busy ? <><Loader2 className="animate-spin" size={16} aria-hidden="true" />Processando...</> : actionLabel}
                  </button>
                </div>
              </div>
            )}
          </div>
        </ManagementDialog>
      )}
    </>
  );
}
