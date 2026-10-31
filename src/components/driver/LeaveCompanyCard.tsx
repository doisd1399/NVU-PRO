import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { ManagementDialog } from "../admin/management/ManagementDialog";
import "../admin/management/ManagementDashboard.css";
import { checkLocalPendingForLeave, leaveCompany, previewLeaveCompany } from "../../services/leaveCompanyService";
import { blockedMessage, leaveDialogCopy, leaveFailureMessage, preflightMessage, type LeavePreview } from "../../services/leaveCompanyCore";

type Phase =
  | { name: "checking" }
  | { name: "blocked"; message: string }
  | { name: "confirm"; preview: LeavePreview }
  | { name: "failed"; preview: LeavePreview; message: string };

const newCommandId = () => `leave-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

/**
 * "Sair da empresa". The card only appears when the server understands the exit command (a read-only preview answers),
 * so the option is never offered before the Functions are published. The owner never sees it: leaving needs a transfer.
 */
export function LeaveCompanyCard({ companyId, enabled = true }: { companyId: string; enabled?: boolean }) {
  const navigate = useNavigate();
  const [available, setAvailable] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ name: "checking" });
  const [busy, setBusy] = useState(false);
  // One reference per opened dialog: a retry after a lost answer replays the same command instead of a second one.
  const commandId = useRef("");
  const sending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    setAvailable(false);
    if (!enabled || !companyId) return;
    let current = true;
    previewLeaveCompany(companyId).then(result => {
      if (current && result !== "unsupported" && result.blocker !== "LEAVE_OWNER" && !result.alreadyLeft) setAvailable(true);
    }, () => { /* A failed probe keeps the option hidden; the next visit asks again. */ });
    return () => { current = false; };
  }, [companyId, enabled]);

  const open = useCallback(async () => {
    commandId.current = newCommandId();
    setPhase({ name: "checking" });
    setDialogOpen(true);
    try {
      const preview = await previewLeaveCompany(companyId, { fresh: true });
      if (!alive.current) return;
      if (preview === "unsupported") { setPhase({ name: "blocked", message: "Este recurso ainda não está disponível. Tente novamente mais tarde." }); return; }
      if (!preview.canLeave) { setPhase({ name: "blocked", message: blockedMessage(preview) }); return; }
      const local = await checkLocalPendingForLeave(companyId);
      if (!alive.current) return;
      if (local.ok === false) { setPhase({ name: "blocked", message: preflightMessage(local) }); return; }
      setPhase({ name: "confirm", preview });
    } catch (error) {
      if (alive.current) setPhase({ name: "blocked", message: leaveFailureMessage(error) });
    }
  }, [companyId]);

  const close = () => { if (!busy) setDialogOpen(false); };
  const confirm = async (preview: LeavePreview) => {
    if (sending.current) return;
    sending.current = true; setBusy(true);
    try {
      // The device may have queued something while the dialog was open.
      const local = await checkLocalPendingForLeave(companyId);
      if (local.ok === false) { if (alive.current) setPhase({ name: "failed", preview, message: preflightMessage(local) }); return; }
      await leaveCompany(companyId, commandId.current);
      // Only now, with the server's confirmation: the company is gone. The session listeners drop the profile on their own.
      navigate("/select-profile", { replace: true, state: { nvuExplicitProfileSelection: true } });
    } catch (error) {
      if (alive.current) setPhase({ name: "failed", preview, message: leaveFailureMessage(error) });
    } finally { sending.current = false; if (alive.current) setBusy(false); }
  };

  if (!available) return null;
  const preview = phase.name === "confirm" || phase.name === "failed" ? phase.preview : null;
  const copy = preview ? leaveDialogCopy(preview) : null;
  return <>
    <div className="border-t border-slate-100 dark:border-nvu-line pt-4" data-testid="leave-company-entry">
      <button type="button" onClick={() => void open()}
        className="inline-flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-500/30 px-3.5 py-2 text-[13px] font-semibold text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10">
        <LogOut size={15} aria-hidden="true" /> Sair da empresa
      </button>
    </div>
    {dialogOpen && <ManagementDialog title={copy?.title || "Sair da empresa"} onClose={close} busy={busy}>
      <div className="nvu-central-dialog-body" data-testid="leave-company-dialog">
        {phase.name === "checking" && <p role="status">Verificando pendências…</p>}
        {phase.name === "blocked" && <>
          <p role="alert">{phase.message}</p>
          <div className="nvu-central-dialog-actions"><button type="button" data-primary="true" onClick={close}>Entendi</button></div>
        </>}
        {copy && preview && <>
          {copy.lines.map(line => <p key={line.text}>{line.strong && <strong>{line.strong}</strong>}{line.text}</p>)}
          {phase.name === "failed" && <p role="alert">{phase.message}</p>}
          <div className="nvu-central-dialog-actions">
            <button type="button" disabled={busy} onClick={close}>{copy.stay}</button>
            <button type="button" data-danger="true" disabled={busy} aria-busy={busy} onClick={() => void confirm(preview)}>{busy ? "Saindo…" : phase.name === "failed" ? "Tentar novamente" : copy.confirm}</button>
          </div>
        </>}
      </div>
    </ManagementDialog>}
  </>;
}
