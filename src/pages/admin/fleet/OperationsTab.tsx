import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useActivityStore, useOperationalStore, useSessionStore } from "../../../context/AppContext";
import { useCompanyStore } from "../../../context/CompanyContext";
import { ManagementDashboard, type ManagementAction } from "../../../components/admin/management/ManagementDashboard";
import { ManagementDialog } from "../../../components/admin/management/ManagementDialog";
import type { ManagementOperation } from "../../../components/admin/management/ManagementOperationCard";
import { RankingPeriodModal } from "../../../components/RankingPeriodModal";
import { useTripHistory } from "../../../hooks/useTripHistory";
import { auth } from "../../../lib/firebase";
import { useOperationalGoal } from "../../../hooks/useOperationalGoal";
import { useNetworkOnline } from "../../../hooks/useNetworkOnline";
import { managementCacheKey, readManagementCache, writeManagementCache } from "../../../lib/managementOfflineCache";
import { deriveCurrentOperationProgress, selectCurrentOperationJobs } from "../../../lib/currentOperation";
import { operationDateMs, resolveOperationContract } from "../../../lib/operationResultSummary";
import { normalizeTrip, calculateWeeklyMetrics, getWeeklyRange, getMonthlyRange } from "../../../lib/metricsEngine";
import { isTrailerlessSimulator, resolveSimulatorId } from "../../../lib/resolveSimulator";
import { resolveVehiclePhotoOperationSimulatorId } from "../../../lib/vehiclePhotoIdentity";
import { resolveSimulatorDisplayLabel } from "../../../lib/simulatorOptions";
import { resolveDriverPhoto } from "../../../lib/resolveDriverPhoto";
import { formatDriverName } from "../../../lib/utils";
import { formatHistoryMoney } from "../../../lib/tripMoneyPresentation";
import { rankingPickerDateFromKey, type RankingPeriodSelection } from "../../../lib/rankingPeriodSelection";
import { getRankingUtcCustomRange } from "../../../lib/rankingPeriods";
import { preloadImages } from "../../../lib/imageCache";
import { formatGoalAmount, formatGoalDraft, parseGoalAmount } from "../../../lib/goalMoneyInput";
import { commitNavigation } from "../../../lib/navigationTransition";

type SummaryPeriod = "semana" | "mensal" | "personalizado";
const dateFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" });
const dayFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
const monthFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", month: "long", year: "numeric" });
const dateKey = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

function savedSummaryPeriod(key: string, companyId: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || sessionStorage.getItem(`nvu-central-gestao-period:${companyId}`) || "{}");
    const dates = rankingPickerDateFromKey(saved.startDate || "") && rankingPickerDateFromKey(saved.endDate || "") && saved.startDate <= saved.endDate;
    return { period: (saved.period === "semana" ? "semana" : saved.period === "personalizado" && dates ? "personalizado" : "mensal") as SummaryPeriod, startDate: dates ? saved.startDate : dateKey(new Date()), endDate: dates ? saved.endDate : dateKey(new Date()) };
  } catch { return { period: "mensal" as SummaryPeriod, startDate: dateKey(new Date()), endDate: dateKey(new Date()) }; }
}

