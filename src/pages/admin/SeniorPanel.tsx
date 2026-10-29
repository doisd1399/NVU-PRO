import { queryPrivateUsers, readPrivateUser } from "../../services/privateUserProfiles";
import { CachedImage } from "../../components/common/CachedImage";
import { deleteCompanyCanonical } from "../../services/seniorAccountAdministrationService";
import { uniqueCompanyMembers } from "../../lib/seniorMembers";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useOperationalStore, useSessionStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { Card, CardContent } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import {
  CheckCircle2,
  XCircle,
  Building2,
  Megaphone,
  Users,
  FileText,
  Trash2,
  TrendingUp,
  Truck,
  Package,
  Settings,
  ChevronLeft,
  ChevronRight,
  Briefcase,
  ArrowRight,
  Activity,
  Gamepad2,
  Navigation,
  ShieldCheck,
  RefreshCw,
  Wrench,
  UserX,

  Filter,
  Search,
  ChevronDown,
  X,
} from "lucide-react";
import { db, auth, functions } from "../../lib/firebase";
import { httpsCallable } from "firebase/functions";
import {
  collection,
  query,
  where,
  getDocs,
  getCountFromServer,
  getDoc,
  updateDoc,
  doc,
  deleteDoc,
  setDoc,
  writeBatch,
  runTransaction,
  serverTimestamp,
  deleteField,
  onSnapshot,
  orderBy,
  limit,
  startAfter,
  documentId,
} from "firebase/firestore";
import { toast } from "sonner";
import { syncSingleSimulatorMember, removeSimulatorMember } from "../../lib/syncSimulatorMembers";
import { cn } from "../../lib/utils";
import { SimulatorManagerModal } from "../../components/admin/SimulatorManagerModal";
import { SimpleCityManagerModal } from "../../components/admin/SimpleCityManagerModal";
import { CreateNewsModal } from "../../components/admin/CreateNewsModal";
import { SeniorMemberActions } from "../../components/admin/SeniorMemberActions";
import { SuspendedMembersModal } from "../../components/admin/SuspendedMembersModal";
import { WorkModeAvailabilityModal } from "../../components/admin/WorkModeAvailabilityModal";
import {
  isCompanyRegistration,
  normalizeRegistrationImages,
} from "../../lib/registrationImages";
import { hydrateRegistrationImages } from "../../lib/registrationImageStorage";
import { resolveSimulatorId } from "../../lib/resolveSimulator";
import {
  buildSimulatorSelectorOptions,
  resolveSimulatorDisplayLabel,
} from "../../lib/simulatorOptions";
import { createNotification } from "../../services/notificationService";
import { isAuthTeardownActive, onAuthTeardown } from "../../lib/authLifecycle";
import { authenticateSeniorAccess } from "../../services/seniorAccessService";
import { listSeniorSuspendedMembers } from "../../services/seniorAccountAdministrationService";
import { getSeniorMonthlyMetrics } from "../../services/seniorMonthlyMetricsService";
import { registerSeniorMetricsInvalidation } from "../../services/seniorMetricsInvalidationService";

import { SeniorRegistrationList } from "../../components/admin/senior/SeniorRegistrationList";
import { SeniorRegistrationReview } from "../../components/admin/senior/SeniorRegistrationReview";
import { seniorMonthlyMetricsCache } from "../../lib/seniorMonthlyMetricsCache";
import { readSeniorPanelCache, writeSeniorPanelCache } from "../../lib/seniorPanelCache";
import { registrationSubmittedDate } from "../../lib/registrationSubmission";
import { registerOptionModal } from "../../lib/optionModalStack";
import { useLiveCalendarReference } from "../../hooks/useLiveCalendarReference";
import { buildRankingUtcPeriodKey } from "../../lib/rankingPeriods";
import "./SeniorPanel.css";

type SeniorTab = "requests" | "approved" | "profile" | "settings";

type SeniorNavigation = {
  activeTab: SeniorTab;
  selectedCompanyId: string | null;
  selectedRegistrationId: string | null;
};

const SENIOR_COMPANY_PAGE_SIZE = 20;
const FIRESTORE_IN_QUERY_CHUNK = 10;

const isActiveCompanyRecord = (company: any): boolean => {
  const status = String(
    company?.status || company?.situacao || company?.state || "active",
  ).trim().toLowerCase();
  const isDeleted =
    company?.deleted === true ||
    company?.softDeleted === true ||
    company?.excluida === true ||
    company?.excluido === true ||
    ["deleted", "excluida", "excluido", "removed", "removida", "removido"].includes(status);
  return ["active", "approved", "ativo"].includes(status) && !isDeleted;
};

const mergeRecordsById = (current: any[], incoming: any[]) => {
  const records = new Map<string, any>();
  current.forEach((record) => records.set(String(record.id), record));
  incoming.forEach((record) => records.set(String(record.id), record));
  return Array.from(records.values());
};

