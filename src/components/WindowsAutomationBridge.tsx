import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useOperationalStore, useSessionStore } from "../context/AppContext";
import { useCompanyStore } from "../context/CompanyContext";
import { selectCurrentOperationJob } from "../lib/currentOperation";
import { getSimpleAutomationSimulator } from "../lib/simpleAutomation";
import { getProLaunchAvailability } from "../lib/proLaunchAvailability";
import { isWindowsDesktop, type WindowsGame, type WindowsStatus } from "../lib/windowsAutomation";
import { synchronizeWindowsDeliveries } from "../services/windowsAutomationService";
import { resolveWindowsNavigation } from "../lib/windowsNavigation";
import { ModalPortal } from "./ui/ModalPortal";
import { WindowsAutomationPanel } from "./WindowsAutomationPanel";
import { useTheme } from "../hooks/useTheme";
import { applyWindowsTheme } from "../lib/windowsTheme";
const OperationTrips = lazy(() => import("../pages/driver/TripHistory"));

export function WindowsAutomationBridge() { return isWindowsDesktop() ? <WindowsAutomationRuntime /> : null; }
function WindowsAutomationRuntime() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { currentUser } = useSessionStore();
  const { jobs, contracts, simulators } = useOperationalStore();
  const { activeCompanyId, companies } = useCompanyStore();
  const [status, setStatus] = useState<WindowsStatus | null>(null);
  const [open, setOpen] = useState(false), [games, setGames] = useState<WindowsGame[]>([]);
  const [busy, setBusy] = useState(false);
  const [settingsTab,setSettingsTab]=useState<"journey"|"games"|"help">("journey");
  const [tripsOpen, setTripsOpen] = useState(false), [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const job: any = selectCurrentOperationJob(jobs, currentUser?.id, activeCompanyId);
  const contract: any = contracts.find(c => c.id === job?.contractId);
  const company = companies.find(c => c.id === activeCompanyId);
  const simulator = getSimpleAutomationSimulator(company, simulators) || getSimpleAutomationSimulator(contract, simulators);
  const ready = getProLaunchAvailability({ job, confirmedTripCount: Number(job?.progress || 0),
    totalDeliveries: job?.totalDeliveries || contract?.totalDeliveries, hasContract: !!contract, hasCompany: !!company, hasUser: !!currentUser });
  const scope = useMemo(() => currentUser ? {
    driverId: currentUser.id, companyId: activeCompanyId || "", jobId: job?.id || "", contractId: contract?.id || "",
    simulatorKey: simulator?.key || "", operationName: contract?.name || "Operação atual",
    progress: Number(job?.progress || 0), total: Number(job?.totalDeliveries || contract?.totalDeliveries || 0), closed: !ready.canLaunch,
  } : null, [currentUser?.id, activeCompanyId, job?.id, job?.progress, job?.totalDeliveries, contract?.id, contract?.name, contract?.totalDeliveries, simulator?.key, ready.canLaunch]);
  useEffect(()=>{void window.nvuWindows!.setTheme?.(theme).catch(()=>toast.error("Não foi possível sincronizar o tema do assistente."));},[theme]);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  useEffect(() => { setTripsOpen(false); setDiagnostics(null); }, [scope?.driverId, scope?.companyId, scope?.jobId]);
  useEffect(() => { void window.nvuWindows!.syncScope(scope).catch(() => toast.error("Não foi possível atualizar a sessão Windows.")); }, [scope]);
  useEffect(() => {
    const off = window.nvuWindows!.onUpdate(s => { setStatus(s); applyWindowsTheme(s.theme); void synchronizeWindowsDeliveries(s).catch(() => {
      // The native journal still owns the delivery. Retry on the next update.
    }); });
    const offNavigation = window.nvuWindows!.onNavigate(where => {
      const action = resolveWindowsNavigation(where, scopeRef.current);
      if (action === "panel") navigate("/driver/profile");
      else if (action === "trips") { navigate("/driver/profile"); setTripsOpen(true); }
      else if (action === "setup") { setSettingsTab("games"); setOpen(true); void window.nvuWindows!.discoverGames().then(setGames).catch(() => toast.error("Não foi possível localizar os simuladores.")); }
      else toast.error("O contexto da operação mudou. Abra novamente as ações da NVU.");
    });
    void window.nvuWindows!.status().then(setStatus).catch(() => toast.error("Não foi possível consultar o PRO Windows."));
    return () => { off(); offNavigation(); };
  }, [navigate]);
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true); try { await fn(); } catch (error) { toast.error(error instanceof Error ? error.message : "Ação Windows indisponível."); }
    finally { setBusy(false); }
  };
  if (!currentUser) return null;
  return <>
    <WindowsAutomationPanel status={status} scope={scope} open={open} busy={busy} games={games} diagnostics={diagnostics}
      canLaunch={ready.canLaunch && !!scope && !!simulator} launchMessage={ready.message} tab={settingsTab} onTab={setSettingsTab}
      onOpen={() => { setOpen(true); void window.nvuWindows!.discoverGames().then(setGames).catch(() => toast.error("Não foi possível localizar os simuladores.")); }}
      onClose={() => setOpen(false)} onRun={action}
      onActivate={async () => {
        const { assertWorkModeEntryAllowed } = await import("../services/workModeAvailabilityService");
        await assertWorkModeEntryAllowed("pro", scope!.simulatorKey);
        await window.nvuWindows!.start(scope!); await window.nvuWindows!.openGame(scope!.simulatorKey);
      }} onGames={setGames} onDiagnostics={setDiagnostics}
      onHistory={() => { setOpen(false); setTripsOpen(true); }} onReview={() => { setOpen(false); navigate("/driver/trip?mode=print"); }} />
    {tripsOpen && job && <ModalPortal label="Viagens da operação" onClose={() => setTripsOpen(false)}>
      <div className="w-full max-w-3xl max-h-[85vh] overflow-auto rounded-2xl bg-white dark:bg-slate-900 p-4 shadow-xl">
        <div className="flex justify-between items-center text-sm font-semibold"><span>Viagens · {scope?.operationName}</span><button aria-label="Fechar viagens da operação" onClick={() => setTripsOpen(false)}>✕</button></div>
        <Suspense fallback={<p className="p-4 text-xs">Abrindo viagens da operação…</p>}><OperationTrips embeddedJob={job} companyId={scope?.companyId} mode="driver" defaultDriverId={currentUser.id} hideDriverFilter hideHeaderActions hideFloatingSummary compactDriverView /></Suspense>
      </div>
    </ModalPortal>}
  </>;
}