/** Data adapter only. Both mobile and desktop mount the new management view. */
export default function OperationsTab({ active = true }: { active?: boolean }) {
  const { currentUser } = useSessionStore();
  const { companies, activeCompanyId, allCompanyMembers } = useCompanyStore();
  const { users, contracts, jobs, vehicles, trailers, simulators, cancelJob, rejectJobDemand, operationalDataReady, operationalDataRefreshing } = useOperationalStore();
  const { jobDemands } = useActivityStore();
  const { historicoTrips = [], loading: historyLoading, refreshing: historyRefreshing, error: historyError } = useTripHistory(activeCompanyId, { userId: currentUser?.id });
  const navigate = useNavigate();
  const viewerId = auth.currentUser?.uid || currentUser?.id || "";
  const periodStorageKey = `nvu-central-period:${encodeURIComponent(viewerId)}:${encodeURIComponent(activeCompanyId || "")}`;
  const initialPeriod = useMemo(() => savedSummaryPeriod(periodStorageKey, activeCompanyId || ""), [periodStorageKey]);
  const [now, setNow] = useState(() => new Date());
  const [resumoPeriod, setResumoPeriod] = useState<SummaryPeriod>(initialPeriod.period);
  const [resumoStartDate, setResumoStartDate] = useState(() => initialPeriod.startDate);
  const [resumoEndDate, setResumoEndDate] = useState(() => initialPeriod.endDate);
  const [periodOwner, setPeriodOwner] = useState(periodStorageKey);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [infoId, setInfoId] = useState<string | null>(null);
  const [jobToCancel, setJobToCancel] = useState<string | null>(null);
  const [cancelSaving, setCancelSaving] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [goalSaveError, setGoalSaveError] = useState("");
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalDraft, setGoalDraft] = useState("");
  const [goalSaving, setGoalSaving] = useState(false);

  useEffect(() => {
    if (active) return;
    setInfoId(null); setJobToCancel(null); setGoalOpen(false); setPeriodOpen(false); setRequestsOpen(false);
  }, [active]);
  useEffect(() => {
    if (!active) return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, [active]);
  useEffect(() => {
    setInfoId(null); setJobToCancel(null); setGoalOpen(false); setPeriodOpen(false);
    setResumoPeriod(initialPeriod.period); setResumoStartDate(initialPeriod.startDate); setResumoEndDate(initialPeriod.endDate);
    setPeriodOwner(periodStorageKey);
  }, [periodStorageKey]);
  useEffect(() => {
    if (!activeCompanyId || periodOwner !== periodStorageKey) return;
    try { localStorage.setItem(periodStorageKey, JSON.stringify({ period: resumoPeriod, startDate: resumoStartDate, endDate: resumoEndDate })); }
    catch { /* Selection persistence cannot block the view. */ }
  }, [activeCompanyId, periodOwner, periodStorageKey, resumoPeriod, resumoStartDate, resumoEndDate]);

  const activeCompany = companies.find(company => company.id === activeCompanyId);
  const selectedSimulatorId = useMemo(() => activeCompany ? resolveSimulatorId(activeCompany, simulators, companies) : "", [activeCompany, simulators, companies]);
  const businessDay = dateKey(now);
  const range = useMemo(() => resumoPeriod === "semana" ? getWeeklyRange(now) : resumoPeriod === "mensal" ? getMonthlyRange(now) : getRankingUtcCustomRange(resumoStartDate, resumoEndDate), [resumoPeriod, resumoStartDate, resumoEndDate, businessDay]);
  const normalizedTrips = useMemo(() => historicoTrips.map((trip: any) => normalizeTrip({ ...trip, id: trip.id || trip.idViagem })), [historicoTrips]);
  const metrics = useMemo(() => calculateWeeklyMetrics(normalizedTrips, range.start, range.end, activeCompanyId, selectedSimulatorId, companies, undefined, simulators), [normalizedTrips, range, activeCompanyId, selectedSimulatorId, companies, simulators]);
  const earnings = metrics.moneyGroups.filter(group => group.currencyStatus === "known" && group.currency).map(group => formatHistoryMoney(group.value, group.currency, group.currencyStatus));
  const unresolvedTrips = metrics.moneyGroups.filter(group => group.currencyStatus !== "known").reduce((count, group) => count + group.tripCount, 0);
  if (unresolvedTrips) earnings.push(`${unresolvedTrips} ${unresolvedTrips === 1 ? "viagem" : "viagens"} sem moeda`);
  if (!earnings.length) earnings.push(formatHistoryMoney(0, "BRL", "known"));
  // The goal is in BRL. Other currencies must never inflate its progress.
  const goalRevenue = metrics.moneyGroups.find(group => group.currency === "BRL" && group.currencyStatus === "known")?.value || 0;
  const goalDocumentId = `${activeCompanyId}__${selectedSimulatorId || "unknown"}__${dateKey(range.start).replaceAll("-", "")}_${dateKey(range.end).replaceAll("-", "")}`;
  const identities = [viewerId, currentUser?.id].filter(Boolean);
  const canManageGoal = Boolean(viewerId && activeCompanyId && (identities.includes(activeCompany?.ownerId) || identities.includes(activeCompany?.userId) || allCompanyMembers.some(member => member.companyId === activeCompanyId && identities.includes(member.userId) && member.status === "active" && (member.roles?.includes("admin") || member.roles?.includes("owner" as any)))));
  const cacheScope = { viewerId, companyId: activeCompanyId || "", simulatorId: selectedSimulatorId, periodId: goalDocumentId };
  const goal = useOperationalGoal(cacheScope, goalDocumentId, canManageGoal);
  const { target: goalTarget, loading: goalLoading, error: goalError } = goal;
  const online = useNetworkOnline();
  const saveOperationalGoal = async () => {
    const amount = parseGoalAmount(goalDraft);
    setGoalSaving(true); setGoalSaveError("");
    try {
      if (!Number.isFinite(amount)) throw new Error("Informe uma meta maior que zero, no formato 200.000,00.");
      goal.save(amount, `range:${dateKey(range.start)}:${dateKey(range.end)}`);
      setGoalOpen(false);
    } catch (error) { setGoalSaveError(error instanceof Error ? error.message : "Não foi possível salvar a meta."); }
    finally { setGoalSaving(false); }
  };

  const operations = useMemo<ManagementOperation[]>(() => {
    const userMap = new Map(users.map(user => [user.id, user]));
    const vehicleMap = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
    const trailerMap = new Map(trailers.map(trailer => [trailer.id, trailer]));
    const currentIds = new Set(selectCurrentOperationJobs(jobs, activeCompanyId).map(job => job.id));
    const tripsByJob = new Map<string, any[]>();
    for (const trip of historicoTrips) {
      for (const key of new Set([trip.jobId, trip.operationId].map(value => String(value || "")).filter(Boolean))) {
        const group = tripsByJob.get(key) || []; group.push(trip); tripsByJob.set(key, group);
      }
    }
    return jobs.filter(job => job.companyId === activeCompanyId && (job.status === "pending" || currentIds.has(job.id))).map(job => {
      const contract = resolveOperationContract(job, contracts);
      const driver = userMap.get(job.driverId);
      const vehicle = vehicleMap.get(job.vehicleId);
      const snapshot = job as any;
      const showTrailer = !isTrailerlessSimulator(contract || activeCompany, simulators as unknown[]);
      const trailer = trailerMap.get(job.trailerId || contract?.trailerId);
      const simulatorId = resolveVehiclePhotoOperationSimulatorId(job, activeCompany, "", simulators as any[], companies as any[], vehicle ? [vehicle] : []);
      const simulator = simulators.find(value => String(value.id) === String(simulatorId || selectedSimulatorId));
      const due = operationDateMs(job.dueAt || job.deadlineDate);
      const diff = due - now.getTime();
      const operationTrips = [...(tripsByJob.get(job.id) || []), ...(job.operationId && job.operationId !== job.id ? tripsByJob.get(job.operationId) || [] : [])];
      const completed = deriveCurrentOperationProgress(job, operationTrips, job.driverId);
      const required = Math.max(0, Number(contract?.totalDeliveries) || 0);
      const state = job.status === "pending" ? "pending" : job.status === "awaiting_completion" ? "ready" : job.status === "delayed" || (due > 0 && diff < 0) ? "overdue" : "active";
      return {
        id: job.id, companyId: job.companyId, companyName: activeCompany?.companyName || "Empresa",
        driverId: job.driverId, driverName: formatDriverName(driver?.name || snapshot.driverName || "Motorista"), driverPhoto: resolveDriverPhoto(driver),
        contractId: job.contractId, name: contract?.name || "Operação", vehicleId: job.vehicleId || snapshot.vehicleSnapshot?.id || "",
        vehicleName: vehicle?.name || snapshot.vehicleName || snapshot.vehicleSnapshot?.name || "Veículo não confirmado",
        trailerName: trailer?.name || snapshot.trailerName, vehiclePaint: vehicle?.paintCode, trailerPaint: trailer?.paintCode, showTrailer,
        simulatorId, simulatorLabel: resolveSimulatorDisplayLabel(simulator || { id: simulatorId || selectedSimulatorId }),
        completed, required, remaining: Math.max(0, required - completed), progress: required ? Math.min(100, Math.max(0, Math.round(completed / required * 100))) : 0,
        deadline: due ? dateFormat.format(new Date(due)) : "Não definido", deadlineTimestamp: due,
        timeRemaining: !due ? "Não definido" : diff <= 0 ? "Prazo vencido" : `${Math.floor(diff / 86400000)}d · ${Math.floor(diff / 3600000) % 24}h · ${Math.floor(diff / 60000) % 60}min`,
        nearDeadline: Boolean(due && diff <= 2 * 86400000), state,
      };
    });
  }, [activeCompany, activeCompanyId, companies, contracts, historicoTrips, jobs, now, selectedSimulatorId, simulators, trailers, users, vehicles]);
  type CentralSnapshot = { earnings: string[]; tripCount: number; goalRevenue: number; operations: ManagementOperation[] };
  const summaryKey = managementCacheKey("summary", cacheScope);
  const [lastSnapshot, setLastSnapshot] = useState<{ key: string; value: CentralSnapshot; savedAt: number } | null>(null);
  const diskSnapshot = useMemo(() => readManagementCache<CentralSnapshot>("summary", cacheScope), [summaryKey]);
  const cached = lastSnapshot?.key === summaryKey ? lastSnapshot : diskSnapshot;
  const validCached = cached && Array.isArray(cached.value.earnings) && Array.isArray(cached.value.operations) && Number.isFinite(cached.value.tripCount) ? cached : null;
  const snapshotSignature = JSON.stringify({ earnings, tripCount: metrics.filteredTrips.length, goalRevenue, operations });
  useEffect(() => {
    if (!summaryKey || !online || !operationalDataReady || operationalDataRefreshing || historyLoading || historyRefreshing || historyError) return;
    const value = JSON.parse(snapshotSignature) as CentralSnapshot;
    if (writeManagementCache("summary", cacheScope, value)) setLastSnapshot({ key: summaryKey, value, savedAt: Date.now() });
  }, [summaryKey, snapshotSignature, online, operationalDataReady, operationalDataRefreshing, historyLoading, historyRefreshing, historyError]);
  const useSaved = Boolean(validCached && (!online || !operationalDataReady || historyLoading || historyRefreshing || historyError));
  const visibleOperations = useMemo(() => useSaved ? validCached!.value.operations.map(operation => {
    const due = operation.deadlineTimestamp || 0, diff = due - now.getTime();
    return { ...operation, nearDeadline: Boolean(due && diff <= 2 * 86400000),
      state: due && diff <= 0 && operation.state !== "pending" && operation.state !== "ready" ? "overdue" as const : operation.state,
      timeRemaining: !due ? operation.timeRemaining : diff <= 0 ? "Prazo vencido" : `${Math.floor(diff / 86400000)}d · ${Math.floor(diff / 3600000) % 24}h · ${Math.floor(diff / 60000) % 60}min`,
    };
  }) : operations, [useSaved, validCached, operations, now]);
  const visibleEarnings = useSaved ? validCached!.value.earnings : earnings;
  const visibleTripCount = useSaved ? validCached!.value.tripCount : metrics.filteredTrips.length;
  const visibleGoalRevenue = useSaved ? validCached!.value.goalRevenue : goalRevenue;
  const info = visibleOperations.find(operation => operation.id === infoId);
  const pendingDemands = jobDemands.filter(demand => demand.companyId === activeCompanyId && demand.status === "pending");
  useEffect(() => { void preloadImages(operations.map(operation => operation.driverPhoto).filter(Boolean), 6); }, [operations]);
  const onDriver = (operation: ManagementOperation) => {
    setInfoId(null);
    navigate(`/admin/driver/${operation.driverId}`, { state: { returnUrl: "/admin/fleet", returnState: { activeTab: "operations" }, companyId: operation.companyId } });
  };
  const onAction = (action: ManagementAction) => {
    if (action === "assign") { commitNavigation(() => navigate("/admin/assign")); return; }
    const state = action === "hr" ? { activeTab: "hr" } : action === "trips" ? { activeTab: "history" } : { activeTab: "fleet", activeFleetTab: action === "operations" ? "contracts" : action === "teams" ? "drivers" : "vehicles" };
    commitNavigation(() => navigate("/admin/fleet", { state }));
  };
  const onPeriodApply = (selection: RankingPeriodSelection) => {
    setResumoPeriod(selection.preset === "mes" ? "mensal" : selection.preset === "semana" ? "semana" : "personalizado");
    setResumoStartDate(selection.startDate); setResumoEndDate(selection.endDate); setPeriodOpen(false);
  };
  const monthLabel = monthFormat.format(now).replace(" de ", " ");
  const periodLabel = resumoPeriod === "mensal" ? monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1) : resumoPeriod === "semana" ? "Semana atual" : `${dayFormat.format(range.start)} – ${dayFormat.format(range.end)}`;
  return <>
    {(!online || useSaved) && <p className="nvu-central-cache-status" role="status">{validCached ? `${online ? "Dados salvos" : "Offline · dados salvos"} · ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(validCached.savedAt)}` : "Offline · conecte-se para carregar os dados pela primeira vez."}</p>}
    <ManagementDashboard active={active} periodLabel={periodLabel} periodDescription={`${dateFormat.format(range.start)} – ${dateFormat.format(range.end)}`} onPeriod={() => setPeriodOpen(true)} earnings={visibleEarnings} tripCount={visibleTripCount}
      goal={{ amount: goalTarget ? formatHistoryMoney(goalTarget, "BRL", "known") : goalError ? "Consulta pendente" : "Não configurada", progress: goalTarget ? visibleGoalRevenue / goalTarget * 100 : null, error: goalError || (goal.pending ? "Salva neste aparelho · aguardando sincronização" : !online && goal.cached ? "Offline · última meta salva" : ""), loading: goalLoading, canEdit: canManageGoal, onRetry: canManageGoal ? () => void goal.retry() : undefined }}
      onGoal={() => { setGoalDraft(goalTarget ? formatGoalAmount(goalTarget) : ""); setGoalSaveError(""); setGoalOpen(true); }}
      operations={visibleOperations} totalOperations={visibleOperations.length} onAction={onAction} onInfo={operation => setInfoId(operation.id)} onDriver={onDriver} loading={!operationalDataReady && !validCached} refreshing={online && operationalDataRefreshing} />
    {pendingDemands.length > 0 && <section className="nvu-central-section" style={{ marginTop: 10 }}><button type="button" className="nvu-central-section-toggle" onClick={() => setRequestsOpen(true)}>Solicitações de trabalho <span className="nvu-central-count">{pendingDemands.length}</span></button></section>}
    {periodOpen && <RankingPeriodModal preset={resumoPeriod === "mensal" ? "mes" : resumoPeriod === "semana" ? "semana" : "custom"} startDate={resumoStartDate} endDate={resumoEndDate} referenceDate={now} onApply={onPeriodApply} onClose={() => setPeriodOpen(false)} />}
    {goalOpen && <ManagementDialog title="Ajustar meta financeira" onClose={() => { if (!goalSaving) setGoalOpen(false); }}>
      <form className="nvu-central-dialog-body" onSubmit={event => { event.preventDefault(); void saveOperationalGoal(); }}>
        <p>{activeCompany?.companyName} · {dateFormat.format(range.start)} – {dateFormat.format(range.end)}</p>
        <label>Meta em R$<input inputMode="decimal" value={goalDraft} onChange={event => {
          const input = event.currentTarget, raw = input.value, caret = input.selectionStart;
          const edit = event.nativeEvent as InputEvent;
          const formatted = formatGoalDraft(raw, edit.inputType?.startsWith("delete") || edit.inputType === "insertText" && /^\d$/.test(edit.data || "")); setGoalDraft(formatted);
          if (caret !== null && formatted !== raw) requestAnimationFrame(() => { if (document.activeElement === input) input.setSelectionRange(Math.max(0, caret + formatted.length - raw.length), Math.max(0, caret + formatted.length - raw.length)); });
        }} onBlur={() => { const amount = parseGoalAmount(goalDraft); if (Number.isFinite(amount)) setGoalDraft(formatGoalAmount(amount)); }} placeholder="200.000,00" disabled={goalSaving} /></label>
        {goalSaveError && <p role="alert">{goalSaveError}</p>}
        <div className="nvu-central-dialog-actions"><button type="button" disabled={goalSaving} onClick={() => setGoalOpen(false)}>Cancelar</button><button type="submit" disabled={goalSaving || !canManageGoal} data-primary="true">{goalSaving ? "Salvando…" : "Salvar meta"}</button></div>
      </form>
    </ManagementDialog>}
    {info && <ManagementDialog title="Informações da operação" onClose={() => setInfoId(null)}>
      <div className="nvu-central-dialog-body"><dl className="nvu-central-info-list">
        {[["Motorista", info.driverName], ["Empresa", info.companyName], ["Operação", info.name], ["Simulador", info.simulatorLabel], ["Veículo", info.vehicleName], ...(info.showTrailer ? [["Reboque", info.trailerName || "Sem reboque"]] : []), ["Entregas", `${info.completed}/${info.required || "—"}`], ["Prazo limite", info.deadline], ["Tempo restante", info.timeRemaining]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl><div className="nvu-central-dialog-actions"><button type="button" onClick={() => onDriver(info)}>Perfil do motorista</button><button type="button" onClick={() => navigate(`/admin/contract/${info.contractId}`)}>Ver operação</button><button type="button" data-danger="true" onClick={() => { setCancelError(""); setJobToCancel(info.id); }}>Cancelar trabalho</button></div></div>
    </ManagementDialog>}
    {jobToCancel && <ManagementDialog title="Cancelar trabalho?" onClose={() => { if (!cancelSaving) setJobToCancel(null); }}><div className="nvu-central-dialog-body">
      <p>O motorista perderá o acesso à finalização deste trabalho.</p>{cancelError && <p role="alert">{cancelError}</p>}
      <div className="nvu-central-dialog-actions"><button type="button" disabled={cancelSaving} onClick={() => setJobToCancel(null)}>Voltar</button><button type="button" data-danger="true" disabled={cancelSaving} onClick={async () => {
        setCancelSaving(true); setCancelError("");
        try { await cancelJob(jobToCancel); setJobToCancel(null); setInfoId(null); }
        catch { setCancelError("Não foi possível cancelar o trabalho. Tente novamente."); }
        finally { setCancelSaving(false); }
      }}>{cancelSaving ? "Cancelando…" : "Confirmar cancelamento"}</button></div>
    </div></ManagementDialog>}
    {requestsOpen && <ManagementDialog title="Solicitações de trabalho" onClose={() => setRequestsOpen(false)}><div className="nvu-central-dialog-body">
      {pendingDemands.map(demand => <div className="nvu-central-paint" key={demand.id}><h3>{formatDriverName(users.find(user => user.id === demand.driverId)?.name || "Motorista")}</h3><div className="nvu-central-dialog-actions">
        <button type="button" onClick={() => navigate("/admin/assign", { state: { preselectedDriverId: demand.driverId } })}>Encaminhar</button>
        <button type="button" onClick={() => navigate(`/admin/driver/${demand.driverId}`, { state: { companyId: activeCompanyId, returnUrl: "/admin/fleet", returnState: { activeTab: "operations" } } })}>Perfil</button>
        <button type="button" data-danger="true" onClick={async () => { try { await rejectJobDemand(demand.id); } catch { setRequestError("Não foi possível recusar a solicitação."); } }}>Recusar</button>
      </div></div>)}{!pendingDemands.length && <p>Nenhuma solicitação pendente.</p>}{requestError && <p role="alert">{requestError}</p>}
    </div></ManagementDialog>}
  </>;
}