const splitIntoChunks = <T,>(items: T[], chunkSize: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

const getSeniorNavigation = (state: unknown): SeniorNavigation => {
  const routeState =
    state && typeof state === "object"
      ? (state as Record<string, unknown>)
      : {};
  const requestedTab = routeState.activeTab;
  const activeTab: SeniorTab =
    requestedTab === "approved" ||
    requestedTab === "profile" ||
    requestedTab === "settings" ||
    requestedTab === "requests"
      ? requestedTab
      : "approved";
  const selectedCompanyId =
    typeof routeState.selectedCompanyId === "string"
      ? routeState.selectedCompanyId
      : null;

  const selectedRegistrationId = typeof routeState.selectedRegistrationId === "string" ? routeState.selectedRegistrationId : null;
  return { activeTab, selectedCompanyId, selectedRegistrationId };
};

export default function SeniorPanel() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    currentUser,
    setIsSeniorAuthenticated,
    switchRole,
    setSeniorCompanyId,
    activeRole,
  } = useSessionStore();
  const {
    setActiveCompanyId,
    removeDriverFromFleet,
    primeCompanyProfile,
    memberships,
    activeCompanyId,
  } = useCompanyStore();
  const { simulators } = useOperationalStore();
  const [loadingAction, setLoadingAction] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [isCreateNewsModalOpen, setIsCreateNewsModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSimulatorManagerOpen, setIsSimulatorManagerOpen] = useState(false);
  const [isSimpleCityManagerOpen, setIsSimpleCityManagerOpen] = useState(false);
  const [isWorkModeAvailabilityOpen, setIsWorkModeAvailabilityOpen] = useState(false);
  const [isSuspendedMembersOpen, setIsSuspendedMembersOpen] = useState(false);
  const [suspendedMembers, setSuspendedMembers] = useState<any[]>([]);
  const [loadingSuspendedMembers, setLoadingSuspendedMembers] = useState(false);
  const [suspendedMembersError, setSuspendedMembersError] = useState("");

  const [password, setPassword] = useState("");
  const [authenticatingSenior, setAuthenticatingSenior] = useState(false);
  const currentUid = auth.currentUser?.uid || currentUser?.id || "";
  const loadSuspendedMembers = useCallback(async () => {
    setLoadingSuspendedMembers(true);
    setSuspendedMembersError("");
    try {
      const members = await listSeniorSuspendedMembers();
      setSuspendedMembers(members);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível consultar os membros suspensos no servidor.";
      setSuspendedMembersError(message);
      console.error("[NVU Senior] failed to load suspended members", error);
      toast.error(message);
    } finally {
      setLoadingSuspendedMembers(false);
    }
  }, []);
  const [unlocked, setUnlocked] = useState(false);
  const [seniorClaimConfirmed, setSeniorClaimConfirmed] = useState(false);

  useEffect(() => {
    let active = true;
    const firebaseUser = auth.currentUser;
    if (!currentUid || !firebaseUser) {
      setSeniorClaimConfirmed(false);
      setUnlocked(false);
      setIsSeniorAuthenticated(false);
      return;
    }

    void firebaseUser
      .getIdTokenResult()
      .then((token) => {
        if (!active) return;
        const confirmed = token.claims.senior === true;
        setSeniorClaimConfirmed(confirmed);
        setUnlocked(confirmed);
        setIsSeniorAuthenticated(confirmed);
      })
      .catch(() => {
        if (!active) return;
        setSeniorClaimConfirmed(false);
        setUnlocked(false);
        setIsSeniorAuthenticated(false);
      });

    return () => {
      active = false;
    };
  }, [currentUid, setIsSeniorAuthenticated]);

  const initialCatalog = readSeniorPanelCache(currentUid);
  const [catalogViewer, setCatalogViewer] = useState(currentUid);
  const [catalogReady, setCatalogReady] = useState(Boolean(initialCatalog));
  // Global Data States
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [allCompanies, setAllCompanies] = useState<any[]>(() => initialCatalog?.companies || []);
  const [allMembers, setAllMembers] = useState<any[]>(() => initialCatalog?.members || []);
  const [allContracts, setAllContracts] = useState<any[]>([]);
  const [allJobs, setAllJobs] = useState<any[]>([]);
  const [allVehicles, setAllVehicles] = useState<any[]>([]);
  const [allTrailers, setAllTrailers] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>(() => initialCatalog?.users || []);
  const [systemSettings, setSystemSettings] = useState<any>({});
  const [companiesCursor, setCompaniesCursor] = useState<any>(() => initialCatalog?.companies.at(-1)?.id || null);
  const [hasMoreCompanies, setHasMoreCompanies] = useState(true);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [companiesTotalCount, setCompaniesTotalCount] = useState<number | null>(() => initialCatalog?.totalCount ?? null);
  const [companyCatalogError, setCompanyCatalogError] = useState("");
  const companyPageRequestRef = useRef(false);
  const companyCatalogVersionRef = useRef(0);

  // UI States
  const [activeTab, setActiveTab] = useState<SeniorTab>(() =>
    getSeniorNavigation(location.state).activeTab,
  );
  const monthlyCalendar = useLiveCalendarReference("utc");
  const monthlyPeriod = buildRankingUtcPeriodKey("mes", monthlyCalendar);
  const metricsScope = `${currentUid}:${monthlyPeriod}`;
  const cachedMetrics = seniorMonthlyMetricsCache.read(currentUid);
  const [monthlyMetrics, setMonthlyMetrics] = useState(() => cachedMetrics?.companies || {});
  const [monthlyMetricsScope, setMonthlyMetricsScope] = useState(metricsScope);
  const [monthlyMetricsState, setMonthlyMetricsState] = useState<"idle" | "loading" | "ready" | "error">(() => cachedMetrics ? "ready" : "idle");
  const monthlyDataReady = monthlyMetricsScope === metricsScope && monthlyMetricsState === "ready";
  useEffect(() => {
    if (!unlocked || !currentUid || (activeTab !== "approved" && activeTab !== "profile")) return;
    let active = true, requestId = 0;
    const apply = (result: ReturnType<typeof seniorMonthlyMetricsCache.read>) => {
      if (!result || result.periodKey !== monthlyPeriod) return false;
      setMonthlyMetrics(result.companies);
      setMonthlyMetricsScope(metricsScope);
      setMonthlyMetricsState("ready");
      return true;
    };
    const refreshMetrics = () => {
      const currentRequestId = ++requestId;
      const cached = seniorMonthlyMetricsCache.read(currentUid);
      if (!apply(cached)) {
        setMonthlyMetrics({}); setMonthlyMetricsScope(metricsScope);
        setMonthlyMetricsState(navigator.onLine ? "loading" : "idle");
      }
      if (!navigator.onLine && !cached) return;
      void seniorMonthlyMetricsCache.load(currentUid, getSeniorMonthlyMetrics).then(result => {
        if (active && currentRequestId === requestId && !isAuthTeardownActive()) apply(result);
      }).catch(error => {
        if (!active || currentRequestId !== requestId || isAuthTeardownActive()) return;
        if (!apply(seniorMonthlyMetricsCache.read(currentUid))) setMonthlyMetricsState("error");
        console.warn("[NVU Senior] Consulta mensal preservada durante falha de atualização", error);
      });
    };
    refreshMetrics();
    const stopInvalidation = registerSeniorMetricsInvalidation(refreshMetrics);
    window.addEventListener("online", refreshMetrics);
    window.addEventListener("focus", refreshMetrics);
    window.addEventListener("nvu-session-refresh", refreshMetrics);
    return () => {
      active = false; requestId++;
      stopInvalidation();
      window.removeEventListener("online", refreshMetrics);
      window.removeEventListener("focus", refreshMetrics);
      window.removeEventListener("nvu-session-refresh", refreshMetrics);
    };
  }, [activeTab, currentUid, monthlyPeriod, metricsScope, unlocked]);
  useEffect(() => {
    if (unlocked && activeTab === "approved") void loadSuspendedMembers();
  }, [activeTab, loadSuspendedMembers, unlocked]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(
    () => getSeniorNavigation(location.state).selectedCompanyId,
  );
  
  const selectedRegistrationId = getSeniorNavigation(location.state).selectedRegistrationId;
  const openRegistration = (id: string) => navigate(location.pathname, { state: {
    ...(location.state || {}), activeTab: "requests", selectedRegistrationId: id, registrationHistoryEntry: true,
  } });
  const closeRegistration = useCallback(() => {
    if (location.state?.registrationHistoryEntry === true && getSeniorNavigation(location.state).selectedRegistrationId) navigate(-1);
    else navigate(location.pathname, { replace: true, state: {
      ...(location.state || {}), activeTab: "requests", selectedRegistrationId: null, registrationHistoryEntry: false,
    } });
  }, [location.pathname, location.state, navigate]);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showApproveConfirm, setShowApproveConfirm] = useState<string | null>(null);
  const [showRejectConfirm, setShowRejectConfirm] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  // Browser Back restores the list route even when a nested confirmation is open.
  useEffect(() => {
    if (!selectedRegistrationId) {
      setShowApproveConfirm(null);
      setShowRejectConfirm(null);
      setZoomedImage(null);
    }
  }, [selectedRegistrationId]);

  useEffect(() => {
    if (!showApproveConfirm && !showRejectConfirm && !zoomedImage) return;
    const close = () => {
      if (zoomedImage) setZoomedImage(null);
      else if (showApproveConfirm) setShowApproveConfirm(null);
      else setShowRejectConfirm(null);
    };
    const modal = registerOptionModal(close);
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape" && modal.isTop()) { event.preventDefault(); close(); } };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); modal.dispose(); };
  }, [zoomedImage, showApproveConfirm, showRejectConfirm]);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteRegId, setConfirmDeleteRegId] = useState<string | null>(null);
  const [companySearch, setCompanySearch] = useState("");
  const [selectedSimulator, setSelectedSimulator] = useState("all");
  const [simulatorMenuOpen, setSimulatorMenuOpen] = useState(false);
  const [expandedStaffCompanyId, setExpandedStaffCompanyId] = useState<string | null>(null);

  const memberRelationsRevisionRef = useRef(0);
  const hydrateCompanyRelations = useCallback(async (companies: any[]) => {
    const requestVersion = companyCatalogVersionRef.current;
    const memberRevision = memberRelationsRevisionRef.current;
    const companyIds = Array.from(
      new Set(
        companies
          .map((company) => String(company?.id || "").trim())
          .filter(Boolean),
      ),
    );
    if (companyIds.length === 0) return;

    const memberSnapshots = await Promise.all(
      splitIntoChunks(companyIds, FIRESTORE_IN_QUERY_CHUNK).map((ids) =>
        getDocs(
          query(
            collection(db, "companyMembers"),
            where("companyId", "in", ids),
          ),
        ),
      ),
    );
    const members = memberSnapshots.flatMap((snapshot) =>
      snapshot.docs.map((memberDocument) => ({
        id: memberDocument.id,
        ...memberDocument.data(),
      })),
    );

    const userIds = Array.from(
      new Set(
        [
          ...companies.map((company: any) => company?.ownerId || company?.userId),
          ...members.map((member: any) => member?.userId),
        ]
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    );
    const userSnapshots = await Promise.all(
      splitIntoChunks(userIds, FIRESTORE_IN_QUERY_CHUNK).map((ids) =>
        queryPrivateUsers({ ids }),
      ),
    );
    const users = userSnapshots.flatMap((snapshot) =>
      snapshot.docs.map((userDocument) => ({
        id: userDocument.id,
        ...userDocument.data(),
      })),
    );

    if (requestVersion !== companyCatalogVersionRef.current || isAuthTeardownActive()) return;
    if (memberRevision !== memberRelationsRevisionRef.current) return;
    setAllMembers((current) => [...current.filter(member => !companyIds.includes(String(member.companyId))), ...members]);
    setAllUsers((current) => mergeRecordsById(current, users));
  }, []);

  const loadCompanyPage = useCallback(
    async (cursor: any = null, replace = false) => {
      if (companyPageRequestRef.current) return;
      companyPageRequestRef.current = true;
      setLoadingCompanies(true);
      setCompanyCatalogError("");
      const requestVersion = companyCatalogVersionRef.current;

      try {
        const pageQuery = cursor
          ? query(
              collection(db, "frotas"),
              orderBy(documentId()),
              startAfter(cursor),
              limit(SENIOR_COMPANY_PAGE_SIZE),
            )
          : query(
              collection(db, "frotas"),
              orderBy(documentId()),
              limit(SENIOR_COMPANY_PAGE_SIZE),
            );
        const snapshot = await getDocs(pageQuery);
        if (
          requestVersion !== companyCatalogVersionRef.current ||
          isAuthTeardownActive()
        ) {
          return;
        }

        const companies = snapshot.docs.map((companyDocument) => ({
          id: companyDocument.id,
          ...companyDocument.data(),
        }));
        // A cache-only empty Firestore result is not a server-confirmed deletion.
        // Preserve our known catalogue if connectivity was lost during this read.
        if (snapshot.metadata?.fromCache && companies.length === 0) {
          setHasMoreCompanies(false);
          return;
        }
        setAllCompanies((current) =>
          replace ? companies : mergeRecordsById(current, companies),
        );
        setCatalogReady(true);
        setCompaniesCursor(snapshot.docs.at(-1) || null);
        setHasMoreCompanies(snapshot.docs.length === SENIOR_COMPANY_PAGE_SIZE);

        await hydrateCompanyRelations(companies);
      } catch (error) {
        if (
          requestVersion === companyCatalogVersionRef.current &&
          !isAuthTeardownActive()
        ) {
          console.warn("[NVU Senior] Falha ao carregar empresas:", error);
          setCompanyCatalogError(
            "Não foi possível carregar a lista de empresas. Tente novamente.",
          );
        }
      } finally {
        if (requestVersion === companyCatalogVersionRef.current) {
          companyPageRequestRef.current = false;
          setLoadingCompanies(false);
        }
      }
    },
    [hydrateCompanyRelations],
  );

  // The senior panel contains multiple views inside one route. Mirror the
  // selected view into React Router so browser/WebView Back can restore the
  // previous corporate view.
  useEffect(() => {
    const nextNavigation = getSeniorNavigation(location.state);
    setActiveTab(nextNavigation.activeTab);
    setSelectedCompanyId(nextNavigation.selectedCompanyId);
  }, [location.state]);

  const selectSeniorTab = (
    nextTab: SeniorTab,
    nextCompanyId: string | null =
      nextTab === "profile" ? selectedCompanyId : null,
  ) => {
    if (nextTab === activeTab && nextCompanyId === selectedCompanyId) return;

    const currentState =
      location.state && typeof location.state === "object"
        ? (location.state as Record<string, unknown>)
        : {};

    navigate(location.pathname, {
      state: {
        ...currentState,
        activeTab: nextTab,
        selectedCompanyId: nextTab === "profile" ? nextCompanyId : null,
        selectedRegistrationId: null, registrationHistoryEntry: false,
      },
    });
  };

  useEffect(() => {
    if (!unlocked) return;

    companyCatalogVersionRef.current += 1;
    companyPageRequestRef.current = false;
    const cached = readSeniorPanelCache(currentUid);
    setCatalogViewer(currentUid); setCatalogReady(Boolean(cached));
    setAllCompanies(cached?.companies || []);
    setAllMembers(cached?.members || []);
    setAllUsers(cached?.users || []);
    setCompaniesCursor(cached?.companies.at(-1)?.id || null);
    setHasMoreCompanies(true);
    setCompaniesTotalCount(cached?.totalCount ?? null);
    setCompanyCatalogError("");

    const unsubs: Array<() => void> = [];
    let stopped = false;
    let registrationHydrationVersion = 0;

    const stop = () => {
      if (stopped) return;
      stopped = true;
      unsubs.splice(0).forEach((unsubscribe) => {
        try {
          unsubscribe();
        } catch {
          // Listener cleanup is best-effort during logout.
        }
      });
    };
    const removeTeardownListener = onAuthTeardown(stop);
    const snapshotError = (label: string) => (error: unknown) => {
      if (!stopped && !isAuthTeardownActive()) {
        console.warn(`[NVU Senior] ${label}:`, error);
      }
    };

    // Load only the first page of companies and hydrate relations belonging
    // to those companies. Additional pages are fetched explicitly by the
    // administrator, avoiding full reads of frotas/companyMembers/users.
    if (navigator.onLine || !cached) void loadCompanyPage(null, true);
    const syncApprovalNews = httpsCallable<
      Record<string, never>,
      { activeCompanies?: number }
    >(functions, "syncCompanyApprovalNews");
    if (navigator.onLine) void syncApprovalNews({})
      .then((response) => {
        const activeCount = Number(response.data.activeCompanies);
        if (!Number.isFinite(activeCount)) {
          throw new Error("A sincronização não retornou a contagem ativa.");
        }
        if (!stopped && !isAuthTeardownActive()) setCompaniesTotalCount(activeCount);
      })
      .catch(async (error) => {
        snapshotError("Falha ao sincronizar a contagem de empresas")(error);
        try {
          // Do not fall back to downloading every company document just to
          // render the total. Aggregation keeps the Senior first paint bounded
          // even when the callable is temporarily unavailable.
          const countSnapshot = await getCountFromServer(
            query(
              collection(db, "frotas"),
              where("status", "in", ["active", "approved", "ativo"]),
            ),
          );
          const activeCount = countSnapshot.data().count;
          if (!stopped && !isAuthTeardownActive()) {
            setCompaniesTotalCount(activeCount);
          }
        } catch (fallbackError) {
          snapshotError("Falha ao contar empresas ativas")(fallbackError);
        }
      });

    // New company requests remain realtime because this is a small,
    // operational queue that administrators need to see while the panel is
    // open. Other large collections are no longer subscribed globally.
    const registrationsQuery = query(
      collection(db, "recruitment_applications"),
      where("status", "in", ["pending", "rejected"]),
      limit(100),
    );
    unsubs.push(
      onSnapshot(
        registrationsQuery,
        (snapshot) => {
          if (stopped || isAuthTeardownActive()) return;
          const version = ++registrationHydrationVersion;
          const normalized = snapshot.docs
            .map((document) =>
              normalizeRegistrationImages({
                id: document.id,
                ...document.data(),
              }),
            )
            .filter((registration) => isCompanyRegistration(registration));
          setRegistrations(normalized);
          void Promise.all(
            normalized.map((registration) =>
              hydrateRegistrationImages(registration),
            ),
          )
            .then((hydrated) => {
              if (
                !stopped &&
                !isAuthTeardownActive() &&
                version === registrationHydrationVersion
              ) {
                setRegistrations(hydrated);
              }
            })
            .catch((error) => {
              if (!stopped && !isAuthTeardownActive()) {
                console.warn(
                  "[NVU Senior] Falha ao resolver imagem legada:",
                  error,
                );
              }
            });
        },
        snapshotError("Falha ao ler inscrições"),
      ),
    );

    unsubs.push(
      onSnapshot(
        doc(db, "settings", "system"),
        (snapshot) => {
          if (stopped || isAuthTeardownActive()) return;
          if (snapshot.exists()) setSystemSettings(snapshot.data());
        },
        snapshotError("Falha ao ler configurações"),
      ),
    );

    return () => {
      companyCatalogVersionRef.current += 1;
      companyPageRequestRef.current = false;
      removeTeardownListener();
      stop();
    };
  }, [currentUid, loadCompanyPage, unlocked]);

  useEffect(() => {
    if (!unlocked || !catalogReady || !currentUid || catalogViewer !== currentUid || isAuthTeardownActive()) return;
    writeSeniorPanelCache(currentUid, { companies: allCompanies, members: allMembers, users: allUsers, totalCount: companiesTotalCount });
  }, [allCompanies, allMembers, allUsers, companiesTotalCount, currentUid, catalogViewer, catalogReady, unlocked]);

  // A profile can be opened from router state even when its company is not in
  // the currently loaded page. Resolve only that company and its relations.
  useEffect(() => {
    if (!unlocked || activeTab !== "profile" || !selectedCompanyId) return;

    let cancelled = false;
    void getDoc(doc(db, "frotas", selectedCompanyId))
      .then(async (companySnapshot) => {
        if (
          cancelled ||
          isAuthTeardownActive() ||
          !companySnapshot.exists()
        ) {
          return;
        }
        const company = {
          id: companySnapshot.id,
          ...companySnapshot.data(),
        };
        setAllCompanies((current) => mergeRecordsById(current, [company]));
        await hydrateCompanyRelations([company]);
      })
      .catch((error) => {
        if (!cancelled && !isAuthTeardownActive()) {
          console.warn(
            "[NVU Senior] Falha ao carregar empresa selecionada:",
            error,
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, hydrateCompanyRelations, selectedCompanyId, unlocked]);

  // Heavy operational collections are loaded only for the company profile
  // currently being inspected. This avoids downloading every contract, job,
  // vehicle and trailer merely by opening the senior dashboard.
  useEffect(() => {
    if (!unlocked || activeTab !== "profile" || !selectedCompanyId) {
      setAllContracts([]);
      setAllJobs([]);
      setAllVehicles([]);
      setAllTrailers([]);
      return;
    }

    let cancelled = false;
    const companyId = selectedCompanyId;
    const scopedQuery = (collectionName: string) =>
      query(
        collection(db, collectionName),
        where("companyId", "==", companyId),
      );

    void Promise.all([
      getDocs(scopedQuery("contratos")),
      getDocs(scopedQuery("trabalhos")),
      getDocs(scopedQuery("veiculos")),
      getDocs(scopedQuery("reboques")),
    ])
      .then(
        ([
          contractsSnapshot,
          jobsSnapshot,
          vehiclesSnapshot,
          trailersSnapshot,
        ]) => {
          if (cancelled || isAuthTeardownActive()) return;
          setAllContracts(
            contractsSnapshot.docs.map((document) => ({
              id: document.id,
              ...document.data(),
            })),
          );
          setAllJobs(
            jobsSnapshot.docs.map((document) => ({
              id: document.id,
              ...document.data(),
            })),
          );
          setAllVehicles(
            vehiclesSnapshot.docs.map((document) => ({
              id: document.id,
              ...document.data(),
            })),
          );
          setAllTrailers(
            trailersSnapshot.docs.map((document) => ({
              id: document.id,
              ...document.data(),
            })),
          );
        },
      )
      .catch((error) => {
        if (!cancelled && !isAuthTeardownActive()) {
          console.warn(
            "[NVU Senior] Falha ao carregar dados da empresa selecionada:",
            error,
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedCompanyId, unlocked]);

  const toDate = (value: any): Date | null => {
    if (!value) return null;
    if (typeof value?.toDate === "function") return value.toDate();
    if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const companyStats = useMemo(() => {
    return allCompanies.map((c) => {
      const members = allMembers.filter(
        (m) => m.companyId === c.id && m.status === "active",
      );
      const jobs = allJobs.filter((j) => j.companyId === c.id);
      
      const monthlyMetric = monthlyMetrics[String(c.id)];
      
      const owner = allUsers.find((u) => u.id === (c.ownerId || c.userId));

      return {
        ...c,
        ownerEmail: c.email || c.ownerEmail || owner?.email || "N/A",
        totalEmployees: members.length,
        totalDrivers: members.filter((m) => Array.isArray(m.roles) && m.roles.includes("driver")).length,
        totalAdmins: members.filter((m) => Array.isArray(m.roles) && m.roles.includes("admin")).length,
        totalContracts: allContracts.filter((ct) => ct.companyId === c.id)
          .length,
        totalOperations: jobs.length,
        monthlyTrips: monthlyDataReady && monthlyMetric ? monthlyMetric.tripCount : null,
        monthlyEarnings: monthlyDataReady && monthlyMetric ? monthlyMetric.earnings : null,
        totalDeliveries: jobs.reduce((acc, j) => acc + (j.progress || 0), 0),
        totalVehicles: allVehicles.filter((v) => v.companyId === c.id).length,
        totalTrailers: allTrailers.filter((t) => t.companyId === c.id).length,
      };
    });
  }, [
    allCompanies,
    allMembers,
    allContracts,
    allJobs,
    allVehicles,
    allTrailers,
    allUsers,
    monthlyMetrics,
    monthlyDataReady,
  ]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (seniorClaimConfirmed) {
      setIsSeniorAuthenticated(true);
      setUnlocked(true);
      setPassword("");
      return;
    }

    if (!password.trim() || authenticatingSenior) return;
    try {
      setAuthenticatingSenior(true);
      await authenticateSeniorAccess(password);
      setSeniorClaimConfirmed(true);
      setIsSeniorAuthenticated(true);
      setUnlocked(true);
      setPassword("");
      toast.success("Acesso Sênior confirmado com segurança.");
    } catch (error: any) {
      const code = String(error?.code || "");
      if (code.includes("resource-exhausted")) {
        toast.error("Muitas tentativas. Aguarde 30 minutos antes de tentar novamente.");
      } else if (code.includes("permission-denied")) {
        toast.error("Senha de acesso inválida.");
      } else {
        toast.error(error?.message || "Não foi possível validar o acesso Sênior.");
      }
    } finally {
      setAuthenticatingSenior(false);
    }
  };

  const handleApprove = async (reg: any) => {
    const regRef = doc(db, "recruitment_applications", reg.id);
    const actorId = auth.currentUser?.uid || "senior-panel";
    let claimOwned = false;
    let batchCommitted = false;
    try {
      setLoadingAction(true);
      // The Senior claim is refreshed and verified when the panel unlocks.
      // Refreshing the token again for every approval added avoidable network
      // latency and did not replace the transaction/rules authorization.
      const claim = await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(regRef);
        if (!snapshot.exists()) throw new Error("Solicitação não encontrada.");
        const current = snapshot.data() as Record<string, any>;
        if (current.status === "approved") return { alreadyApproved: true, data: current };
        if (current.status !== "pending") {
          throw new Error("Esta solicitação não está mais pendente.");
        }
        const lockOwner = String(current.approvalInProgressBy || "");
        const lockValue = current.approvalStartedAt;
        const lockMillis =
          typeof lockValue?.toMillis === "function"
            ? lockValue.toMillis()
            : Date.parse(String(lockValue || "")) || 0;
        if (
          lockOwner &&
          lockOwner !== actorId &&
          lockMillis > 0 &&
          Date.now() - lockMillis < 10 * 60 * 1000
        ) {
          throw new Error("Esta solicitação já está sendo processada por outro administrador.");
        }
        transaction.update(regRef, {
          approvalInProgressBy: actorId,
          approvalStartedAt: serverTimestamp(),
        });
        return { alreadyApproved: false, data: current };
      });

      if (claim.alreadyApproved) {
        toast.info("Esta empresa já foi aprovada anteriormente.");
        setShowApproveConfirm(null);
        closeRegistration();
        return;
      }
      claimOwned = true;
      const normalizedRegistration: any = normalizeRegistrationImages(
        await hydrateRegistrationImages({ ...claim.data, id: reg.id }),
      );
      const approvedCompanyLogo = normalizedRegistration.companyLogoURL;
      const approvedOwnerPhoto = normalizedRegistration.ownerPhotoUrl;
      const rawSimulatorValue = String(
        normalizedRegistration.simulatorId ||
          normalizedRegistration.simulatorName ||
          "",
      ).trim();
      const matchingSimulator = (Array.isArray(simulators) ? simulators : []).find(
        (simulator: any) =>
          String(simulator.id || "").toLowerCase() === rawSimulatorValue.toLowerCase() ||
          String(simulator.name || "").toLowerCase() === rawSimulatorValue.toLowerCase(),
      );
      const canonicalSimulatorId =
        matchingSimulator?.id || resolveSimulatorId(normalizedRegistration, simulators);
      const canonicalSimulatorDocument =
        matchingSimulator ||
        (Array.isArray(simulators) ? simulators : []).find(
          (simulator: any) =>
            String(simulator.id || "") === String(canonicalSimulatorId || ""),
        );
      const canonicalSimulatorName = String(
        canonicalSimulatorDocument?.name ||
          normalizedRegistration.simulatorName ||
          normalizedRegistration.simulator ||
          rawSimulatorValue ||
          "Simulador não informado",
      ).trim();
      const companyCreatedAt = new Date().toISOString();
      const registrationEmail = String(normalizedRegistration.email || "")
        .trim()
        .toLowerCase();

      const batch = writeBatch(db);
      const newCompanyRef = doc(collection(db, "frotas"));

      const companyPayload = {
        companyName: normalizedRegistration.companyName,
        ownerName: normalizedRegistration.ownerName,
        email: registrationEmail,
        ownerEmail: registrationEmail,
        simulatorId: canonicalSimulatorId,
        simulatorName: canonicalSimulatorName,
        cnpj: normalizedRegistration.cnpj,
        whatsapp: normalizedRegistration.whatsapp || "",
        userId: "",
        logoUrl: approvedCompanyLogo || "",
        ...(normalizedRegistration.companyLogoStoragePath && {
          logoStoragePath: normalizedRegistration.companyLogoStoragePath,
        }),
        ...(normalizedRegistration.ownerPhotoStoragePath && {
          ownerPhotoStoragePath: normalizedRegistration.ownerPhotoStoragePath,
        }),
        ownerPhotoUrl: approvedOwnerPhoto || "",
        status: "active",
        sourceRegistrationId: reg.id,
        approvedAt: companyCreatedAt,
        createdAt: companyCreatedAt,
      };

      let finalUserId = "";

      // 1. Use the submitted UID only when it belongs to the same e-mail.
      // Older forms could retain another account's UID while the visible
      // company data belonged to the new applicant; never bind approval to
      // that stale identity.
      const submittedUserId = String(normalizedRegistration.userId || "").trim();
      if (submittedUserId) {
        const submittedUserSnapshot = await readPrivateUser(submittedUserId);
        const submittedUserEmail = String(
          submittedUserSnapshot.data()?.email || "",
        )
          .trim()
          .toLowerCase();
        if (
          submittedUserSnapshot.exists() &&
          registrationEmail &&
          submittedUserEmail === registrationEmail
        ) {
          finalUserId = submittedUserId;
        }
      }

      if (finalUserId) {
        const userRef = doc(db, "users", finalUserId);

        batch.set(
          userRef,
          {
            companyId: newCompanyRef.id,
            role: "admin",
            roles: ["admin", "driver"],
            authProvisioningRequired:
              finalUserId !== auth.currentUser?.uid,
            ...(approvedOwnerPhoto && {
              profilePhotoURL: approvedOwnerPhoto,
            }),
            status: "active",
            applicationSubmitted: true,
            currentRecruitmentApplicationId: reg.id,
            currentRecruitmentStatus: "approved",
            currentRecruitmentType: "company_registration",
            currentRecruitmentSimulatorId: canonicalSimulatorId || "",
          },
          { merge: true },
        );

        const newMemberRef = doc(collection(db, "companyMembers"));
        batch.set(newMemberRef, {
          companyId: newCompanyRef.id,
          userId: finalUserId,
          roles: ["admin", "driver"],
          status: "active",
          permissions: ["admin", "owner", "manage_fleet", "all"],
          joinedAt: new Date().toISOString(),
        });
      }

      // 2. Fallback search by email if reg.userId was not set or didn't exist
      if (!finalUserId && registrationEmail) {
        const userQs = await queryPrivateUsers({ email: registrationEmail });

        if (!userQs.empty) {
          finalUserId = userQs.docs[0].id;
          const userRef = doc(db, "users", finalUserId);

          batch.update(userRef, {
            companyId: newCompanyRef.id,
            role: "admin",
            roles: ["admin", "driver"],
            ...(approvedOwnerPhoto && {
              profilePhotoURL: approvedOwnerPhoto,
            }),
            status: "active",
            applicationSubmitted: true,
            currentRecruitmentApplicationId: reg.id,
            currentRecruitmentStatus: "approved",
            currentRecruitmentType: "company_registration",
            currentRecruitmentSimulatorId: canonicalSimulatorId || "",
          });

          const newMemberRef = doc(collection(db, "companyMembers"));
          batch.set(newMemberRef, {
            companyId: newCompanyRef.id,
            userId: finalUserId,
            roles: ["admin", "driver"],
            status: "active",
            permissions: ["admin", "owner", "manage_fleet", "all"],
            joinedAt: new Date().toISOString(),
          });
        } else {
          const newUserRef = doc(collection(db, "users"));
          finalUserId = newUserRef.id;

          batch.set(newUserRef, {
            email: registrationEmail,
            name: normalizedRegistration.ownerName,
            status: "active",
            companyId: newCompanyRef.id,
            role: "admin",
            roles: ["admin", "driver"],
            profilePhotoURL: approvedOwnerPhoto || "",
            // A Firestore user document is not a Firebase Auth account. Keep
            // this explicit so the provisioning flow can create/send access
            // credentials instead of silently leaving an unreachable user.
            authProvisioningRequired: true,
            applicationSubmitted: true,
            currentRecruitmentApplicationId: reg.id,
            currentRecruitmentStatus: "approved",
            currentRecruitmentType: "company_registration",
            currentRecruitmentSimulatorId: canonicalSimulatorId || "",
            createdAt: new Date().toISOString(),
          });

          const newMemberRef = doc(collection(db, "companyMembers"));
          batch.set(newMemberRef, {
            companyId: newCompanyRef.id,
            userId: finalUserId,
            roles: ["admin", "driver"],
            status: "active",
            permissions: ["admin", "owner", "manage_fleet", "all"],
            joinedAt: new Date().toISOString(),
          });
        }
      }

      // 3. Absolute fallback to ensure finalUserId is never empty
      if (!finalUserId) {
        const newUserRef = doc(collection(db, "users"));
        finalUserId = newUserRef.id;

        batch.set(newUserRef, {
          email: registrationEmail,
          name: normalizedRegistration.ownerName || "Proprietário",
          status: "active",
          companyId: newCompanyRef.id,
          role: "admin",
          roles: ["admin", "driver"],
          profilePhotoURL: approvedOwnerPhoto || "",
          authProvisioningRequired: true,
          applicationSubmitted: true,
          currentRecruitmentApplicationId: reg.id,
          currentRecruitmentStatus: "approved",
          currentRecruitmentType: "company_registration",
          currentRecruitmentSimulatorId: canonicalSimulatorId || "",
          createdAt: new Date().toISOString(),
        });

        const newMemberRef = doc(collection(db, "companyMembers"));
        batch.set(newMemberRef, {
          companyId: newCompanyRef.id,
          userId: finalUserId,
          roles: ["admin", "driver"],
          status: "active",
          permissions: ["admin", "owner", "manage_fleet", "all"],
          joinedAt: new Date().toISOString(),
        });
      }

      // 4. Record ownerId and userId on company payload and save
      const finalCompanyPayload = {
        ...companyPayload,
        userId: finalUserId,
        ownerId: finalUserId,
      };
      batch.set(newCompanyRef, finalCompanyPayload);

      batch.update(regRef, {
        status: "approved",
        approvedCompanyId: newCompanyRef.id,
        approvedUserId: finalUserId,
        userId: finalUserId,
        approvedAt: serverTimestamp(),
        approvedBy: actorId,
        companyLogoURL: approvedCompanyLogo || "",
        ownerPhotoUrl: approvedOwnerPhoto || "",
        companyLogoStoragePath:
          normalizedRegistration.companyLogoStoragePath || "",
        ownerPhotoStoragePath:
          normalizedRegistration.ownerPhotoStoragePath || "",
        ownerPhotoPropagated: Boolean(approvedOwnerPhoto),
        logoPropagated: Boolean(approvedCompanyLogo),
        approvalInProgressBy: deleteField(),
        approvalStartedAt: deleteField(),
      });

      await batch.commit();
      batchCommitted = true;

      // Confirma a publicação imediatamente. Os gatilhos de Firestore usam o
      // mesmo ID determinístico, então esta chamada é idempotente e também
      // funciona como recuperação caso um gatilho tenha sofrido atraso.
      try {
        const syncApprovalNews = httpsCallable<
          { registrationId: string; companyId: string },
          { success: boolean; created: number; updated: number; ignored: number }
        >(functions, "syncCompanyApprovalNews");
        await syncApprovalNews({
          registrationId: reg.id,
          companyId: newCompanyRef.id,
        });
      } catch (newsSyncError) {
        // A empresa já está aprovada. A reconciliação automática ao abrir a
        // NVU News tentará novamente sem desfazer o fluxo administrativo.
        console.warn(
          "[SeniorPanel] Empresa aprovada; o post da NVU News será reconciliado em seguida:",
          newsSyncError,
        );
      }

      // The large administrative collections are no longer watched globally.
      // Reconcile the successful approval locally and hydrate only the new
      // owner/member records instead of reloading the entire catalog.
      setAllCompanies((current) => [
        ...current.filter((company) => company.id !== newCompanyRef.id),
        { id: newCompanyRef.id, ...finalCompanyPayload },
      ]);
      setCompaniesTotalCount((current) =>
        typeof current === "number" ? current + 1 : current,
      );
      setRegistrations((current) =>
        current.map((registration) =>
          registration.id === reg.id
            ? {
                ...registration,
                status: "approved",
                approvedCompanyId: newCompanyRef.id,
                approvedUserId: finalUserId,
              }
            : registration,
        ),
      );

      try {
        const [approvedUserSnapshot, approvedMembersSnapshot] =
          await Promise.all([
            readPrivateUser(finalUserId),
            getDocs(
              query(
                collection(db, "companyMembers"),
                where("companyId", "==", newCompanyRef.id),
              ),
            ),
          ]);

        if (approvedUserSnapshot.exists()) {
          setAllUsers((current) => [
            ...current.filter((user) => user.id !== approvedUserSnapshot.id),
            { id: approvedUserSnapshot.id, ...approvedUserSnapshot.data() },
          ]);
        }

        const approvedMembers = approvedMembersSnapshot.docs.map(
          (memberDocument) => ({
            id: memberDocument.id,
            ...memberDocument.data(),
          }),
        );
        setAllMembers((current) => [
          ...current.filter(
            (member) => member.companyId !== newCompanyRef.id,
          ),
          ...approvedMembers,
        ]);
      } catch (catalogRefreshError) {
        console.warn(
          "[SeniorPanel] Aprovação concluída; falha apenas ao atualizar o catálogo local:",
          catalogRefreshError,
        );
      }

      if (finalUserId) {
        try {
          await createNotification({
            userId: finalUserId,
            companyId: newCompanyRef.id,
            targetProfile: "corporate",
            type: "COMPANY_APPROVED",
            title: "Empresa Aprovada",
            message: "Parabéns! Sua empresa foi aprovada e ativada na NVU.",
            dedupeKey: `COMPANY_APPROVED_${reg.id}`,
          });
        } catch (notificationError) {
          // A aprovação já foi concluída. Falha de aviso não pode desfazer a
          // empresa nem deixar o painel preso em estado de erro.
          console.warn(
            "[SeniorPanel] Empresa aprovada, mas a notificação falhou:",
            notificationError,
          );
        }

        await syncSingleSimulatorMember(
          finalUserId, 
          newCompanyRef.id, 
          "active", 
          ["admin", "driver"], 
          canonicalSimulatorId
        );
      }

      toast.success("Empresa aprovada com sucesso!");
      setShowApproveConfirm(null);
      closeRegistration();
    } catch (e: any) {
      if (claimOwned && !batchCommitted) {
        try {
          await updateDoc(regRef, {
            approvalInProgressBy: deleteField(),
            approvalStartedAt: deleteField(),
          });
        } catch (unlockError) {
          console.warn("Não foi possível liberar o bloqueio da aprovação:", unlockError);
        }
      }
      console.error(e);
      toast.error("Erro ao aprovar: " + e.message);
    } finally {
      setLoadingAction(false);
    }
  };

  const handleReject = async (id: string) => {
    try {
      setLoadingAction(true);
      const regRef = doc(db, "recruitment_applications", id);
      const rejectedRegistration = (await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(regRef);
        if (!snapshot.exists()) throw new Error("Solicitação não encontrada.");
        const current = snapshot.data() as Record<string, any>;
        if (current.status === "approved") {
          throw new Error("Esta solicitação já foi aprovada e não pode ser recusada.");
        }
        transaction.update(regRef, {
          status: "rejected",
          rejectionReason,
          updatedAt: new Date().toISOString(),
        });
        return { id: snapshot.id, ...current };
      })) as Record<string, any> & { id: string };
      const batch = writeBatch(db);
      const reg = rejectedRegistration;

      const registrationEmail = String(reg?.email || "").trim().toLowerCase();
      const submittedUserId = String(reg?.userId || "").trim();
      let rejectedUserId = "";

      // Use the submitted UID only when it still belongs to the same e-mail.
      // This prevents a stale UID from a shared device from receiving another
      // company's rejection state.
      if (submittedUserId) {
        const submittedUserSnapshot = await readPrivateUser(submittedUserId);
        const submittedUserEmail = String(
          submittedUserSnapshot.data()?.email || "",
        )
          .trim()
          .toLowerCase();

        if (
          submittedUserSnapshot.exists() &&
          registrationEmail &&
          submittedUserEmail === registrationEmail
        ) {
          rejectedUserId = submittedUserId;
        }
      }

      // Company registration can be sent before authentication. If the owner
      // has already logged in, bind the result to the account by e-mail so the
      // next login reflects the rejection immediately.
      if (!rejectedUserId && registrationEmail) {
        const userSnapshot = await queryPrivateUsers({ email: registrationEmail });
        if (!userSnapshot.empty) {
          rejectedUserId = userSnapshot.docs[0].id;
        }
      }

      if (rejectedUserId) {
        batch.update(regRef, { userId: rejectedUserId });
        batch.set(
          doc(db, "users", rejectedUserId),
          {
            applicationSubmitted: true,
            currentRecruitmentApplicationId: id,
            currentRecruitmentStatus: "rejected",
            currentRecruitmentType: "company_registration",
            currentRecruitmentSimulatorId: String(reg?.simulatorId || ""),
          },
          { merge: true },
        );
      }

      await batch.commit();
      setRegistrations((current) =>
        current.map((registration) =>
          registration.id === id
            ? {
                ...registration,
                status: "rejected",
                rejectionReason,
                ...(rejectedUserId && { userId: rejectedUserId }),
              }
            : registration,
        ),
      );

      if (rejectedUserId) {
        try {
          await createNotification({
            userId: rejectedUserId,
            targetProfile: "corporate",
            type: "COMPANY_REJECTED",
            title: "Solicitação Recusada",
            message:
              "Sua solicitação de empresa foi recusada. Consulte os detalhes enviados pela administração.",
            dedupeKey: `COMPANY_REJECTED_${id}`,
          });
        } catch (notificationError) {
          console.warn(
            "[SeniorPanel] Solicitação recusada, mas a notificação falhou:",
            notificationError,
          );
        }
      }

      toast.success("Solicitação recusada.");
      setShowRejectConfirm(null);
      setRejectionReason("");
      closeRegistration();
    } catch (e: any) {
      toast.error("Erro ao recusar: " + e.message);
    } finally {
      setLoadingAction(false);
    }
  };

  const handleDeleteCompany = async (id: string) => {
    try {
      setLoadingAction(true);

      await deleteCompanyCanonical(id);
      memberRelationsRevisionRef.current += 1;
      companyCatalogVersionRef.current += 1;
      companyPageRequestRef.current = false;
      setLoadingCompanies(false);

      setAllCompanies((current) =>
        current.filter((company) => company.id !== id),
      );
      setCompaniesTotalCount((current) =>
        typeof current === "number" ? Math.max(0, current - 1) : current,
      );
      setAllMembers((current) =>
        current.filter((member) => member.companyId !== id),
      );
      setAllUsers((current) =>
        current.map((user) =>
          user.companyId === id
            ? { ...user, companyId: null, role: null, roles: [] }
            : user,
        ),
      );
      setAllContracts((current) =>
        current.filter((contract) => contract.companyId !== id),
      );
      setAllJobs((current) =>
        current.filter((job) => job.companyId !== id),
      );
      setAllVehicles((current) =>
        current.filter((vehicle) => vehicle.companyId !== id),
      );
      setAllTrailers((current) =>
        current.filter((trailer) => trailer.companyId !== id),
      );

      toast.success("Empresa removida com sucesso do sistema.");
      if (selectedCompanyId === id) {
        selectSeniorTab("approved", null);
      }
      setConfirmDeleteId(null);
    } catch (e: any) {
      toast.error("Erro ao remover: " + e.message);
    } finally {
      setLoadingAction(false);
    }
  };

  const handleDeleteRegistration = async (id: string) => {
    try {
      setLoadingAction(true);
      await deleteDoc(doc(db, "recruitment_applications", id));
      setRegistrations((current) =>
        current.filter((registration) => registration.id !== id),
      );
      toast.success("Solicitação removida com sucesso.");
      setConfirmDeleteRegId(null);
      if (selectedRegistrationId === id) {
        closeRegistration();
      }
    } catch (e: any) {
      toast.error("Erro ao remover solicitação: " + e.message);
    } finally {
      setLoadingAction(false);
    }
  };

  const viewCompanyDashboard = (company: any) => {
    const companyId = String(company?.id || "").trim();
    if (!companyId) {
      toast.error("Não foi possível identificar a empresa selecionada.");
      return;
    }

    // The Senior list already owns the exact company document that was
    // selected. Hand it to the shared CompanyContext before navigating so the
    // destination can paint immediately instead of depending on a second
    // Firestore read during the route transition.
    primeCompanyProfile(company);

    // Preserve the user's operational workspace before entering a company via
    // Senior mode. This origin is written only once so moving through Senior
    // views can never replace it with the company being inspected.
    const storedOriginCompanyId = sessionStorage.getItem(
      "seniorOriginCompanyId",
    );
    const activeMemberships = memberships.filter(
      (membership) => membership.status === "active",
    );
    const ownCompanyIds = new Set(
      activeMemberships
        .map((membership) => String(membership.companyId || "").trim())
        .filter(Boolean),
    );
    const activeOriginCompanyId = String(activeCompanyId || "").trim();
    const primaryCompanyId = String(currentUser?.companyId || "").trim();
    const originCompanyId =
      (activeOriginCompanyId && ownCompanyIds.has(activeOriginCompanyId)
        ? activeOriginCompanyId
        : "") ||
      (primaryCompanyId && ownCompanyIds.has(primaryCompanyId)
        ? primaryCompanyId
        : "") ||
      String(activeMemberships[0]?.companyId || "").trim();

    if (!storedOriginCompanyId && originCompanyId && originCompanyId !== companyId) {
      sessionStorage.setItem("seniorOriginCompanyId", originCompanyId);
      sessionStorage.setItem(
        "seniorOriginRole",
        activeRole === "driver" ? "driver" : "admin",
      );
    }

    sessionStorage.setItem("seniorAccess", "true");
    sessionStorage.setItem("seniorCompanyId", companyId);
    setSeniorCompanyId(companyId);
    setActiveCompanyId(companyId);
    void switchRole("admin", companyId);
    navigate("/admin/fleet", {
      state: {
        activeTab: "operations",
      },
    });
  };

  if (!unlocked || catalogViewer !== currentUid) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] p-4">
        <Card className="w-full max-w-sm rounded-[24px] overflow-hidden border border-gray-100 dark:border-nvu-line bg-white dark:bg-nvu-surface shadow-xl dark:shadow-none">
          <CardContent className="p-8">
            <h2 className="text-xl font-bold text-gray-900 dark:text-nvu-text mb-2 text-center">
              Painel Senior
            </h2>
            <p className="text-[13px] text-gray-500 dark:text-nvu-muted mb-6 text-center">
              Informe a senha de acesso do painel.
            </p>
            <form onSubmit={handleLogin} className="space-y-4">
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Senha de acesso"
                autoComplete="current-password"
                disabled={authenticatingSenior}
                className="w-full h-11 rounded-xl border border-slate-200 dark:border-nvu-line bg-white dark:bg-nvu-page px-3 text-center text-sm text-slate-900 dark:text-white outline-none focus:border-blue-500"
              />
              <Button
                type="submit"
                disabled={authenticatingSenior || !password.trim()}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl h-11"
              >
                {authenticatingSenior ? "Validando acesso..." : "Entrar no painel"}
              </Button>
            </form>
          </CardContent>
        </Card>
    </div>
    );
  }

  const selectedCompany = selectedCompanyId
    ? companyStats.find((c) => c.id === selectedCompanyId)
    : null;

  const pendingRequests = registrations.filter((r) => r.status === "pending");
  const rejectedRequests = registrations.filter((r) => r.status === "rejected");
  const activeCompanies = companyStats.filter(isActiveCompanyRecord);
  const activeCompaniesCount = companiesTotalCount ?? activeCompanies.length;
  const getSimulatorDisplayLabel = (company: any) =>
    resolveSimulatorDisplayLabel(
      company,
      simulators as any[],
      allCompanies as any[],
    ) || company?.simulatorName || company?.simulatorId || "Não informado";

  const activeSimulatorOptions: Array<{ id: string; name: string }> =
    buildSimulatorSelectorOptions(
      Array.isArray(simulators) ? simulators : [],
      [...activeCompanies, ...registrations],
    ).map(({ value, label }) => ({ id: value, name: label }));

  const selectedSimulatorLabel =
    selectedSimulator === "all"
      ? "Todos os simuladores"
      : activeSimulatorOptions.find((option) => option.id === selectedSimulator)?.name ||
        "Todos os simuladores";

  const filteredCompanies = activeCompanies.filter((company) => {
    const queryValue = companySearch.trim().toLocaleLowerCase("pt-BR");
    const matchesSearch =
      !queryValue ||
      [company.companyName, company.ownerName, company.ownerEmail, company.simulatorName]
        .some((value) => String(value || "").toLocaleLowerCase("pt-BR").includes(queryValue));
    const companySimulator = resolveSimulatorId(
      company,
      simulators as any[],
      allCompanies as any[],
    );
    const matchesSimulator =
      selectedSimulator === "all" || companySimulator === selectedSimulator;
    return matchesSearch && matchesSimulator;
  });

  const filteredRegistrations = registrations.filter(reg => {
    if (reg.status !== "pending" && reg.status !== "rejected") return false;
    const search = companySearch.trim().toLocaleLowerCase("pt-BR");
    const matchesSearch = !search || [reg.companyName, reg.ownerName, reg.email, reg.cnpj].some(value => String(value || "").toLocaleLowerCase("pt-BR").includes(search));
    return matchesSearch && (selectedSimulator === "all" || resolveSimulatorId(reg, simulators as any[], allCompanies) === selectedSimulator);
  }).sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || (registrationSubmittedDate(b)?.getTime() || 0) - (registrationSubmittedDate(a)?.getTime() || 0));

  return (
    <div className="nvu-senior-page max-w-[1000px] mx-auto px-3 sm:px-5 lg:px-6 pt-1 sm:pt-2 pb-6 space-y-2.5 sm:space-y-4">
      {/* Corporate Banner Header */}
      <div className="relative overflow-hidden bg-white/70 dark:bg-nvu-surface/70 backdrop-blur-xl border border-slate-200/60 dark:border-nvu-line/60 rounded-[18px] sm:rounded-[22px] px-5 sm:px-8 py-5 sm:py-6 shadow-[0_4px_24px_-12px_rgba(0,0,0,0.1)] dark:shadow-[0_4px_24px_-12px_rgba(0,0,0,0.5)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50/50 to-slate-100/30 dark:from-white/[0.02] dark:to-transparent pointer-events-none" />
        
        <div className="absolute top-4 right-4 sm:top-5 sm:right-5 z-20">
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 sm:p-2.5 rounded-full bg-white/80 dark:bg-nvu-surface/80 border border-slate-200/80 dark:border-nvu-line/80 text-slate-700 dark:text-nvu-text-soft hover:bg-slate-50 dark:hover:bg-nvu-strip transition-colors shadow-sm"
            aria-label="Configurações"
          >
            <Settings size={18} />
          </button>
        </div>
        
        <div className="relative z-10 flex-1 min-w-0 pr-12">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-100/80 dark:bg-nvu-surface/80 backdrop-blur-md border border-slate-200/80 dark:border-nvu-line/80 rounded-md mb-2.5 shadow-sm">
            <ShieldCheck size={12} className="text-slate-600 dark:text-nvu-text-soft" />
            <span className="text-[9px] font-bold text-slate-600 dark:text-nvu-text-soft uppercase tracking-widest">ADMINISTRAÇÃO</span>
          </div>
          <h1 className="text-[20px] sm:text-[24px] font-semibold text-slate-900 dark:text-white leading-tight tracking-tight mb-0.5">
            Painel Sênior NVU
          </h1>
          <p className="nvu-page-description text-slate-500 dark:text-nvu-muted mt-1">
            Gestão suprema de empresas parceiras
          </p>
        </div>

        <div className="absolute right-0 top-0 bottom-0 w-1/2 sm:w-1/3 opacity-[0.03] dark:opacity-[0.07] pointer-events-none flex items-center justify-end pr-4 sm:pr-8">
          <ShieldCheck size={120} className="text-slate-900 dark:text-white translate-x-1/4 sm:translate-x-0" strokeWidth={1} />
        </div>
      </div>

      <div className="nvu-senior-summary" role="group" aria-label="Resumo de empresas">
        <button type="button" onClick={() => selectSeniorTab("requests")} aria-pressed={activeTab === "requests"}>
          <span className="nvu-senior-summary-icon"><Activity size={21} /></span><span><span>Pendentes</span><strong>{pendingRequests.length}</strong></span>
        </button>
        <button type="button" onClick={() => selectSeniorTab("approved")} aria-pressed={activeTab === "approved"}>
          <span className="nvu-senior-summary-icon"><Building2 size={21} /></span><span><span>Empresas ativas</span><strong>{activeCompaniesCount}</strong></span>
        </button>
      </div>
      <div className="nvu-senior-toolbar">
        <label className="nvu-senior-search"><Search size={18} /><input aria-label="Buscar empresas" value={companySearch} onChange={event => setCompanySearch(event.target.value)} placeholder="Buscar empresas..." /></label>
        <button type="button" className="nvu-senior-simulator" onClick={() => setSimulatorMenuOpen(value => !value)} aria-label="Selecionar simulador" aria-expanded={simulatorMenuOpen}><Gamepad2 size={18} /><span>{selectedSimulatorLabel}</span><ChevronDown size={15} /></button>
        {simulatorMenuOpen && <div className="nvu-senior-simulator-menu">{[{id:"all",name:"Todos os simuladores"},...activeSimulatorOptions].map(option => <button key={option.id} type="button" onClick={() => {setSelectedSimulator(option.id);setSimulatorMenuOpen(false);}} aria-pressed={selectedSimulator === option.id}><span>{option.name}</span>{selectedSimulator === option.id && <CheckCircle2 size={16}/>}</button>)}</div>}
      </div>

      {activeTab === "settings" && (
        <div className="space-y-6 animate-in fade-in duration-300">
          <Card className="rounded-[24px] overflow-hidden border border-gray-100 dark:border-nvu-line bg-white dark:bg-nvu-surface shadow-sm dark:shadow-none">
            <CardContent className="p-8 space-y-6">
              <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-nvu-text flex items-center gap-2 mb-2">
                  Integrações de Sistema
                </h2>
                <p className="text-sm text-gray-500 dark:text-nvu-muted max-w-2xl">
                  Configure os serviços externos e integrações que a plataforma
                  NVU utiliza para operar. Estas configurações são globais.
                </p>
    </div>

              <div className="bg-gray-50 dark:bg-nvu-page border border-gray-100 dark:border-nvu-line rounded-2xl p-6 flex flex-col gap-6 justify-between items-start">
                <div className="w-full flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-nvu-line bg-white dark:bg-nvu-page/40 p-4">
                  <div>
                    <h3 className="font-bold text-gray-900 dark:text-white text-[16px]">Controle de envio de viagens</h3>
                    <p className="text-sm text-gray-500 dark:text-nvu-muted">Gerencie a liberação de novas viagens por modo e simulador.</p>
                  </div>
                  <Button type="button" onClick={() => setIsWorkModeAvailabilityOpen(true)} className="h-10 rounded-xl">Gerenciar controle de envio</Button>
                </div>
                <div className="space-y-2">
                  <h3 className="font-bold text-gray-900 dark:text-white text-[16px] flex items-center gap-2">
                    Armazenamento de Arquivos
                    <span className="bg-green-100 text-green-700 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full tracking-wider">
                      Storage Ativo
                    </span>
                  </h3>
                  <p className="text-sm text-gray-500 max-w-lg leading-relaxed">
                    O sistema está configurado de forma nativa e segura para
                    utilizar o Firebase Storage como servidor de mídias e
                    comprovantes, organizando os arquivos automaticamente por
                    empresa.
                  </p>
    </div>
    </div>
            </CardContent>
          </Card>
    </div>
      )}

      {activeTab === "profile" && selectedCompany && (
        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
          <Button
            onClick={() => selectSeniorTab("approved")}
            variant="outline"
            className="h-10 px-4 rounded-xl shadow-sm border-gray-200 dark:border-nvu-line bg-white dark:bg-nvu-surface"
          >
            <ChevronLeft size={18} className="mr-2" /> Voltar para Lista
          </Button>

          <Card className="rounded-[24px] overflow-hidden border border-gray-100 dark:border-nvu-line bg-white dark:bg-nvu-surface shadow-sm dark:shadow-none">
            <CardContent className="p-8">
              <div className="flex items-center gap-6 mb-8">
                <div className="w-20 h-20 bg-blue-50 dark:bg-nvu-strip rounded-2xl flex items-center justify-center shrink-0 overflow-hidden border border-gray-100 dark:border-nvu-line">
                  {selectedCompany.logoUrl ? (
                    <CachedImage
                      src={selectedCompany.logoUrl}
                      alt="Logo"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Building2 className="text-blue-500" size={32} />
                  )}
    </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-nvu-text flex items-center gap-2">
                    {selectedCompany.companyName}
                    <span className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-400 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full tracking-wider mt-1">
                      Status Ativo
                    </span>
                  </h2>
                  <div className="flex items-center gap-4 mt-2 text-sm text-gray-500 dark:text-nvu-muted">
                    <span className="flex items-center gap-1.5">
                      <Gamepad2 size={16} /> {getSimulatorDisplayLabel(selectedCompany)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Users size={16} /> Responsável pela empresa: {selectedCompany.ownerName || "Não informado"}
                    </span>
    </div>
    </div>
    </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gray-50 dark:bg-nvu-page p-4 rounded-2xl border border-gray-100 dark:border-nvu-line">
                  <p className="text-gray-500 dark:text-nvu-muted text-[13px] font-medium flex items-center gap-2">
                    <Users size={14} className="text-blue-500" /> Equipe
                    Registrada
                  </p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                    {selectedCompany.totalEmployees}
                  </p>
    </div>
                <div className="bg-gray-50 dark:bg-nvu-page p-4 rounded-2xl border border-gray-100 dark:border-nvu-line">
                  <p className="text-gray-500 dark:text-nvu-muted text-[13px] font-medium flex items-center gap-2">
                    <Navigation size={14} className="text-green-500" /> Operações
                    Carregadas
                  </p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                    {selectedCompany.totalOperations}
                  </p>
    </div>
                <div className="bg-gray-50 dark:bg-nvu-page p-4 rounded-2xl border border-gray-100 dark:border-nvu-line">
                  <p className="text-gray-500 dark:text-nvu-muted text-[13px] font-medium flex items-center gap-2">
                    <FileText size={14} className="text-purple-500" /> Total
                    Contratos
                  </p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                    {selectedCompany.totalContracts}
                  </p>
    </div>
                <div className="bg-gray-50 dark:bg-nvu-page p-4 rounded-2xl border border-gray-100 dark:border-nvu-line">
                  <p className="text-gray-500 dark:text-nvu-muted text-[13px] font-medium flex items-center gap-2">
                    <Truck size={14} className="text-orange-500" /> Veículos na
                    Frota
                  </p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                    {selectedCompany.totalVehicles}
                  </p>
    </div>
    </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-10">
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase px-1 border-b border-gray-100 dark:border-nvu-line pb-2">
                    Informações Fiscais
                  </h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-sm px-1">
                      <span className="text-gray-500 dark:text-nvu-muted">
                        CNPJ
                      </span>
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {selectedCompany.cnpj}
                      </span>
    </div>
                    <div className="flex justify-between items-center text-sm px-1">
                      <span className="text-gray-500 dark:text-nvu-muted">
                        Data de Cadastro
                      </span>
                      <span className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        {new Date(selectedCompany.createdAt).toLocaleDateString(
                          "pt-BR",
                        )}
                      </span>
    </div>
                    <div className="flex justify-between items-center text-sm px-1">
                      <span className="text-gray-500 dark:text-nvu-muted">
                        Proprietário (ID)
                      </span>
                      <span className="font-semibold text-gray-900 dark:text-white text-[11px] font-mono">
                        {selectedCompany.userId || "N/A"}
                      </span>
    </div>
    </div>
    </div>
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase px-1 border-b border-gray-100 dark:border-nvu-line pb-2">
                    Métricas de Frota e Staff
                  </h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-sm px-1">
                      <span className="text-gray-500 dark:text-nvu-muted">
                        Volume Transportado
                      </span>
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {selectedCompany.totalDeliveries}{" "}
                        <span className="text-[11px] text-gray-400">unids</span>
                      </span>
    </div>
                    <div className="flex justify-between items-center text-sm px-1">
                      <span className="text-gray-500 dark:text-nvu-muted">
                        Administradores
                      </span>
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {selectedCompany.totalAdmins}
                      </span>
    </div>
                    <div className="flex justify-between items-center text-sm px-1">
                      <span className="text-gray-500 dark:text-nvu-muted">
                        Motoristas Qualificados
                      </span>
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {selectedCompany.totalDrivers}
                      </span>
    </div>
    </div>
    </div>
    </div>

              <div className="mt-10 space-y-4">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase px-1 border-b border-gray-100 dark:border-nvu-line pb-2">
                  Membros / Motoristas da Empresa
                </h3>
                <div className="space-y-3">
                  {(() => {
                    const companyMembers = uniqueCompanyMembers(allMembers, selectedCompany.id);
                    if (companyMembers.length === 0) {
                      return <p className="text-[13px] text-gray-500 dark:text-nvu-muted px-1">Nenhum membro encontrado na base.</p>;
                    }
                    return companyMembers.map(member => {
                      const user = allUsers.find(u => u.id === member.userId);
                      const name = user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "Usuário Desconhecido";
                      return (
                        <div key={member.id} className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between bg-gray-50 dark:bg-nvu-page p-3 rounded-xl border border-gray-100 dark:border-nvu-line">
                          <div>
                            <p className="text-[13px] font-bold text-gray-900 dark:text-white">{name}</p>
                            <p className="text-[11px] text-gray-500 dark:text-nvu-muted font-mono mt-0.5">{user?.email || "Sem e-mail"} • ID: {member.userId}</p>
    </div>
                          <div className="flex flex-col items-end gap-2 w-full sm:w-auto">
                            <SeniorMemberActions
                              member={member}
                              user={user}
                              companyId={selectedCompany.id}
                              companyName={selectedCompany.companyName}
                              onUpdated={(patch) => {
                                setAllUsers((current) => current.map((item) => item.id === member.userId ? { ...item, ...patch } : item));
                                if (patch.removedFromFleet) { memberRelationsRevisionRef.current += 1; setAllMembers((current) => current.filter((item) => !(item.companyId === member.companyId && item.userId === member.userId))); }
                              }}
                            />
                            <Button 
                              variant="danger" 
                              className="h-8 text-[11px] px-4 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-900/50 border-0 shadow-none w-full sm:w-auto"
                              disabled={removingMemberId === member.userId}
                              onClick={async () => {
                                if (removingMemberId) return;
                                if(window.confirm(`ATENÇÃO SENIOR: Tem certeza que deseja remover definitivamente o motorista ${name} desta empresa? Essa ação revogará todo o acesso dele.`)) {
                                  setRemovingMemberId(member.userId);
                                  try { await removeDriverFromFleet(member.userId, selectedCompany.id); memberRelationsRevisionRef.current += 1; setAllMembers(current => current.filter(item => !(item.companyId === selectedCompany.id && item.userId === member.userId))); } catch { /* AppContext reports the precise error. */ } finally { setRemovingMemberId(null); }
                                }
                              }}
                            >
                              {removingMemberId === member.userId ? "Removendo..." : "Remover Acesso"}
                            </Button>
                          </div>
    </div>
                      );
                    });
                  })()}
    </div>
    </div>
            </CardContent>
          </Card>
    </div>
      )}

      {activeTab === "requests" && <SeniorRegistrationList registrations={filteredRegistrations} listKey={`${companySearch}:${selectedSimulator}`} simulatorLabel={getSimulatorDisplayLabel} onOpen={openRegistration} onDelete={setConfirmDeleteRegId} />}

      {activeTab === "approved" && (
        <div className="space-y-3 animate-in fade-in duration-300">
          {monthlyMetricsState === "error" && (
            <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              Não foi possível carregar as métricas mensais protegidas. A consulta será tentada novamente ao reconectar ou voltar ao aplicativo.
            </p>
          )}
          {loadingCompanies && allCompanies.length === 0 ? (
            <div className="bg-white dark:bg-nvu-surface border border-slate-100 dark:border-nvu-line rounded-[24px] p-10 text-center shadow-sm">
              <Building2 size={44} className="mx-auto text-slate-300 dark:text-slate-700 mb-3 animate-pulse" />
              <p className="text-slate-500 font-medium">Carregando empresas...</p>
            </div>
          ) : filteredCompanies.length === 0 ? (
            <div className="bg-white dark:bg-nvu-surface border border-slate-100 dark:border-nvu-line rounded-[24px] p-10 text-center shadow-sm">
              <Building2 size={44} className="mx-auto text-slate-300 dark:text-slate-700 mb-3" />
              <p className="text-slate-500 font-medium">Nenhuma empresa encontrada para este filtro.</p>
    </div>
          ) : (
            filteredCompanies.map((company) => {
              const staffMembers = uniqueCompanyMembers(allMembers, company.id);
              const companyOwnerId = String(company.ownerId || company.userId || "");
              const isStaffExpanded = expandedStaffCompanyId === company.id;
              // A tela inicial do Painel Sênior exibe somente viagens realizadas no mês.
              // Ganhos permanecem fora desta projeção resumida.
              const monthlyMetric = monthlyDataReady ? monthlyMetrics[String(company.id)] : null;
              const monthlyMetricLabel = monthlyMetric ? String(monthlyMetric.tripCount) : monthlyMetricsState === "loading" ? "…" : "—";
              return (
              <article
                key={company.id}
                className="bg-white/95 dark:bg-nvu-surface/95 border border-slate-100 dark:border-nvu-line rounded-[20px] sm:rounded-[22px] px-3 py-3 sm:p-5 shadow-[0_10px_35px_-26px_rgba(15,23,42,0.55)] overflow-hidden"
              >
                <div className="grid grid-cols-[minmax(0,1.28fr)_minmax(128px,.72fr)] sm:grid-cols-[minmax(0,1fr)_300px] gap-2.5 sm:gap-5 items-stretch">
                  <div className="flex gap-2.5 sm:gap-4 min-w-0">
                    <div className="w-12 h-12 sm:w-[76px] sm:h-[76px] rounded-[14px] sm:rounded-[18px] bg-slate-100 dark:bg-nvu-surface overflow-hidden flex items-center justify-center shrink-0 border border-slate-100 dark:border-nvu-line">
                      {company.logoUrl ? (
                        <CachedImage src={company.logoUrl} alt={`Logo de ${company.companyName}`} className="w-full h-full object-cover" />
                      ) : (
                        <Building2 size={22} className="text-slate-400" />
                      )}
    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-bold text-[14px] sm:text-[19px] text-slate-950 dark:text-white leading-[1.15] truncate">{company.companyName}</h3>
                      <div className="mt-1.5 sm:mt-2 space-y-1 sm:space-y-2 text-[10.5px] sm:text-[13px] leading-tight text-slate-500 dark:text-nvu-muted">
                        <p className="flex items-center gap-1.5 sm:gap-2 min-w-0"><Gamepad2 size={13} className="shrink-0" /><span className="truncate">{getSimulatorDisplayLabel(company)}</span></p>
                        <p className="flex items-center gap-1.5 sm:gap-2 min-w-0"><Users size={13} className="shrink-0" /><span className="truncate">{company.ownerName || "Proprietário não informado"}</span></p>
                        <p className="flex items-center gap-1.5 sm:gap-2 min-w-0"><FileText size={13} className="shrink-0" /><span className="truncate">{company.ownerEmail || "E-mail não informado"}</span></p>
    </div>
    </div>
    </div>

                  <div className="min-w-0 flex flex-col justify-between border-l border-slate-100 dark:border-nvu-line pl-2.5 sm:pl-5">
                    <div className="grid grid-cols-2 divide-x divide-slate-100 dark:divide-nvu-line">
                      <div className="pr-2 sm:pr-4 min-w-0">
                        <p className="text-[8px] sm:text-[11px] font-bold uppercase tracking-[0.02em] sm:tracking-wide text-slate-500 dark:text-nvu-muted whitespace-nowrap">Equipe</p>
                        <p className="text-[22px] sm:text-[28px] font-bold text-slate-950 dark:text-white leading-none mt-1.5 sm:mt-2">{company.totalEmployees}</p>
                        <p className="text-[9px] sm:text-[12px] text-slate-400 mt-1 truncate">membros</p>
    </div>
                      <div className="pl-2 sm:pl-4 min-w-0">
                        <p className="text-[8px] sm:text-[11px] font-bold uppercase tracking-[0.01em] sm:tracking-wide text-slate-500 dark:text-nvu-muted whitespace-nowrap">Viagens (mês)</p>
                        <p className="text-[22px] sm:text-[28px] font-bold text-slate-950 dark:text-white leading-none mt-1.5 sm:mt-2">{monthlyMetricLabel}</p>
                        <p className="text-[9px] sm:text-[12px] text-slate-400 mt-1 truncate">{monthlyDataReady ? "realizadas" : monthlyMetricLabel}</p>
    </div>
    </div>

                    <div className="grid grid-cols-[34px_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)] gap-1.5 sm:gap-2 mt-2.5 sm:mt-3">
                      <Button
                        onClick={() => setConfirmDeleteId(company.id)}
                        disabled={loadingAction}
                        variant="ghost"
                        aria-label={`Excluir ${company.companyName}`}
                        className="h-8 w-8 sm:h-9 sm:w-auto sm:px-3 bg-red-50 hover:bg-red-100 dark:bg-red-500/10 dark:hover:bg-red-500/20 text-red-600 rounded-[11px] sm:rounded-[12px] font-semibold p-0 sm:p-3"
                      >
                        <Trash2 size={14} /> <span className="hidden sm:inline ml-2">Excluir</span>
                      </Button>
                      <Button
                        onClick={() => viewCompanyDashboard(company)}
                        className="h-8 sm:h-9 min-w-0 px-2 sm:px-4 bg-slate-50 hover:bg-slate-100 text-slate-800 dark:bg-nvu-page dark:hover:bg-nvu-surface dark:text-white rounded-[11px] sm:rounded-[12px] shadow-none font-semibold text-[10px] sm:text-sm whitespace-nowrap"
                      >
                        <span className="truncate">Acessar Painel</span><ArrowRight size={14} className="ml-1 shrink-0" />
                      </Button>
    </div>
    </div>
    </div>
                <div className="col-span-full border-t border-slate-100 dark:border-nvu-line pt-3 mt-3 sm:mt-4">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-xl px-3 text-[11px] sm:text-xs"
                    aria-expanded={isStaffExpanded}
                    onClick={() =>
                      setExpandedStaffCompanyId((current) =>
                        current === company.id ? null : company.id,
                      )
                    }
                  >
                    <Users size={14} className="mr-1.5" />
                    Funcionários ({staffMembers.length})
                    <ChevronDown
                      size={14}
                      className={cn(
                        "ml-1.5 transition-transform",
                        isStaffExpanded && "rotate-180",
                      )}
                    />
                  </Button>

                  {isStaffExpanded && (
                    <div className="mt-3 space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
                      {staffMembers.length === 0 ? (
                        <p className="text-xs text-slate-500 dark:text-nvu-muted">
                          Nenhum membro carregado para esta empresa.
                        </p>
                      ) : (
                        staffMembers.map((member) => {
                          const user = allUsers.find((item) => item.id === member.userId) || member;
                          const isOwner =
                            Boolean(companyOwnerId) && String(member.userId || "") === companyOwnerId;
                          const name =
                            `${user?.firstName || user?.name || ""} ${user?.lastName || ""}`.trim() ||
                            (isOwner ? "Proprietário" : "Funcionário sem nome");
                          const accountStatus = String(
                            user?.accountStatus || member?.accountStatus || user?.status || "active",
                          ).toLowerCase();
                          const accountLabel = isOwner
                            ? "Responsável pela empresa"
                            : accountStatus === "suspended"
                              ? "Conta suspensa"
                              : accountStatus === "deleted" || user?.deleted === true || user?.softDeleted === true
                                ? "Perfil excluído"
                                : "Conta ativa";

                          return (
                            <div
                              key={`${company.id}:${member.userId}`}
                              className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-slate-100 dark:border-nvu-line bg-slate-50/80 dark:bg-nvu-page/50 px-3 py-2.5"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                  <p className="text-xs font-semibold text-slate-800 dark:text-nvu-text truncate">
                                    {name}
                                  </p>
                                  {isOwner && (
                                    <span className="shrink-0 rounded-full bg-slate-200 dark:bg-nvu-surface px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600 dark:text-nvu-text-soft">
                                      Proprietário
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] text-slate-500 dark:text-nvu-muted truncate">
                                  {user?.email || "Sem e-mail"} · {accountLabel}
                                </p>
                              </div>

                              <SeniorMemberActions
                                member={member}
                                user={user}
                                companyId={company.id}
                                companyName={company.companyName}
                                triggerLabel="Ações"
                                showStatusBadges={false}
                                triggerClassName="h-8 rounded-lg px-3 text-[11px]"
                                onUpdated={(patch) => {
                                  setAllUsers((current) =>
                                    current.map((item) =>
                                      item.id === member.userId ? { ...item, ...patch } : item,
                                    ),
                                  );
                                  if (patch.removedFromFleet) memberRelationsRevisionRef.current += 1;
                                  setAllMembers((current) =>
                                    patch.removedFromFleet
                                      ? current.filter(
                                          (item) =>
                                            !(
                                              item.companyId === company.id &&
                                              item.userId === member.userId
                                            ),
                                        )
                                      : current.map((item) =>
                                          item.userId === member.userId
                                            ? { ...item, ...patch }
                                            : item,
                                        ),
                                  );
                                  void loadSuspendedMembers();
                                }}
                              />
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </article>
              );
            })
          )}

          {companyCatalogError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
              <p>{companyCatalogError}</p>
              <Button
                type="button"
                variant="outline"
                className="mt-3 h-9 rounded-xl"
                onClick={() => loadCompanyPage(companiesCursor, allCompanies.length === 0)}
                disabled={loadingCompanies}
              >
                Tentar novamente
              </Button>
            </div>
          )}

          {hasMoreCompanies && !companyCatalogError && (
            <div className="flex flex-col items-center gap-1.5 pt-1">
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-xl px-5 bg-white dark:bg-nvu-surface"
                onClick={() => loadCompanyPage(companiesCursor, false)}
                disabled={loadingCompanies || !companiesCursor}
              >
                {loadingCompanies ? "Carregando..." : "Carregar mais empresas"}
              </Button>
              <p className="text-[11px] text-slate-400 dark:text-nvu-muted">
                {activeCompanies.length} empresas carregadas
              </p>
            </div>
          )}
    </div>
      )}

      {/* Confirmation Modals */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-nvu-surface rounded-[24px] p-6 w-full max-w-sm shadow-xl flex flex-col gap-4 animate-in zoom-in-95 duration-200">
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white pb-2 border-b border-gray-100 dark:border-nvu-line mb-3">
                Remover Empresa
              </h3>
              <p className="text-[14px] text-gray-500 dark:text-nvu-muted">
                ATENÇÃO: Você tem certeza que deseja remover esta empresa
                permanentemente? Todos os vínculos associados a ela perderão
                referência à empresa.
              </p>
    </div>
            <div className="flex gap-3 justify-end mt-2">
              <Button
                onClick={() => setConfirmDeleteId(null)}
                variant="outline"
                disabled={loadingAction}
                className="h-10 text-sm"
              >
                Cancelar
              </Button>
              <Button
                onClick={() => handleDeleteCompany(confirmDeleteId)}
                disabled={loadingAction}
                className="h-10 text-sm bg-red-600 hover:bg-red-700 text-white border-0 shadow-sm"
              >
                Confirmar Remoção
              </Button>
    </div>
    </div>
    </div>
      )}

      {confirmDeleteRegId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-nvu-surface rounded-[24px] p-6 w-full max-w-sm shadow-xl flex flex-col gap-4 animate-in zoom-in-95 duration-200">
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white pb-2 border-b border-gray-100 dark:border-nvu-line mb-3">
                Remover Solicitação
              </h3>
              <p className="text-[14px] text-gray-500 dark:text-nvu-muted">
                Tem certeza que deseja excluir permanentemente esta solicitação recusada? Esta ação não pode ser desfeita.
              </p>
    </div>
            <div className="flex gap-3 justify-end mt-2">
              <Button
                onClick={() => setConfirmDeleteRegId(null)}
                variant="outline"
                disabled={loadingAction}
                className="h-10 text-sm"
              >
                Cancelar
              </Button>
              <Button
                onClick={() => handleDeleteRegistration(confirmDeleteRegId)}
                disabled={loadingAction}
                className="h-10 text-sm bg-red-600 hover:bg-red-700 text-white border-0 shadow-sm"
              >
                Confirmar Exclusão
              </Button>
    </div>
    </div>
    </div>
      )}

      {selectedRegistrationId && registrations.some(reg => reg.id === selectedRegistrationId) && (
        <SeniorRegistrationReview
          key={selectedRegistrationId}
          registration={registrations.find(reg => reg.id === selectedRegistrationId)}
          onClose={closeRegistration}
          onImage={setZoomedImage}
          onApprove={setShowApproveConfirm}
          onReject={setShowRejectConfirm}
          covered={Boolean(showApproveConfirm || showRejectConfirm || zoomedImage)}
        />
      )}

      {showApproveConfirm && createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-nvu-surface border border-slate-200 dark:border-nvu-line rounded-2xl p-5 w-full max-w-sm shadow-xl flex flex-col gap-4 animate-in zoom-in-95 duration-200">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white pb-2 border-b border-slate-100 dark:border-nvu-line mb-3">
                Aprovar Empresa
              </h3>
              <p className="text-[13px] text-slate-600 dark:text-nvu-muted">
                Confirma a ativação desta empresa na plataforma NVU? Após a aprovação ela poderá operar normalmente.
              </p>
    </div>
            <div className="flex gap-2 justify-end mt-2">
              <Button
                onClick={() => setShowApproveConfirm(null)}
                variant="outline"
                disabled={loadingAction}
                className="h-9 text-[13px] px-4"
              >
                Cancelar
              </Button>
              <Button
                onClick={() => {
                   const reg = registrations.find(r => r.id === showApproveConfirm);
                   if (reg) handleApprove(reg);
                }}
                disabled={loadingAction}
                className="h-9 text-[13px] px-4 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-slate-100 dark:text-slate-900 border-0 shadow-sm"
              >
                Confirmar
              </Button>
    </div>
    </div>
    </div>
      , document.body)}

      {showRejectConfirm && createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-nvu-surface border border-slate-200 dark:border-nvu-line rounded-2xl p-5 w-full max-w-sm shadow-xl flex flex-col gap-3 animate-in zoom-in-95 duration-200">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white pb-2 border-b border-slate-100 dark:border-nvu-line mb-3">
                Recusar Solicitação
              </h3>
              <p className="text-[13px] text-slate-600 dark:text-nvu-muted mb-3">
                Tem certeza que deseja recusar esta solicitação?
              </p>
              
              <label className="text-[12px] font-semibold text-slate-700 dark:text-nvu-text-soft">Motivo (Opcional)</label>
              <textarea 
                 value={rejectionReason} 
                 onChange={(e) => setRejectionReason(e.target.value)} 
                 className="mt-1 w-full bg-slate-50 dark:bg-nvu-page border border-slate-200 dark:border-nvu-line rounded-lg p-3 text-[13px] resize-none outline-none focus:border-slate-400 dark:focus:border-slate-500" 
                 placeholder="Explique o motivo..." 
                 rows={3} 
              />
    </div>
            <div className="flex gap-2 justify-end mt-1">
              <Button
                onClick={() => setShowRejectConfirm(null)}
                variant="outline"
                disabled={loadingAction}
                className="h-9 text-[13px] px-4"
              >
                Cancelar
              </Button>
              <Button
                onClick={() => handleReject(showRejectConfirm)}
                disabled={loadingAction}
                className="h-9 text-[13px] px-4 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-slate-100 dark:text-slate-900 border-0 shadow-sm"
              >
                Confirmar
              </Button>
    </div>
    </div>
    </div>
      , document.body)}

      {/* Full-screen Image Zoom Overlay */}
      {zoomedImage && createPortal(
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setZoomedImage(null)}
        >
          <button 
            className="absolute top-4 right-4 p-2 md:top-8 md:right-8 bg-black/50 text-white hover:bg-white hover:text-black transition-colors rounded-full"
            onClick={(e) => { e.stopPropagation(); setZoomedImage(null); }}
          >
            <XCircle size={32} />
          </button>
          <CachedImage 
            src={zoomedImage} 
            alt="Zoomed" 
            className="max-w-[95vw] max-h-[95vh] object-contain rounded-xl shadow-2xl animate-in zoom-in-95 duration-300" 
            onClick={(e) => e.stopPropagation()}
          />
    </div>
      , document.body)}

      <CreateNewsModal
        isOpen={isCreateNewsModalOpen}
        onClose={() => setIsCreateNewsModalOpen(false)}
      />
      <SimulatorManagerModal
        isOpen={isSimulatorManagerOpen}
        onClose={() => setIsSimulatorManagerOpen(false)}
      />
      <SimpleCityManagerModal
        isOpen={isSimpleCityManagerOpen}
        onClose={() => setIsSimpleCityManagerOpen(false)}
      />
      <SuspendedMembersModal
        open={isSuspendedMembersOpen}
        records={suspendedMembers}
        loading={loadingSuspendedMembers}
        error={suspendedMembersError}
        onClose={() => setIsSuspendedMembersOpen(false)}
        onRefresh={loadSuspendedMembers}
      />

      <WorkModeAvailabilityModal
        isOpen={isWorkModeAvailabilityOpen}
        onClose={() => setIsWorkModeAvailabilityOpen(false)}
        simulators={simulators}
      />

      {isSettingsOpen && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-opacity duration-150 ease-out">
          <div className="bg-white dark:bg-nvu-surface border border-slate-200 dark:border-nvu-line rounded-2xl w-full max-w-sm shadow-2xl flex flex-col overflow-hidden transition-all duration-150 ease-out">
            <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-nvu-line/60 bg-slate-50/50 dark:bg-nvu-surface/50">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Opções</h2>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="p-2 -mr-2 text-slate-500 hover:bg-slate-200 dark:hover:bg-nvu-surface rounded-full transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex flex-col p-2">
              <button
                onClick={() => {
                  setIsSettingsOpen(false);
                  setIsCreateNewsModalOpen(true);
                }}
                className="flex items-center gap-3 p-3 text-[14px] font-medium text-slate-700 dark:text-nvu-text-soft hover:bg-slate-50 dark:hover:bg-nvu-surface rounded-xl transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center shrink-0">
                  <Megaphone size={18} className="text-blue-600 dark:text-blue-400" />
                </div>
                Gerenciar comunicados
              </button>
              <button
                onClick={() => {
                  setIsSettingsOpen(false);
                  setIsSimulatorManagerOpen(true);
                }}
                className="flex items-center gap-3 p-3 text-[14px] font-medium text-slate-700 dark:text-nvu-text-soft hover:bg-slate-50 dark:hover:bg-nvu-surface rounded-xl transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-purple-50 dark:bg-purple-500/10 flex items-center justify-center shrink-0">
                  <Gamepad2 size={18} className="text-purple-600 dark:text-purple-400" />
                </div>
                Gerenciar simuladores
              </button>
              <button
                onClick={() => {
                  setIsSettingsOpen(false);
                  setIsSimpleCityManagerOpen(true);
                }}
                className="flex items-center gap-3 p-3 text-[14px] font-medium text-slate-700 dark:text-nvu-text-soft hover:bg-slate-50 dark:hover:bg-nvu-surface rounded-xl transition-colors"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-50 dark:bg-cyan-500/10">
                  <Navigation size={18} className="text-cyan-600 dark:text-cyan-400" />
                </div>
                Gerenciar cidades
              </button>
              <button
                onClick={() => {
                  setIsSettingsOpen(false);
                  setIsWorkModeAvailabilityOpen(true);
                }}
                className="flex items-center gap-3 p-3 text-[14px] font-medium text-slate-700 dark:text-nvu-text-soft hover:bg-slate-50 dark:hover:bg-nvu-surface rounded-xl transition-colors"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-500/10">
                  <Wrench size={18} className="text-amber-600 dark:text-amber-400" />
                </div>
                Controle de envio de viagens
              </button>
              <button
                onClick={() => {
                  setIsSettingsOpen(false);
                  setIsSuspendedMembersOpen(true);
                  void loadSuspendedMembers();
                }}
                className="flex items-center gap-3 p-3 text-[14px] font-medium text-slate-700 dark:text-nvu-text-soft hover:bg-slate-50 dark:hover:bg-nvu-surface rounded-xl transition-colors"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 dark:bg-red-500/10">
                  <UserX size={18} className="text-red-600 dark:text-red-400" />
                </div>
                Membros suspensos
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}
