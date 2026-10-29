import { CachedImage } from "../common/CachedImage";
import { driverDisplayIdentity } from "../../lib/driverDisplayIdentity";
import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Mail, RefreshCw, User, X } from "lucide-react";
import { toast } from "sonner";
import { SeniorMemberActions } from "./SeniorMemberActions";
import {
  endSeniorOperationalSuspension,
  reverseSeniorSuspension,
} from "../../services/seniorAccountAdministrationService";

export interface SuspendedMembersModalProps {
  open: boolean;
  records: any[];
  loading: boolean;
  error?: string;
  onClose: () => void;
  onRefresh: () => Promise<void> | void;
}

const asDate = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.seconds === "number") return new Date(Number(value.seconds) * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDuration = (milliseconds: number) => {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainder = minutes % 60;
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", `${remainder}min`]
    .filter(Boolean)
    .join(" ");
};

const memberName = (user: any) =>
  driverDisplayIdentity(user).name;

const roleLabel = (membership: any) => {
  const raw = membership?.role || (Array.isArray(membership?.roles) ? membership.roles[0] : "") || "Motorista";
  const value = String(raw);
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "Motorista";
};

export function SuspendedMembersModal({
  open,
  records,
  loading,
  error = "",
  onClose,
  onRefresh,
}: SuspendedMembersModalProps) {
  const [now, setNow] = useState(() => Date.now());
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => String(a?.companyName || "").localeCompare(String(b?.companyName || ""))),
    [records],
  );

  if (!open || typeof document === "undefined") return null;

  const endSuspension = async (record: any) => {
    const userId = String(record?.userId || record?.uid || record?.id || "").trim();
    const companyId = String(record?.companyId || record?.fleetId || record?.membership?.companyId || "").trim();
    if (!userId || !companyId || busyUserId) {
      if (!userId || !companyId) toast.error("O registro de suspensão não possui usuário/empresa válidos.");
      return;
    }

    const user = record?.user || {};
    const suspension = record?.suspension || user?.suspension || {};
    const type = String(record?.suspensionType || suspension?.type || "account").toLowerCase();

    setBusyUserId(userId);
    try {
      if (type === "operational") {
        await endSeniorOperationalSuspension(userId, companyId);
        toast.success("Suspensão operacional encerrada para este usuário.");
      } else {
        const originalActionId = String(suspension?.actionId || "").trim() || undefined;
        await reverseSeniorSuspension(userId, companyId, originalActionId);
        toast.success("Suspensão da conta revertida para este usuário.");
      }
      await onRefresh();
    } catch (err) {
      console.error("[NVU Senior] failed to end suspension", err);
      toast.error(err instanceof Error ? err.message : "Não foi possível encerrar a suspensão.");
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[230] flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="suspended-members-title"
    >
      <div className="flex max-h-[min(92vh,860px)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-nvu-line dark:bg-nvu-surface">
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-white/10">
          <div>
            <h2 id="suspended-members-title" className="text-lg font-bold text-slate-900 dark:text-white">
              Membros suspensos
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-nvu-muted">
              Consulta persistida no servidor · {records.length} registro(s)
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={loading}
              className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-white/5"
              aria-label="Atualizar lista"
            >
              <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
              aria-label="Fechar"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {error && (
            <div className="mb-3 flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}

          {loading && !sortedRecords.length ? (
            <div className="flex justify-center py-16 text-sm text-slate-500">Consultando membros suspensos...</div>
          ) : sortedRecords.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {sortedRecords.map((record, index) => {
                const user = record?.user || record || {};
                const membership = record?.membership || {};
                const suspension = record?.suspension || user?.suspension || {};
                const userId = String(record?.userId || user?.id || record?.uid || "").trim();
                const companyId = String(record?.companyId || membership?.companyId || record?.fleetId || "").trim();
                const suspendedAt = asDate(suspension?.suspendedAt);
                const expiresAt = asDate(suspension?.expiresAt);
                const expired = Boolean(expiresAt && expiresAt.getTime() <= now);
                const remaining = expiresAt && !expired ? expiresAt.getTime() - now : null;
                const elapsed = suspendedAt ? Math.max(0, now - suspendedAt.getTime()) : null;
                const photo = driverDisplayIdentity(user).profilePhotoURL;
                const type = String(record?.suspensionType || suspension?.type || "account").toLowerCase();
                const member = {
                  ...membership,
                  userId,
                  companyId,
                  accountStatus: record?.accountStatus || user?.accountStatus || user?.status,
                  suspensionType: type,
                  suspension,
                };

                return (
                  <article
                    key={`${companyId || "company"}:${userId || index}`}
                    className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03]"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-200 text-slate-500 dark:bg-white/10">
                        {photo ? <CachedImage src={photo} alt="" className="h-full w-full object-cover" /> : <User size={20} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-bold text-slate-900 dark:text-white">{memberName(user)}</h3>
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700 dark:bg-red-400/10 dark:text-red-300">
                            {expired ? "Expirada" : "Suspenso"}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600 dark:bg-white/10 dark:text-nvu-text-soft">
                            {type === "operational" ? "Operacional" : "Conta"}
                          </span>
                        </div>
                        <p className="mt-1 flex items-center gap-1 truncate text-xs text-slate-500 dark:text-nvu-muted">
                          <Mail size={12} />
                          {user?.email || record?.email || "Sem e-mail"}
                        </p>
                      </div>
                    </div>

                    <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                      <div>
                        <dt className="text-slate-500">Empresa/frota</dt>
                        <dd className="font-semibold text-slate-800 dark:text-nvu-text">{record?.companyName || companyId || "Não informada"}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Função</dt>
                        <dd className="font-semibold text-slate-800 dark:text-nvu-text">{roleLabel(membership)}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Simulador</dt>
                        <dd className="font-semibold text-slate-800 dark:text-nvu-text">{user?.simulatorName || user?.simulator || user?.simulatorId || "Não informado"}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Responsável</dt>
                        <dd className="truncate font-semibold text-slate-800 dark:text-nvu-text">{suspension?.suspendedBy || "Não informado"}</dd>
                      </div>
                    </dl>

                    <div className="mt-4 space-y-1.5 rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-white/10 dark:bg-nvu-surface">
                      <p><strong>Suspenso em:</strong> {suspendedAt ? suspendedAt.toLocaleString("pt-BR") : "Não informado"}</p>
                      <p><strong>Duração:</strong> {expiresAt && suspendedAt ? formatDuration(expiresAt.getTime() - suspendedAt.getTime()) : "Indeterminada"}</p>
                      <p><strong>Decorrido:</strong> {elapsed === null ? "Não informado" : formatDuration(elapsed)}</p>
                      <p><strong>Tempo restante:</strong> {expiresAt ? (expired ? "Expirada" : formatDuration(remaining || 0)) : "Indeterminado"}</p>
                      <p className="pt-1 text-slate-600 dark:text-nvu-text-soft"><strong>Motivo:</strong> {suspension?.reason || record?.reason || (Array.isArray(suspension?.reasons) ? suspension.reasons.join(", ") : "Não informado")}</p>
                      {suspension?.message && <p className="text-slate-600 dark:text-nvu-text-soft"><strong>Mensagem:</strong> {suspension.message}</p>}
                    </div>

                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      {userId && companyId && (
                        <SeniorMemberActions
                          member={member}
                          user={user}
                          companyId={companyId}
                          companyName={record?.companyName || companyId}
                          triggerLabel="Gerenciar"
                          onUpdated={() => void onRefresh()}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => void endSuspension(record)}
                        disabled={!userId || !companyId || busyUserId === userId}
                        className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                      >
                        {busyUserId === userId ? "Encerrando..." : "Encerrar suspensão"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500 dark:border-white/10">
              Nenhum membro suspenso gerenciável foi encontrado.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
