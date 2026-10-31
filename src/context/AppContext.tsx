import { lookupPrivateProfiles, queryPrivateUsers } from "../services/privateUserProfiles";
import { deleteCompanyCanonical } from "../services/seniorAccountAdministrationService";
import { manageFleetMembership } from "../services/fleetMembershipService";
import {
  rejectDriverRequestOnServer,
  rejectRecruitmentApplicationOnServer,
} from "../services/adminRejectionService";
import { presentConfirmedOperationResult } from "../services/operationCompletionPresentation";
import { canonicalTripRepository } from "../repositories/CanonicalTripRepository";
import { operationOutbox, OPERATION_OUTBOX_CHANGED, mirrorOperationStart, mirrorOperationCapturePause, pendingOperationTripCount } from "../services/operationOutbox";
import { automaticOperationJobId } from "../application/operation/DurableOperationOutbox";
import { needsSessionReconnect, nextSessionGeneration } from "../lib/sessionRefreshPolicy";
import { operationalRequestId } from "../lib/operationalRequestId";
import { automaticQueueScope, readOperationalQueueCache } from "../lib/operationalQueueCache";
import { resolveOperationContract } from "../lib/operationResultSummary";
import { assertCachedNewOperationAllowed } from "../services/workModeAvailabilityService";
import type { QueueNext } from "../../functions/src/operationalQueueModel";
import { mergeManagedOperationAcknowledgement, ManagedOperationAcknowledgementCache } from "../lib/managedOperationAcknowledgement";
import { resolveTripSimulatorCode as resolveAvailabilitySimulator } from "../lib/tripDistance";
import { assertNewOperationAllowed } from "../services/workModeAvailabilityService";
import { canonicalTripOperationService } from "../application/trip/CanonicalTripOperationService";
import { canonicalOperationCommandService } from "../application/operation/CanonicalOperationCommandService";
import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { toast } from "sonner";
import { driverDisplayIdentity } from "../lib/driverDisplayIdentity";
import { useDriverDisplayProfiles } from "../hooks/useDriverDisplayProfiles";
import { auth, authPersistenceReady, db } from "../lib/firebase";
import { restoreNativeGoogleSession } from "../services/googleAuthService";
import { NotificationsProvider } from "./NotificationsContext";
import {
  CompanyProvider,
  mergeCompanyProfile,
  normalizeCompanyProfile,
  useCompanyDataController,
  useCompanyMembersController,
  useCompanyRecruitmentController,
  writeCachedCompanies,
  type CompanyStoreType,
} from "./CompanyContext";
import { resolveSimulatorId } from "../lib/resolveSimulator";
import { normalizeSimulatorDocuments } from "../lib/simulatorCatalog";
import {
  beginAuthTeardown,
  endAuthTeardown,
  isAuthTeardownActive,
} from "../lib/authLifecycle";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { syncSingleSimulatorMember, removeSimulatorMember } from "../lib/syncSimulatorMembers";
import { resolveOperationalCompanyId } from "../lib/companyScope";
import { generateCnpj } from "../lib/cnpj";
import { preloadImages } from "../lib/imageCache";
import { warmRankingUserProfiles } from "../lib/rankingPhotoWarmup";
import { getRuntimePerformanceProfile } from "../lib/runtimePerformance";
import {
  NVU_FOREGROUND_ROUTE_EVENT,
  canSuspendCompanyScopedRealtime,
  getForegroundPathname,
  isInteractionFirstRoute,
} from "../lib/foregroundRoute";
import { resolveMembershipRoles } from "../lib/membershipRoles";
import { unifyUserDocument } from "../services/userIdentityService";
import {
  createSessionDiagnostic,
  persistSessionDiagnostic,
  readPersistedSessionDiagnostic,
  type SessionDiagnostic,
  type SessionDiagnosticCode,
} from "../services/sessionDiagnostic";
import { createMembershipRepository } from "../services/membershipRepository";
import { projectAuthSession } from "../services/authSessionProjection";
import { applyAuthoritativeJobProjection } from "../lib/authoritativeJobProjection";
import { useInitialOperationIntegrity } from "../hooks/useInitialOperationIntegrity";
import { resolveOperationalRealtimePolicy } from "../services/operationalRealtimePolicy";
import {
  buildProfileIndex,
  toActiveProfileContext,
  type ActiveProfileContext,
  type ProfileIndex,
} from "../services/profileIndex";
import { resolveReauthMemberships } from "../services/reauthMembershipPolicy";
import { clearSessionResumeRoute } from "../lib/sessionResumeRoute";
import {
  readOfflineSessionSnapshot,
  writeOfflineSessionSnapshot,
  clearOfflineSessionSnapshot,
} from "../lib/offlineSessionSnapshot";
import { markSessionBootEvent } from "../lib/sessionBootTelemetry";
import { markProfilePerf } from "../lib/profilePerformanceTelemetry";
import { getOperationalSuspension } from "../lib/driverSuspension";
import { clearTripHistoryCacheForUser } from "../lib/tripHistoryPersistentCache";
import { isOpenJobStatus, normalizeJobStatus } from "../lib/jobStatus";
import { isSimpleAutomationNativeAvailable } from "../lib/simpleAutomationNative";
import type { ConfirmedOperationCompletion } from "../application/operation/FinalizeOperation";
import { discardCompletedOperationQueue, reconcileCompletedOperationQueues } from "../services/completedOperationQueueCleanup";
import { selectCurrentOperationJob } from "../lib/currentOperation";
import {
  resolveCurrentFleetUsageJobs,
  resolveFleetJobAssetId,
} from "../lib/fleetUsage";
import {
  resolveApprovedCompanyOwnerPhoto,
  resolvePersistedUserProfilePhoto,
} from "../lib/profilePhotoRecovery";
import {
  createCorporateNotifications,
  createNotification,
  resolveNotifications,
} from "../services/notificationService";
import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { GtoObserver, isGtoObserverAvailable, isNativeAndroid } from "../lib/gtoObserver";
import { registerDeviceForPush, clearPushRegistrationContext } from "../lib/capacitorPushService";
import {
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  collection,
  onSnapshot,
  query,
  where,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  deleteField,
  writeBatch,
  arrayUnion,
  limit,
} from "firebase/firestore";

// --- Types ---
export type Role = "admin" | "driver";

export interface CompanyMember {
  id: string;
  companyId: string;
  userId: string;
  roles: Role[];
  role?: Role;
  permissions: string[];
  status: "active" | "pending" | "rejected" | "inactive";
  joinedAt?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string;
  authPhotoURL?: string;
  profilePhotoURL?: string;
  profileNameSource?: string;
  profileNameUpdatedAt?: string;
  profilePhotoSource?: string;
  profilePhotoUpdatedAt?: string;
  approvedIdentityApplicationId?: string;
  approvedIdentityName?: string;
  approvedIdentityPhotoURL?: string;
  approvedIdentityVersion?: number;
  profileCoverURL?: string;
  profileCoverRevision?: string;
  whatsapp?: string;
  /** Granted by the server only: the driver already has (or had) an approved link and may keep a personal profile without a company. */
  driverProfileEnabled?: boolean;
  applicationSubmitted?: boolean;
  /** Documento da inscrição que está sendo acompanhada nesta sessão/conta. */
  currentRecruitmentApplicationId?: string;
  currentRecruitmentCompanyId?: string;
  currentRecruitmentSimulatorId?: string;
  currentRecruitmentStatus?: "pending" | "approved" | "rejected";
  currentRecruitmentType?: "company_registration" | "driver_application";
  status: "active" | "pending" | "rejected" | "inactive";
  isOnline?: boolean;
  level?: number;
  rating?: number;
  xp?: number;
  totalDeliveries?: number;

  // Legacy fields (kept for fallback only, do not rely on these)
  companyId?: string;
  memberships?: {
    [companyId: string]: {
      role: Role;
      roles: Role[];
      status: "active" | "pending" | "rejected" | "inactive";
    };
  };
  role?: Role;
  roles?: Role[];
  operationalSuspendedUntil?: any;
  operationalSuspendedAt?: any;
  operationalSuspension?: {
    startsAt?: any;
    endsAt?: any;
    durationHours?: number;
    reasons?: string[];
    message?: string;
    companyId?: string;
    tripId?: string;
    createdBy?: string;
  };
}

export interface Vehicle {
  id: string;
  userId?: string;
  companyId: string;
  name: string;
  plate?: string;
  paintCode?: string;
  status: "available" | "in_use" | "maintenance";
  sequenceId?: string;
  sequenceOrder?: number;
}

export interface Trailer {
  id: string;
  userId?: string;
  companyId: string;
  name: string;
  plate?: string;
  paintCode?: string;
  status: "available" | "in_use";
  sequenceId?: string;
  sequenceOrder?: number;
}

export interface ContractDelivery {
  id: string;
  origin: string;
  destination: string;
}

export interface RecruitmentSettings {
  about: string;
  rules: string;
  howItWorks: string;
  benefits: string;
  isActive?: boolean;
}

export interface RecruitmentApplication {
  id: string;
  type?: "company_registration" | "driver_application";
  registrationType?: "company_registration" | "driver_application";
  userId?: string;
  companyId: string;
  simulatorId?: string;
  applicationPhotoURL: string;
  applicationPhotoTransport?: "none" | "storage" | "firestore-data-url" | "legacy";
  fullName: string;
  whatsapp: string;
  email: string;
  reason: string;
  objective: string;
  deliveriesPerWeek: string;
  hasExperience?: boolean;
  primaryVehicle: string;
  secondaryVehicle: string;
  status: "pending" | "approved" | "rejected";
  flowVersion?: number;
  isCurrent?: boolean;
  supersededAt?: string;
  accessRevokedAt?: string;
  accessRevokedReason?: string;
  createdAt: string;
  companyName?: string;
  ownerName?: string;
  companyLogoURL?: string;
  ownerPhotoUrl?: string;
  simulatorName?: string;
  rejectionReason?: string;
}

export interface Simulator {
  [key: string]: any;
  id: string;
  name: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CompanyProfile {
  [key: string]: any;
  id: string;
  userId?: string;
  ownerId?: string;
  companyName: string;
  profileDescription?: string;
  profileDescriptionRevision?: string;
  fleetName?: string; // Fallback temporário
  simulatorName: string;
  simulatorId?: string;
  ownerName: string;
  email?: string;
  ownerEmail?: string;
  cnpj: string;
  whatsapp?: string;
  logoUrl?: string;
  profileCoverURL?: string;
  profileCoverRevision?: string;
  logoURL?: string;
  companyLogoURL?: string;
  logoStoragePath?: string;
  ownerPhotoStoragePath?: string;
  ownerPhotoUrl?: string;
  sourceRegistrationId?: string;
  recruitmentSettings?: RecruitmentSettings;
}

export interface Sequence {
  id: string;
  companyId: string;
  name: string;
  description?: string;
  scope?: "operations" | "vehicles" | "trailers";
  createdAt: string;
  deleted?: boolean;
}

export interface Contract {
  id: string;
  userId?: string;
  companyId: string;
  companyName?: string;
  name: string;
  simulator: string;
  trailerId?: string;
  deadlineDays: number;
  totalDeliveries: number;
  mode: "simple" | "detailed";
  deliveries?: ContractDelivery[]; // Only for detailed mode
  status: "active" | "completed";
  sequenceId?: string;
  sequenceOrder?: number;
  deleted?: boolean;
}

export interface Job {
  operationSyncState?: "pending_start" | "pending_finish" | "start_rejected" | "finish_rejected";
  operationSyncError?: string;
  id: string;
  operationId?: string;
  userId?: string;
  motoristaId?: string;
  companyId: string;
  contractId: string;
  driverId: string;
  simulatorId?: string;
  vehicleId: string;
  trailerId?: string;
  status: "pending" | "active" | "completed" | "cancelled" | "awaiting_completion" | "delayed";
  progress: number; // Num of completed deliveries
  totalDeliveries?: number;
  operationalCommandVersion?: number;
  operationalRevision?: number;
  contractSnapshot?: Record<string, any>;
  archived?: boolean;
  operationProgressReconciled?: boolean; // Server transaction has verified this count
  contractNameSnapshot?: string;
  completedRoutes?: { origin: string; destination: string }[]; // For simple mode deliveries
  deadlineDate: string; // ISO String (legacy fallback)
  createdAt?: string;
  assignedAt?: string;
  dueAt?: string;
  completedAt?: string;
  completionStatus?: "on_time" | "late";
  completionTimeOffset?: string;
}

export interface JobDemand {
  id: string;
  driverId: string;
  companyId: string;
  status: "pending" | "reviewed";
  createdAt: string;
}

export interface DriverRequest {
  id: string;
  motoristaId: string;
  empresaId: string;
  simulatorId?: string;
  adminId: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  updatedAt: string;
}


// --- Initial Mock Data ---
const MOCK_COMPANIES: CompanyProfile[] = [
  {
    id: "c1",
    companyName: "Logistics Pro SA",
    fleetName: "Pro Fleet",
    simulatorName: "Euro Truck Simulator 2",
    ownerName: "Admin",
    cnpj: "12.345.678/0001-90",
  },
];

const MOCK_USERS: User[] = [
  {
    companyId: "c1",
    id: "u1",
    name: "Fábio Dias",
    email: "admin@frotalog.com",
    password: "123",
    role: "admin",
    roles: ["admin", "driver"],
    status: "active",
    profilePhotoURL: "https://i.prprofilePhotoURL.cc/150?u=u1",
  },
  {
    companyId: "c1",
    id: "u2",
    name: "João Silva",
    email: "joao@frotalog.com",
    password: "123",
    role: "driver",
    roles: ["driver"],
    status: "active",
    level: 4,
    rating: 4.8,
    profilePhotoURL: "https://i.prprofilePhotoURL.cc/150?u=u2",
  },
  {
    companyId: "c1",
    id: "u3",
    name: "Carlos Lima",
    email: "carlos@frotalog.com",
    password: "123",
    role: "driver",
    roles: ["driver"],
    status: "active",
    level: 2,
    rating: 4.5,
    profilePhotoURL: "https://i.prprofilePhotoURL.cc/150?u=u3",
  },
  {
    companyId: "c1",
    id: "u4",
    name: "Marcos Paulo",
    email: "marcos@frotalog.com",
    password: "123",
    role: "driver",
    roles: ["driver"],
    status: "pending",
    level: 1,
    rating: 5.0,
    profilePhotoURL: "https://i.prprofilePhotoURL.cc/150?u=u4",
  },
];

const MOCK_VEHICLES: Vehicle[] = [
  {
    companyId: "c1",
    id: "v1",
    name: "Scania R500",
    plate: "ABC-1D23",
    status: "available",
    paintCode: "#FF0000",
  },
  {
    companyId: "c1",
    id: "v2",
    name: "Volvo FH540",
    plate: "XYZ-9F71",
    status: "in_use",
    paintCode: "Azul Brilhante",
  },
  {
    companyId: "c1",
    id: "v3",
    name: "DAF XF 105",
    plate: "QWE-4422",
    status: "available",
  },
];

const MOCK_TRAILERS: Trailer[] = [
  {
    companyId: "c1",
    id: "t1",
    name: "Granel GR 7 Eixos",
    plate: "AAA-0001",
    status: "available",
    paintCode: "#FFFFFF",
  },
  {
    companyId: "c1",
    id: "t2",
    name: "Sider 3 Eixos",
    plate: "BBB-0002",
    status: "in_use",
  },
];

const MOCK_CONTRACTS: Contract[] = [
  {
    companyId: "c1",
    id: "c1",
    name: "Transporte de Grãos",
    simulator: "Euro Truck Sim 2",
    deadlineDays: 5,
    totalDeliveries: 8,
    mode: "simple",
    status: "active",
  },
  {
    companyId: "c1",
    id: "c2",
    name: "Minério de Ferro",
    simulator: "American Truck Sim",
    deadlineDays: 3,
    totalDeliveries: 4,
    mode: "detailed",
    deliveries: [
      { id: "d1", origin: "Mina A", destination: "Porto Novo" },
      { id: "d2", origin: "Mina A", destination: "Porto Sul" },
      { id: "d3", origin: "Mina B", destination: "Siderúrgica" },
      { id: "d4", origin: "Mina B", destination: "Porto Norte" },
    ],
    status: "active",
  },
];

// Pre-create some jobs
const d = new Date();
d.setDate(d.getDate() + 2); // Deadline in 2 days
const MOCK_JOBS: Job[] = [
  {
    companyId: "c1",
    id: "j1",
    contractId: "c1",
    driverId: "u2",
    vehicleId: "v2",
    trailerId: "t2",
    status: "active",
    progress: 3,
    deadlineDate: d.toISOString(),
  },
];

// --- Context Setup ---
export interface SessionStoreType {
  isSeniorAuthenticated: boolean;
  setIsSeniorAuthenticated: (val: boolean) => void;
  seniorCompanyId: string | null;
  setSeniorCompanyId: (val: string | null) => void;
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  authInitialized: boolean;
  membershipsLoaded: boolean;
  sessionReady: boolean;
  /** Fast UI handoff only; never authorizes Admin/Driver routes. */
  sessionUiReady: boolean;
  /** Initial membership snapshot may paint the selector while server auth recovers. */
  membershipsUiReady: boolean;
  /** Identity reconciliation must settle before an empty membership result is classified. */
  identityReconciliationStatus: "idle" | "pending" | "complete" | "failed";
  sessionDiagnostic: SessionDiagnostic | null;
  sessionRecovering: boolean;
  profileIndex: ProfileIndex;
  activeProfileContext: ActiveProfileContext | null;
  refreshSession: (reason?: string) => void;
  /** Re-read memberships from Firestore server after identity reconciliation. */
  confirmCanonicalMemberships: (expectedUid?: string) => Promise<CompanyMember[]>;
  activeRole: Role | null;
  memberships: CompanyMember[];
  activeCompanyId: string | null;
  setActiveCompanyId: (id: string | null) => void;
  switchRole: (role: Role, newCompanyId?: string) => Promise<void>;
  logOutApp: () => Promise<void>;
}

export interface ActivityStoreType {
  jobDemands: JobDemand[];
}

export interface RankingFilterStoreType {
  globalPeriodPreset: "semana" | "mes" | "custom";
  setGlobalPeriodPreset: (p: "semana" | "mes" | "custom") => void;
  globalStartDateStr: string;
  setGlobalStartDateStr: (s: string) => void;
  globalEndDateStr: string;
  setGlobalEndDateStr: (s: string) => void;
}

/** Operational data kept in AppProvider while the remaining feature slices are
 * extracted. Company and notification contracts deliberately do not appear
 * here, preventing the old monolithic compatibility context from returning.
 */
export interface OperationalStoreType {
  users: User[];
  vehicles: Vehicle[];
  trailers: Trailer[];
  contracts: Contract[];
  sequences: Sequence[];
  jobs: Job[];
  simulators: Simulator[];
  simulatorsLoading: boolean;
  simulatorsError: string | null;
  /** True only after the first authoritative scoped snapshots have settled. */
  operationalDataReady: boolean;
  /** True while a cached/previous scoped snapshot remains visible during refresh. */
  operationalDataRefreshing: boolean;
  jobsReady: boolean;
  contractsReady: boolean;
  usersReady: boolean;
  createContract: (
    contract: Omit<Contract, "id" | "status">,
  ) => Promise<void>;
  updateContract: (
    id: string,
    updates: Partial<Omit<Contract, "id">>,
  ) => Promise<void>;
  deleteContract: (id: string) => Promise<void>;
  createSequence: (
    sequence: Omit<Sequence, "id" | "createdAt">,
  ) => Promise<string | null>;
  updateSequence: (
    id: string,
    updates: Partial<Omit<Sequence, "id">>,
  ) => Promise<void>;
  deleteSequence: (id: string) => Promise<void>;
  assignJob: (
    contractId: string,
    driverId: string,
    vehicleId: string,
    trailerId?: string,
    customDeadlineDays?: number,
    requestId?: string,
  ) => Promise<void>;
  startJob: (jobId: string) => Promise<void>;
  startAutomaticOperation: (next: QueueNext, vehicleId: string) => Promise<void>;
  finishJob: (jobId: string) => Promise<ConfirmedOperationCompletion>;
  cancelJob: (jobId: string) => Promise<boolean>;
  changeJobVehicle: (jobId: string, vehicleId: string) => Promise<void>;
  deleteJob: (jobId: string) => Promise<void>;
  requestNewJobDemand: () => Promise<void>;
  cancelJobDemand: () => Promise<void>;
  rejectJobDemand: (demandId: string) => Promise<void>;
  updateUserOnlineStatus: (isOnline: boolean) => Promise<void>;
  createManualDriver: (driverData: Partial<User>) => Promise<void>;
  registerUser: (
    userData: Pick<User, "name" | "email" | "password" | "role">,
  ) => void;
  syncCompanyData: () => Promise<void>;
  addVehicle: (
    vehicle: Omit<Vehicle, "id" | "status" | "companyId">,
  ) => Promise<void>;
  updateVehicle: (
    id: string,
    updates: Partial<Omit<Vehicle, "id">>,
  ) => Promise<void>;
  deleteVehicle: (id: string) => Promise<void>;
  addTrailer: (
    trailer: Omit<Trailer, "id" | "status" | "companyId">,
  ) => Promise<void>;
  updateTrailer: (
    id: string,
    updates: Partial<Omit<Trailer, "id">>,
  ) => Promise<void>;
  deleteTrailer: (id: string) => Promise<void>;
}

const SessionContext = createContext<SessionStoreType | undefined>(undefined);
const ActivityContext = createContext<ActivityStoreType | undefined>(undefined);
const RankingFilterContext = createContext<RankingFilterStoreType | undefined>(undefined);
const OperationalContext = createContext<OperationalStoreType | undefined>(undefined);

/**
 * Keeps action identities stable while still executing the latest implementation.
 * This prevents context consumers from re-rendering only because AppProvider
 * recreated an async action after an unrelated Firestore snapshot.
 */
const useStableEvent = <T extends (...args: any[]) => any>(handler: T): T => {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  return useMemo(
    () => ((...args: Parameters<T>) => handlerRef.current(...args)) as T,
    [],
  );
};

const SESSION_CACHE_VERSION = "v5";
const SESSION_UID_KEY = "nvu.session.uid";
const SESSION_MEMBERSHIP_CACHE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const SESSION_MEMBERSHIP_WARM_AUTH_MAX_AGE_MS = 15 * 60 * 1000;
const SIMULATOR_CACHE_VERSION = "v1";
const SIMULATOR_CACHE_KEY = `nvu.public.simulators.${SIMULATOR_CACHE_VERSION}`;
const sessionUserCacheKey = (uid: string) =>
  `nvu.session.${SESSION_CACHE_VERSION}.user.${uid}`;
const sessionMembershipCacheKey = (uid: string) =>
  `nvu.session.${SESSION_CACHE_VERSION}.memberships.${uid}`;
const sessionMembershipConfirmationKey = (uid: string) =>
  `nvu.session.${SESSION_CACHE_VERSION}.memberships-confirmed.${uid}`;
const sessionActiveCompanyKey = (uid: string) =>
  `nvu.session.${SESSION_CACHE_VERSION}.active-company.${uid}`;
const sessionActiveRoleKey = (uid: string) =>
  `nvu.session.${SESSION_CACHE_VERSION}.active-role.${uid}`;

const readLocalStorageValue = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeLocalStorageValue = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // O estado React permanece válido em previews com storage restrito.
  }
};

const removeLocalStorageValue = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Limpeza best-effort.
  }
};

const readSessionStorageValue = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeSessionStorageValue = (key: string, value: string): void => {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // O estado React permanece válido em previews com storage restrito.
  }
};

const removeSessionStorageValue = (key: string): void => {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Limpeza best-effort.
  }
};

const clearSessionStorage = (): void => {
  try {
    sessionStorage.clear();
  } catch {
    // Limpeza best-effort.
  }
};

const isValidCacheTimestamp = (cachedAt: unknown) =>
  typeof cachedAt === "number" &&
  Number.isFinite(cachedAt) &&
  cachedAt > 0;

const isFreshCache = (cachedAt: unknown, maxAgeMs: number) =>
  isValidCacheTimestamp(cachedAt) && Date.now() - Number(cachedAt) <= maxAgeMs;

const normalizeAuthenticatedUser = (
  raw: Record<string, unknown>,
  id: string,
): User => {
  const data = { ...raw, id, ...driverDisplayIdentity({ ...raw, id }) } as User;
  const rawRoles = Array.isArray(data.roles) ? [...data.roles] : [];
  if (rawRoles.length === 0) rawRoles.push(data.role || "driver");
  if (rawRoles.includes("admin") && !rawRoles.includes("driver")) {
    rawRoles.push("driver");
  }
  data.roles = Array.from(new Set(rawRoles));

  if (!data.role) {
    data.role = ((data.roles as string[]).includes("senior")
      ? "senior"
      : data.roles.includes("admin")
        ? "admin"
        : "driver") as Role;
  }
  if (data.roles.includes("admin")) data.status = "active";


  return data;
};

const createFirebaseIdentityFallback = (firebaseUser: {
  uid: string;
  displayName?: string | null;
  email?: string | null;
  photoURL?: string | null;
}): User => ({
  id: firebaseUser.uid,
  name: "Motorista",
  email: firebaseUser.email || "",
  authPhotoURL: firebaseUser.photoURL || undefined,
  profilePhotoURL: undefined,
  status: "active",
  role: "driver",
  roles: ["driver"],
});

const normalizeCachedSimulator = (value: unknown): Simulator | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = String(record.id || "").trim();
  const name = String(
    record.name ||
      record.simulatorName ||
      record.simuladorNome ||
      record.label ||
      "",
  ).trim();
  if (!id || !name) return null;
  return {
    ...record,
    id,
    name,
    active: record.active !== false,
  } as Simulator;
};

const readCachedSimulators = (): Simulator[] => {
  try {
    const raw = localStorage.getItem(SIMULATOR_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      version?: string;
      cachedAt?: number;
      simulators?: unknown[];
    };
    if (
      parsed.version !== SIMULATOR_CACHE_VERSION ||
      !isValidCacheTimestamp(parsed.cachedAt) ||
      !Array.isArray(parsed.simulators)
    ) {
      return [];
    }
    return parsed.simulators
      .map(normalizeCachedSimulator)
      .filter((simulator): simulator is Simulator => Boolean(simulator));
  } catch {
    return [];
  }
};

const writeCachedSimulators = (simulators: Simulator[]) => {
  try {
    localStorage.setItem(
      SIMULATOR_CACHE_KEY,
      JSON.stringify({
        version: SIMULATOR_CACHE_VERSION,
        cachedAt: Date.now(),
        simulators: simulators.slice(0, 200),
      }),
    );
  } catch {
    // Catálogo público é apenas uma aceleração visual.
  }
};

const readCachedSessionUser = (uid: string): User | null => {
  try {
    const raw = localStorage.getItem(sessionUserCacheKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      uid?: string;
      user?: User;
      cachedAt?: number;
    };
    if (
      parsed.uid !== uid ||
      !parsed.user ||
      parsed.user.id !== uid ||
      !isValidCacheTimestamp(parsed.cachedAt)
    ) {
      return null;
    }
    return normalizeAuthenticatedUser(
      parsed.user as unknown as Record<string, unknown>,
      uid,
    );
  } catch {
    return null;
  }
};

const writeCachedSessionUser = (user: User) => {
  try {
    const cacheable = { ...user };
    delete cacheable.password;
    localStorage.setItem(
      sessionUserCacheKey(user.id),
      JSON.stringify({ uid: user.id, user: cacheable, cachedAt: Date.now() }),
    );
  } catch {
    // Storage can be unavailable in private mode; the live session still works.
  }
};

const normalizeCompanyMember = (
  raw: Record<string, unknown>,
  id: string,
): CompanyMember => {
  const normalized = { ...raw, id } as unknown as CompanyMember;
  normalized.companyId = String(raw.companyId || "").trim();
  normalized.userId = String(raw.userId || "").trim();
  normalized.roles = resolveMembershipRoles({
    ...raw,
    companyId: normalized.companyId,
  }) as Role[];
  normalized.permissions = Array.isArray(raw.permissions)
    ? raw.permissions.filter((permission): permission is string =>
        typeof permission === "string",
      )
    : [];
  normalized.status =
    raw.status === "pending" || raw.status === "rejected"
      ? raw.status
      : "active";
  return normalized;
};

const readCachedMemberships = (uid: string): CompanyMember[] => {
  try {
    const raw = localStorage.getItem(sessionMembershipCacheKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      uid?: string;
      memberships?: CompanyMember[];
      cachedAt?: number;
    };
    if (
      parsed.uid !== uid ||
      !Array.isArray(parsed.memberships) ||
      !isValidCacheTimestamp(parsed.cachedAt)
    ) {
      return [];
    }
    return parsed.memberships
      .map((membership) =>
        normalizeCompanyMember(
          membership as unknown as Record<string, unknown>,
          membership.id || `cached-${membership.companyId}`,
        ),
      )
      .filter(
        (membership) =>
          membership.userId === uid && Boolean(membership.companyId),
      );
  } catch {
    return [];
  }
};

const hasCachedMembershipSnapshot = (uid: string) => {
  try {
    const raw = localStorage.getItem(sessionMembershipCacheKey(uid));
    if (!raw) return false;
    const parsed = JSON.parse(raw) as {
      uid?: string;
      memberships?: CompanyMember[];
      cachedAt?: number;
    };
    return (
      parsed.uid === uid &&
      Array.isArray(parsed.memberships) &&
      isValidCacheTimestamp(parsed.cachedAt)
    );
  } catch {
    return false;
  }
};

const hasFreshCachedMembershipSnapshot = (uid: string) => {
  try {
    const raw = localStorage.getItem(sessionMembershipCacheKey(uid));
    if (!raw) return false;
    const parsed = JSON.parse(raw) as {
      uid?: string;
      memberships?: CompanyMember[];
      cachedAt?: number;
    };
    return (
      parsed.uid === uid &&
      Array.isArray(parsed.memberships) &&
      isFreshCache(parsed.cachedAt, SESSION_MEMBERSHIP_CACHE_MAX_AGE_MS)
    );
  } catch {
    return false;
  }
};

const hasFreshServerConfirmedMemberships = (uid: string) => {
  const confirmedAt = Number(
    readLocalStorageValue(sessionMembershipConfirmationKey(uid)) || "0",
  );
  return (
    confirmedAt > 0 &&
    Date.now() - confirmedAt <= SESSION_MEMBERSHIP_WARM_AUTH_MAX_AGE_MS &&
    hasFreshCachedMembershipSnapshot(uid)
  );
};

const markServerConfirmedMemberships = (uid: string) => {
  writeLocalStorageValue(sessionMembershipConfirmationKey(uid), String(Date.now()));
};

const emptyBootSessionSnapshot = () => ({
  uid: null as string | null,
  user: null as User | null,
  memberships: [] as CompanyMember[],
  companies: [] as Record<string, unknown>[],
  simulators: [] as Record<string, unknown>[],
  profileContext: null as Record<string, unknown> | null,
  membershipsCached: false,
  membershipsServerConfirmed: false,
  activeRole: null as "admin" | "driver" | null,
  activeCompanyId: null as string | null,
});

const readBootSessionSnapshot = () => {
  try {
    const uid = String(localStorage.getItem(SESSION_UID_KEY) || "").trim();
    if (!uid) return emptyBootSessionSnapshot();

    const atomicSnapshot = readOfflineSessionSnapshot(uid);
    const storedRole = localStorage.getItem(sessionActiveRoleKey(uid));
    const storedCompanyId = localStorage.getItem(sessionActiveCompanyKey(uid));
    const cachedUser = atomicSnapshot?.user
      ? normalizeAuthenticatedUser(atomicSnapshot.user, uid)
      : readCachedSessionUser(uid);
    const cachedMemberships = atomicSnapshot
      ? atomicSnapshot.memberships
          .map((membership) =>
            normalizeCompanyMember(
              membership,
              String(membership.id || `cached-${membership.companyId}`),
            ),
          )
          .filter((membership) => membership.userId === uid && Boolean(membership.companyId))
      : readCachedMemberships(uid);

    return {
      uid,
      user: cachedUser,
      memberships: cachedMemberships,
      companies: atomicSnapshot?.companies || [],
      simulators: atomicSnapshot?.simulators || [],
      profileContext: atomicSnapshot?.profileContext || null,
      membershipsCached: Boolean(atomicSnapshot) || hasCachedMembershipSnapshot(uid),
      membershipsServerConfirmed:
        !atomicSnapshot && hasFreshServerConfirmedMemberships(uid),
      activeRole:
        atomicSnapshot?.activeRole ||
        (storedRole === "admin" || storedRole === "driver" ? storedRole : null),
      activeCompanyId: atomicSnapshot?.activeCompanyId || storedCompanyId || null,
    };
  } catch {
    return emptyBootSessionSnapshot();
  }
};

const writeCachedMemberships = (uid: string, memberships: CompanyMember[]) => {
  try {
    localStorage.setItem(
      sessionMembershipCacheKey(uid),
      JSON.stringify({
        uid,
        memberships: memberships.map((membership) =>
          normalizeCompanyMember(
            membership as unknown as Record<string, unknown>,
            membership.id || `cached-${membership.companyId}`,
          ),
        ),
        cachedAt: Date.now(),
      }),
    );
  } catch {
    // Best-effort cache only.
  }
};

const clearCachedSession = (uid?: string | null) => {
  try {
    const targetUid = uid || localStorage.getItem(SESSION_UID_KEY);
    if (targetUid) {
      localStorage.removeItem(sessionUserCacheKey(targetUid));
      localStorage.removeItem(sessionMembershipCacheKey(targetUid));
      localStorage.removeItem(sessionMembershipConfirmationKey(targetUid));
      localStorage.removeItem(sessionActiveCompanyKey(targetUid));
      localStorage.removeItem(sessionActiveRoleKey(targetUid));
    }
    localStorage.removeItem(SESSION_UID_KEY);
  } catch {
    // Best-effort cleanup only.
  }
};

const clearAllPrivateClientCaches = () => {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (
        key &&
        (key.startsWith("nvu.session.") ||
          key.startsWith("nvu.ranking.snapshot.") ||
          key.startsWith("nvu.persisted.v2.operational.") ||
          key.startsWith("nvu.persisted.v2.driver-trips.") ||
          key.startsWith("nvu.persisted.v2.active-operation."))
      ) {
        keys.push(key);
      }
    }
    keys.forEach((key) => localStorage.removeItem(key));
    localStorage.removeItem("activeCompanyId");
    localStorage.removeItem("activeRole");
  } catch {
    // Best-effort cleanup only.
  }
};

const waitForSessionRetry = (delayMs: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
const withSessionTimeout = <T,>(
  operation: () => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  let timeoutId: number | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(
      () => reject(new Error(label)),
      timeoutMs,
    );
  });
  return Promise.race([operation(), timeout]).finally(() => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  });
};
const isRecoverableSessionError = (error: unknown) => {
  const code = String((error as { code?: unknown })?.code || "").toLowerCase();
  return (
    !code ||
    code.includes("unavailable") ||
    code.includes("deadline-exceeded") ||
    code.includes("network-request-failed") ||
    code.includes("cancelled")
  );
};

const runSessionReadWithRetry = async <T,>(
  operation: () => Promise<T>,
  firebaseUser: { getIdToken: (forceRefresh?: boolean) => Promise<string> },
  attempts = 3,
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRecoverableSessionError(error) || attempt === attempts - 1) throw error;
      try {
        await firebaseUser.getIdToken(attempt > 0);
      } catch {
        // The next Firestore attempt still has a chance to use cached data.
      }
      await waitForSessionRetry(300 * 2 ** attempt);
    }
  }
  throw lastError;
};

const recoverApprovedCompanyOwnerPhoto = async (
  userId: string,
  email?: string,
): Promise<string> => {
  if (isAuthTeardownActive() || auth.currentUser?.uid !== userId) return "";
  const registrations = new Map<string, Record<string, unknown>>();

  const byUserId = await getDocs(
    query(
      collection(db, "recruitment_applications"),
      where("userId", "==", userId),
    ),
  );
  byUserId.docs.forEach((registrationDoc) =>
    registrations.set(registrationDoc.id, registrationDoc.data()),
  );

  if (email && auth.currentUser?.emailVerified) {
    if (isAuthTeardownActive() || auth.currentUser?.uid !== userId) return "";
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail) {
      const byEmail = await getDocs(
        query(
          collection(db, "recruitment_applications"),
          where("email", "==", normalizedEmail),
        ),
      );
      byEmail.docs.forEach((registrationDoc) =>
        registrations.set(registrationDoc.id, registrationDoc.data()),
      );
    }
  }

  const ownerPhoto = resolveApprovedCompanyOwnerPhoto(
    Array.from(registrations.values()),
  );
  if (!ownerPhoto) return "";

  if (isAuthTeardownActive() || auth.currentUser?.uid !== userId) return "";

  await setDoc(
    doc(db, "users", userId),
    {
      profilePhotoURL: ownerPhoto,
      profilePhotoRecoveredAt: new Date().toISOString(),
    },
    { merge: true },
  );

  return ownerPhoto;
};

const MAX_PENDING_REQUESTS = 100;

type OperationalReadiness = {
  vehicles: boolean;
  trailers: boolean;
  contracts: boolean;
  sequences: boolean;
  jobs: boolean;
  demands: boolean;
  users: boolean;
};

const EMPTY_OPERATIONAL_READINESS: OperationalReadiness = {
  vehicles: false,
  trailers: false,
  contracts: false,
  sequences: false,
  jobs: false,
  demands: false,
  users: false,
};

type OperationalScopeSnapshot = {
  cachedAt: number;
  restoredFromSession?: boolean;
  users?: User[];
  vehicles?: Vehicle[];
  trailers?: Trailer[];
  contracts?: Contract[];
  sequences?: Sequence[];
  jobs?: Job[];
  jobDemands?: JobDemand[];
};

const OPERATIONAL_SCOPE_SESSION_VERSION = "v3-public-profiles";
const OPERATIONAL_SCOPE_SESSION_PREFIX =
  `nvu.persisted.${OPERATIONAL_SCOPE_SESSION_VERSION}.operational.`;
const operationalScopeCache = new Map<string, OperationalScopeSnapshot>();
const operationalScopePersistTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();

const buildOperationalScopeKey = (
  uid: string,
  companyId: string | null,
  role: Role | null,
) => `${uid}|${companyId || "none"}|${role || "none"}`;

const operationalScopeSessionKey = (key: string) =>
  `${OPERATIONAL_SCOPE_SESSION_PREFIX}${encodeURIComponent(key)}`;

const readPersistedOperationalScopeSnapshot = (
  key: string,
): OperationalScopeSnapshot | null => {
  try {
    const raw = localStorage.getItem(operationalScopeSessionKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OperationalScopeSnapshot;
    if (
      !parsed ||
      !isValidCacheTimestamp(parsed.cachedAt)
    ) {
      localStorage.removeItem(operationalScopeSessionKey(key));
      return null;
    }
    return {
      ...parsed,
      restoredFromSession: true,
    };
  } catch {
    return null;
  }
};

const compactOperationalSnapshot = (
  snapshot: OperationalScopeSnapshot,
): OperationalScopeSnapshot => {
  const sortByRecent = <T extends { createdAt?: string; assignedAt?: string }>(
    items: T[],
  ) =>
    [...items].sort((a, b) => {
      const aActive = isOpenJobStatus((a as any).status);
      const bActive = isOpenJobStatus((b as any).status);
      if (aActive !== bActive) return aActive ? -1 : 1;
      const aTime = new Date(a.assignedAt || a.createdAt || 0).getTime() || 0;
      const bTime = new Date(b.assignedAt || b.createdAt || 0).getTime() || 0;
      return bTime - aTime;
    });

  const jobs = snapshot.jobs
    ? (() => {
        const sortedJobs = sortByRecent(snapshot.jobs);
        const activeJobs = sortedJobs.filter((job) =>
          isOpenJobStatus(job.status),
        );
        const recentInactiveJobs = sortedJobs
          .filter(
            (job) => !isOpenJobStatus(job.status),
          )
          .slice(0, 80);
        return [...activeJobs, ...recentInactiveJobs];
      })()
    : undefined;
  const referencedContractIds = new Set(
    (jobs || []).map((job) => String(job.contractId || "")).filter(Boolean),
  );
  const referencedVehicleIds = new Set(
    (jobs || []).map((job) => String(job.vehicleId || "")).filter(Boolean),
  );
  const referencedTrailerIds = new Set(
    (jobs || [])
      .map((job) => String(job.trailerId || ""))
      .filter(Boolean),
  );

  const prioritizeReferenced = <T extends { id: string }>(
    items: T[] | undefined,
    referenced: Set<string>,
    max: number,
  ) => {
    if (!items) return undefined;
    return [...items]
      .sort((a, b) => {
        const aReferenced = referenced.has(String(a.id));
        const bReferenced = referenced.has(String(b.id));
        return aReferenced === bReferenced ? 0 : aReferenced ? -1 : 1;
      })
      .slice(0, max);
  };

  return {
    cachedAt: snapshot.cachedAt,
    jobs,
    contracts: prioritizeReferenced(
      snapshot.contracts,
      referencedContractIds,
      120,
    ),
    vehicles: prioritizeReferenced(
      snapshot.vehicles,
      referencedVehicleIds,
      100,
    ),
    trailers: prioritizeReferenced(
      snapshot.trailers,
      referencedTrailerIds,
      100,
    ),
    sequences: snapshot.sequences?.slice(0, 120),
    jobDemands: snapshot.jobDemands?.slice(0, 50),
    users: snapshot.users?.slice(0, 160),
  };
};

const cancelPendingOperationalScopePersistence = () => {
  operationalScopePersistTimers.forEach((timer) => clearTimeout(timer));
  operationalScopePersistTimers.clear();
};

const schedulePersistOperationalScopeSnapshot = (
  key: string,
  snapshot: OperationalScopeSnapshot,
) => {
  const currentTimer = operationalScopePersistTimers.get(key);
  if (currentTimer) clearTimeout(currentTimer);

  const timer = setTimeout(() => {
    operationalScopePersistTimers.delete(key);
    try {
      localStorage.setItem(
        operationalScopeSessionKey(key),
        JSON.stringify(compactOperationalSnapshot(snapshot)),
      );
    } catch {
      // Session cache is a best-effort acceleration only.
    }
  }, 80);
  operationalScopePersistTimers.set(key, timer);
};

const readOperationalScopeSnapshot = (key: string) => {
  let snapshot = operationalScopeCache.get(key);
  if (!snapshot) {
    snapshot = readPersistedOperationalScopeSnapshot(key) || undefined;
    if (snapshot) operationalScopeCache.set(key, snapshot);
  }
  if (!snapshot) return null;
  return snapshot;
};

const mergeOperationalScopeSnapshot = (
  key: string,
  patch: Partial<Omit<OperationalScopeSnapshot, "cachedAt">>,
) => {
  const current = readOperationalScopeSnapshot(key);
  const next: OperationalScopeSnapshot = {
    ...(current || { cachedAt: Date.now() }),
    ...patch,
    restoredFromSession: false,
    cachedAt: Date.now(),
  };
  operationalScopeCache.set(key, next);
  schedulePersistOperationalScopeSnapshot(key, next);
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // Rehydrate the last validated session synchronously. Firebase remains the
  // authority and replaces/clears this snapshot as soon as Auth resolves, but
  // cached private data is exposed only when Firebase has already confirmed the
  // same UID. This prevents a previous account from flashing inside public
  // registration screens while Auth is still restoring its session.
  const bootSession = useMemo(() => readBootSessionSnapshot(), []);
  const [foregroundPathname, setForegroundPathname] = useState(() =>
    getForegroundPathname(),
  );
  const interactionFirstRoute = isInteractionFirstRoute(foregroundPathname);
  const suspendCompanyScopedRealtime = canSuspendCompanyScopedRealtime(
    foregroundPathname,
  );

  useLayoutEffect(() => {
    if (!interactionFirstRoute) return;
    // Operational cache persistence uses JSON.stringify on potentially large
    // arrays. A timer scheduled by the previous workspace could otherwise fire
    // after SelectProfile is already visible and block the next touch.
    cancelPendingOperationalScopePersistence();
  }, [interactionFirstRoute]);
  // A UID-scoped snapshot is a visual warm-start boundary. Firebase remains the
  // authority for protected actions through sessionAuthorized; the warm boot only
  // prevents a known session from being rebuilt as a public first login on a cold
  // WebView start.
  const bootSessionUid = String(bootSession.uid || "").trim() || null;
  const verifiedBootUid =
    auth.currentUser?.uid && auth.currentUser.uid === bootSessionUid
      ? auth.currentUser.uid
      : null;
  const visualBootUid = bootSessionUid;
  const [currentUser, setCurrentUser] = useState<User | null>(() =>
    visualBootUid ? bootSession.user : null,
  );
  const [authInitialized, setAuthInitialized] = useState(
    () => Boolean(verifiedBootUid || (visualBootUid && bootSession.user)),
  );
  const [firebaseSessionUid, setFirebaseSessionUid] = useState<string | null>(
    auth.currentUser?.uid || null,
  );
  // A recent server-confirmed snapshot for the same Firebase UID enables an
  // instant warm boot. Ordinary cache remains presentation-only and cannot
  // authorize a protected route.
  const [membershipsLoaded, setMembershipsLoaded] = useState(
    () => Boolean(visualBootUid && bootSession.membershipsServerConfirmed),
  );
  const [membershipsUiReady, setMembershipsUiReady] = useState(
    () => Boolean(visualBootUid && bootSession.membershipsCached),
  );
  const [memberships, setMemberships] = useState<CompanyMember[]>(
    () => (visualBootUid ? bootSession.memberships : []),
  );
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(() => {
    if (!visualBootUid) return null;
    if (bootSession.activeCompanyId) return bootSession.activeCompanyId;

    const seniorAccess = readSessionStorageValue("seniorAccess") === "true";
    const storedSeniorCompanyId = readSessionStorageValue("seniorCompanyId");
    return seniorAccess ? storedSeniorCompanyId : null;
  });
  // Este estado controla somente a interface. A autorização real é validada
  // pelo custom claim do Firebase e refletida no documento canônico do usuário.
  const [isSeniorAuthenticated, setIsSeniorAuthenticated] = useState(false);
  const [seniorCompanyId, setSeniorCompanyId] = useState<string | null>(() =>
    readSessionStorageValue("seniorCompanyId"),
  );
  const profilePhotoRepairAttemptedRef = useRef<Set<string>>(new Set());
  const deferredPhotoWarmSignatureRef = useRef("");
  const offlineSnapshotSignatureRef = useRef("");

  // Logout is a controlled teardown. These refs let us stop authenticated
  // Firestore listeners before Firebase Auth revokes the session, avoiding the
  // transient permission-denied errors seen in embedded previews/WebViews.
  const isLoggingOutRef = useRef(false);
  const userDocumentUnsubscribeRef = useRef<(() => void) | null>(null);
  const membershipsUnsubscribeRef = useRef<(() => void) | null>(null);
  const privateSubscriptionsUnsubscribeRef = useRef<(() => void) | null>(null);
  const privateSubscriptionsGenerationRef = useRef(0);
  const priorityContractLoadsRef = useRef<Map<string, Promise<void>>>(new Map());
  const priorityContractResolvedRef = useRef<Set<string>>(new Set());
  const priorityAssetLoadsRef = useRef<Map<string, Promise<void>>>(new Map());
  const priorityAssetResolvedRef = useRef<Set<string>>(new Set());
  // Shared company data (users, vehicles, contracts and members) remains
  // valid across an admin <-> driver switch inside the same company. Keep it
  // visible while role-specific listeners reconnect so the destination does
  // not flash empty or wait for a second round of snapshots.
  const privateDataScopeRef = useRef<{
    uid: string;
    companyId: string | null;
    role: Role | null;
  } | null>(null);
  const currentUserRef = useRef<User | null>(null);
  const membershipsRef = useRef<CompanyMember[]>([]);
  // Ephemeral only: keeps the previous same-UID selector visible during
  // logoff/login while the new server snapshot is revalidated. It is never
  // written to storage and never satisfies sessionReady by itself.
  const reauthMembershipsRef = useRef<{
    uid: string;
    memberships: CompanyMember[];
  } | null>(null);
  // A confirmed snapshot remains valid while the same Auth generation is
  // revalidated after resume/online. This prevents a background refresh from
  // turning an already-authorized profile into a blocking spinner.
  const confirmedMembershipsRef = useRef<{
    uid: string;
    sessionGeneration: number;
    memberships: CompanyMember[];
  } | null>(
    visualBootUid && bootSession.membershipsServerConfirmed
      ? {
          uid: visualBootUid,
          sessionGeneration: 0,
          memberships: bootSession.memberships,
        }
      : null,
  );
  const authObserverGenerationRef = useRef(0);
  // UID alone is not enough: logout/login with the same Google account must
  // invalidate every async callback from the previous session generation.
  const authSessionGenerationRef = useRef(0);
  const membershipEffectGenerationRef = useRef(0);
  const lastSessionRefreshAtRef = useRef(0);
  const sessionHiddenAtRef = useRef<number | null>(null);
  const [sessionRecovering, setSessionRecovering] = useState(false);
  const [sessionRefreshEpoch, setSessionRefreshEpoch] = useState(0);
  const [identityReconciliationStatus, setIdentityReconciliationStatus] =
    useState<"idle" | "pending" | "complete" | "failed">("idle");
  const [sessionDiagnostic, setSessionDiagnostic] = useState<SessionDiagnostic | null>(
    () => readPersistedSessionDiagnostic(),
  );
  const sessionDiagnosticGenerationRef = useRef(0);
  const sessionDiagnosticKeyRef = useRef("");
  const publishSessionDiagnostic = useStableEvent(
    (
      code: SessionDiagnosticCode,
      uid: string | null | undefined,
      generation: number,
      detail?: string,
    ) => {
      const key = `${code}|${uid || ""}|${generation}|${detail || ""}`;
      if (sessionDiagnosticKeyRef.current === key) return;
      const diagnostic = createSessionDiagnostic(code, uid, generation, detail);
      sessionDiagnosticKeyRef.current = key;
      sessionDiagnosticGenerationRef.current = generation;
      setSessionDiagnostic(diagnostic);
      persistSessionDiagnostic(diagnostic);
    },
  );

  useEffect(() => {
    const handleForegroundRoute = (event: Event) => {
      const routeEvent = event as CustomEvent<string>;
      const nextPathname = String(
        routeEvent.detail || getForegroundPathname(),
      ).trim();
      if (!nextPathname) return;
      setForegroundPathname((current) =>
        current === nextPathname ? current : nextPathname,
      );
    };

    window.addEventListener(NVU_FOREGROUND_ROUTE_EVENT, handleForegroundRoute);
    return () =>
      window.removeEventListener(
        NVU_FOREGROUND_ROUTE_EVENT,
        handleForegroundRoute,
      );
  }, []);

  const canProcessAuthenticatedCallback = (
    expectedUid?: string,
    expectedSessionGeneration?: number,
  ) =>
    !isLoggingOutRef.current &&
    !isAuthTeardownActive() &&
    Boolean(auth.currentUser) &&
    (!expectedUid || auth.currentUser?.uid === expectedUid) &&
    (expectedSessionGeneration === undefined ||
      authSessionGenerationRef.current === expectedSessionGeneration);

  const [activeRole, setActiveRole] = useState<Role | null>(() =>
    visualBootUid ? (bootSession.activeRole as Role | null) : null,
  );

  const hasVerifiedSeniorRole = Boolean(
    (currentUser as any)?.role === "senior" ||
      (Array.isArray((currentUser as any)?.roles) &&
        (currentUser as any).roles.includes("senior")),
  );
  // The Firebase custom claim is the authorization source of truth for the
  // Senior workspace. `currentUser.role/roles` is only a Firestore profile
  // projection and can legitimately still be `admin` after the claim has been
  // granted. Treat a claim-confirmed Senior session as Senior here as well;
  // Firestore Rules continue to enforce the claim on every protected read/write.
  const hasSeniorPanelAccess =
    hasVerifiedSeniorRole || isSeniorAuthenticated;

  const [globalPeriodPreset, setGlobalPeriodPreset] = useState<"semana" | "mes" | "custom">("mes");
  const [globalStartDateStr, setGlobalStartDateStr] = useState<string>("");
  const [globalEndDateStr, setGlobalEndDateStr] = useState<string>("");

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    membershipsRef.current = memberships;
  }, [memberships]);

  const refreshSession = (reason = "manual") => {
    if (isLoggingOutRef.current || isAuthTeardownActive() || !auth.currentUser) return;
    const confirmed = confirmedMembershipsRef.current;
    if (!needsSessionReconnect({
      manual: reason === "manual", uid: auth.currentUser.uid, profileUid: currentUserRef.current?.id,
      userListenerConnected: Boolean(userDocumentUnsubscribeRef.current),
      membershipListenerConnected: Boolean(membershipsUnsubscribeRef.current),
      membershipConfirmed: confirmed?.uid === auth.currentUser.uid && confirmed.sessionGeneration === authSessionGenerationRef.current,
    })) return; // The SDK resumes healthy live listeners without new reads or UI gates.
    // Android resume/online events used to rebuild the auth + user + membership
    // listener graph while SelectProfile was already interactive. That work can
    // deserialize Firestore snapshots and block the same main thread used by a
    // tap. The live listeners already keep these lightweight screens current,
    // so automatic recovery is deferred until an operational route.
    if (reason !== "manual" && isInteractionFirstRoute(getForegroundPathname())) {
      return;
    }
    const now = Date.now();
    const minimumIntervalMs =
      reason === "manual"
        ? 0
        : reason === "online"
          ? 5_000
          : 15_000;
    if (now - lastSessionRefreshAtRef.current < minimumIntervalMs) return;
    lastSessionRefreshAtRef.current = now;
    setSessionRecovering(true);
    setSessionRefreshEpoch((value) => value + 1);
  };

  /**
   * Confirm the post-reconciliation authorization snapshot from Firestore's
   * server, not from a local cache. This is deliberately separate from the
   * realtime listener: the identity migration may commit a membership between
   * listener generations, and Login must not navigate on an empty pre-migration
   * snapshot. The returned records are still authorized only by companyMembers
   * whose userId exactly equals the current Firebase UID.
   */
  const confirmCanonicalMemberships = async (expectedUid?: string) => {
    const expectedSessionGeneration = authSessionGenerationRef.current;
    const uid =
      expectedUid || auth.currentUser?.uid || currentUserRef.current?.id || "";
    if (!uid || !auth.currentUser || auth.currentUser.uid !== uid) {
      throw new Error("Sessão Firebase inválida durante a confirmação de vínculo.");
    }

    const canonicalQuery = query(
      collection(db, "companyMembers"),
      where("userId", "==", uid),
    );

    const snapshot = await withSessionTimeout(
      () => getDocsFromServer(canonicalQuery),
      12_000,
      "membership-server-confirmation-timeout",
    );
      if (!canProcessAuthenticatedCallback(uid, expectedSessionGeneration)) {
        throw new Error("A conta autenticada mudou durante a confirmação de vínculo.");
      }
      const confirmedMemberships = snapshot.docs.map((membershipDocument) =>
        normalizeCompanyMember(
          membershipDocument.data() as Record<string, unknown>,
          membershipDocument.id,
        ),
      );
      membershipsRef.current = confirmedMemberships;
      setMemberships(confirmedMemberships);
      writeCachedMemberships(uid, confirmedMemberships);
      markServerConfirmedMemberships(uid);
      setMembershipsLoaded(true);
      setSessionRecovering(false);
      publishSessionDiagnostic(
        confirmedMemberships.length > 0
          ? "MEMBERSHIP_SERVER_FOUND"
          : "MEMBERSHIP_SERVER_EMPTY",
        uid,
        expectedSessionGeneration,
        `serverCount=${confirmedMemberships.length}|manual-confirmation`,
      );
      return confirmedMemberships;
  };

  useEffect(() => {
    const handleOnline = () => refreshSession("online");
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        sessionHiddenAtRef.current = Date.now();
        return;
      }

      const hiddenAt = sessionHiddenAtRef.current;
      sessionHiddenAtRef.current = null;
      // A quick tab/devtools focus change does not invalidate Firebase Auth.
      // Rebuilding every listener after those short interruptions caused
      // visible mobile work and duplicate reads inside AI Studio Preview.
      if (hiddenAt && Date.now() - hiddenAt >= 12_000) {
        refreshSession("visible");
      }
    };
    const handleRequestedRefresh = () => refreshSession("app-resume");

    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("nvu-session-refresh", handleRequestedRefresh);
    return () => {
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("nvu-session-refresh", handleRequestedRefresh);
    };
  }, []);

  // Observe auth state and rebuild the application session after refreshes,
  // deploys and Android WebView resumes.
  useEffect(() => {
    let unsubDoc: (() => void) | undefined;
    let fallbackTimer: number | undefined;
    let disposed = false;
    let persistenceSettled = false;
    let nativeSessionRestoreSettled = false;
    let pendingSignedOutGeneration: number | null = null;
    const generation = ++authObserverGenerationRef.current;

    const isCurrentGeneration = (
      uid?: string,
      expectedSessionGeneration?: number,
    ) =>
      !disposed &&
      generation === authObserverGenerationRef.current &&
      (!uid || canProcessAuthenticatedCallback(uid, expectedSessionGeneration));

    const stopUserDocumentListener = () => {
      if (fallbackTimer !== undefined) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = undefined;
      }
      if (unsubDoc) {
        unsubDoc();
        if (userDocumentUnsubscribeRef.current === unsubDoc) {
          userDocumentUnsubscribeRef.current = null;
        }
        unsubDoc = undefined;
      }
    };

    const commitUserDocument = (
      firebaseUser: NonNullable<typeof auth.currentUser>,
      raw: Record<string, unknown>,
      id: string,
      expectedSessionGeneration: number,
    ) => {
      if (!isCurrentGeneration(firebaseUser.uid, expectedSessionGeneration)) return;
      const data = normalizeAuthenticatedUser(raw, id);
      currentUserRef.current = data;
      setCurrentUser(data);
      writeCachedSessionUser(data);
      setAuthInitialized(true);
      setSessionRecovering(false);

      const resolvedProfilePhoto = resolvePersistedUserProfilePhoto(data);
      if (
        !resolvedProfilePhoto &&
        !isInteractionFirstRoute(getForegroundPathname()) &&
        !profilePhotoRepairAttemptedRef.current.has(firebaseUser.uid)
      ) {
        profilePhotoRepairAttemptedRef.current.add(firebaseUser.uid);
        void recoverApprovedCompanyOwnerPhoto(
          firebaseUser.uid,
          data.email || firebaseUser.email || undefined,
        ).catch((photoRecoveryError) => {
          console.warn(
            "[NVU Profile Photo] Approved owner photo recovery failed:",
            photoRecoveryError,
          );
        });
      }
    };

    const recoverUserDocument = async (
      firebaseUser: NonNullable<typeof auth.currentUser>,
      source: string,
      expectedSessionGeneration: number,
    ) => {
      try {
        const userDocument = await runSessionReadWithRetry(
          () => getDoc(doc(db, "users", firebaseUser.uid)),
          firebaseUser,
        );
        if (!isCurrentGeneration(firebaseUser.uid, expectedSessionGeneration)) return;
        if (userDocument.exists()) {
          commitUserDocument(
            firebaseUser,
            userDocument.data(),
            userDocument.id,
            expectedSessionGeneration,
          );
          return;
        }

        // A new Google login can briefly precede user-document unification.
        // Keep the cached identity while the next auth/profile cycle retries.
        const cachedUser = readCachedSessionUser(firebaseUser.uid);
        if (cachedUser) {
          currentUserRef.current = cachedUser;
          setCurrentUser(cachedUser);
        } else if (currentUserRef.current?.id !== firebaseUser.uid) {
          setCurrentUser(null);
        }
        setAuthInitialized(true);
        setSessionRecovering(false);
      } catch (error) {
        if (!isCurrentGeneration(firebaseUser.uid, expectedSessionGeneration)) return;
        console.warn(`[NVU Session] Falha ao reidratar usuário (${source}).`, error);
        const cachedUser = readCachedSessionUser(firebaseUser.uid);
        if (cachedUser) {
          currentUserRef.current = cachedUser;
          setCurrentUser(cachedUser);
        }
        // Never erase a valid authenticated UI because of a transient
        // Firestore/token failure. A resume/online event will retry.
        setAuthInitialized(true);
        setSessionRecovering(false);
      }
    };

    const finalizeSignedOut = (sessionGeneration: number) => {
      if (disposed || generation !== authObserverGenerationRef.current) return;
      setFirebaseSessionUid(null);
      setIdentityReconciliationStatus("idle");
      publishSessionDiagnostic(
        isLoggingOutRef.current ? "LOGOUT_COMPLETE" : "AUTH_SIGNED_OUT",
        null,
        sessionGeneration,
      );
      if (!isLoggingOutRef.current) endAuthTeardown();
      userDocumentUnsubscribeRef.current = null;
      currentUserRef.current = null;
      membershipsRef.current = [];

      setCurrentUser(null);
      setActiveCompanyId(null);
      setActiveRole(null);
      setIsSeniorAuthenticated(false);
      setSeniorCompanyId(null);
      setMemberships([]);
      setMembershipsUiReady(true);
      setAllCompanyMembers([]);
      setUsers([]);
      setFetchedMissingUsers([]);
      setVehicles([]);
      setTrailers([]);
      setContracts([]);
      setSequences([]);
      setJobs([]);
      setJobDemands([]);
      setDriverRequests([]);
      setRecruitmentApplications([]);
      setMembershipsLoaded(true);
      setSessionRecovering(false);

      clearAllPrivateClientCaches();
      clearSessionStorage();
      setAuthInitialized(true);
    };

    let unsubAuth: (() => void) | undefined;
    const attachAuthListener = () => {
      unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
      stopUserDocumentListener();
      const sessionGeneration = nextSessionGeneration(currentUserRef.current?.id || null, firebaseUser?.uid || null, authSessionGenerationRef.current);
      authSessionGenerationRef.current = sessionGeneration;

      if (firebaseUser) {
        const bootConfirmedSnapshot = confirmedMembershipsRef.current;
        if (
          bootConfirmedSnapshot &&
          bootConfirmedSnapshot.uid === firebaseUser.uid &&
          bootConfirmedSnapshot.sessionGeneration === 0
        ) {
          confirmedMembershipsRef.current = {
            ...bootConfirmedSnapshot,
            sessionGeneration,
          };
        }
        const reauthDecision = resolveReauthMemberships(
          reauthMembershipsRef.current,
          firebaseUser.uid,
        );
        if (reauthDecision.sameUid) {
          membershipsRef.current = reauthDecision.memberships;
          setMemberships(reauthDecision.memberships);
          setMembershipsUiReady(reauthDecision.memberships.length > 0);
        } else if (reauthDecision.shouldClearPrevious) {
          // A different account must never see the previous account's
          // presentation snapshot, even for one render.
          membershipsRef.current = [];
          setMemberships([]);
          setMembershipsUiReady(false);
        }
        reauthMembershipsRef.current = null;
        setFirebaseSessionUid(firebaseUser.uid);
        setIdentityReconciliationStatus("pending");
        publishSessionDiagnostic(
          "AUTH_UID_CONFIRMED",
          firebaseUser.uid,
          sessionGeneration,
        );
        publishSessionDiagnostic(
          "IDENTITY_RECONCILIATION_PENDING",
          firebaseUser.uid,
          sessionGeneration,
          "auth-observer",
        );
        if (!isLoggingOutRef.current) endAuthTeardown();

        const previousUid = readLocalStorageValue(SESSION_UID_KEY);
        const isSameAccount = previousUid === firebaseUser.uid;
        if (previousUid && !isSameAccount) {
          clearAllPrivateClientCaches();
          setActiveCompanyId(null);
          setActiveRole(null);
          setMemberships([]);
          membershipsRef.current = [];
          setMembershipsLoaded(false);
          setMembershipsUiReady(false);
        }

        const legacyActiveCompanyId = isSameAccount
          ? readLocalStorageValue("activeCompanyId")
          : null;
        const legacyActiveRole = isSameAccount
          ? readLocalStorageValue("activeRole")
          : null;
        const restoredCompanyId =
          readLocalStorageValue(sessionActiveCompanyKey(firebaseUser.uid)) ||
          legacyActiveCompanyId;
        const restoredRoleValue =
          readLocalStorageValue(sessionActiveRoleKey(firebaseUser.uid)) ||
          legacyActiveRole;

        setActiveCompanyId(restoredCompanyId || null);
        setActiveRole(
          restoredRoleValue === "admin" || restoredRoleValue === "driver"
            ? restoredRoleValue
            : null,
        );
        if (restoredCompanyId) {
          writeLocalStorageValue(
            sessionActiveCompanyKey(firebaseUser.uid),
            restoredCompanyId,
          );
        }
        if (restoredRoleValue === "admin" || restoredRoleValue === "driver") {
          writeLocalStorageValue(
            sessionActiveRoleKey(firebaseUser.uid),
            restoredRoleValue,
          );
        }
        removeLocalStorageValue("activeCompanyId");
        removeLocalStorageValue("activeRole");
        writeLocalStorageValue(SESSION_UID_KEY, firebaseUser.uid);

        const cachedUser = readCachedSessionUser(firebaseUser.uid);
        const alreadyHydrated = currentUserRef.current?.id === firebaseUser.uid;
        if (!alreadyHydrated && cachedUser) {
          currentUserRef.current = cachedUser;
          setCurrentUser(cachedUser);
        } else if (!alreadyHydrated && !cachedUser) {
          // Firebase Auth is already authoritative for identity. This minimal
          // fallback starts membership rehydration without trusting a stored
          // company or admin role; the user document replaces it shortly.
          const identityFallback = createFirebaseIdentityFallback(firebaseUser);
          currentUserRef.current = identityFallback;
          setCurrentUser(identityFallback);
        }

        // During same-account recovery keep the current interface mounted.
        setAuthInitialized(true);
        setSessionRecovering(true);

        setIsSeniorAuthenticated(false);

        console.log("[NVU Session] Firebase user detected:", firebaseUser.uid);
        // Identity reconciliation belongs to the Auth boundary, not to the
        // Login page. It runs once per observer generation and never blocks the
        // selector; companyMembers remains the only authorization authority.
        let identityTimeout: number | undefined;
        const identityReconciliation = new Promise<Awaited<ReturnType<typeof unifyUserDocument>>>((resolve, reject) => {
          identityTimeout = window.setTimeout(
            () => reject(new Error("identity-reconciliation-timeout")),
            12_000,
          );
          void unifyUserDocument(firebaseUser).then(resolve, reject);
        });
        void identityReconciliation
          .then(() => {
            if (!isCurrentGeneration(firebaseUser.uid, sessionGeneration)) return;
            setIdentityReconciliationStatus("complete");
            publishSessionDiagnostic(
              "IDENTITY_RECONCILIATION_COMPLETE",
              firebaseUser.uid,
              sessionGeneration,
            );
          })
          .catch((identityError) => {
            if (!isCurrentGeneration(firebaseUser.uid, sessionGeneration)) return;
            console.warn("[NVU Identity] Reconciliation deferred.", identityError);
            setIdentityReconciliationStatus("failed");
            setSessionRecovering(false);
            publishSessionDiagnostic(
              "IDENTITY_RECONCILIATION_FAILED",
              firebaseUser.uid,
              sessionGeneration,
              identityError instanceof Error
                ? identityError.message
                : String(identityError),
            );
          })
          .finally(() => {
            if (identityTimeout !== undefined) window.clearTimeout(identityTimeout);
          });
        let listenerHydrated = false;
        try {
          const unsubscribeUserDocument = onSnapshot(
            doc(db, "users", firebaseUser.uid),
            (userDocument) => {
              if (!isCurrentGeneration(firebaseUser.uid, sessionGeneration)) return;
              listenerHydrated = true;
              if (fallbackTimer !== undefined) {
                window.clearTimeout(fallbackTimer);
                fallbackTimer = undefined;
              }
              if (userDocument.exists()) {
                commitUserDocument(
                  firebaseUser,
                  userDocument.data(),
                  userDocument.id,
                  sessionGeneration,
                );
              } else {
                void recoverUserDocument(firebaseUser, "snapshot-empty", sessionGeneration);
              }
            },
            (error) => {
              if (!isCurrentGeneration(firebaseUser.uid, sessionGeneration)) return;
              console.warn("[NVU Session] User listener interrupted; recovering.", error);
              userDocumentUnsubscribeRef.current = null;
              void recoverUserDocument(firebaseUser, "snapshot-error", sessionGeneration);
            },
          );

          let userDocumentStopped = false;
          unsubDoc = () => {
            if (userDocumentStopped) return;
            userDocumentStopped = true;
            unsubscribeUserDocument();
          };
          userDocumentUnsubscribeRef.current = unsubDoc;

          fallbackTimer = window.setTimeout(() => {
            if (!listenerHydrated && isCurrentGeneration(firebaseUser.uid, sessionGeneration)) {
              void recoverUserDocument(firebaseUser, "snapshot-timeout", sessionGeneration);
            }
          }, 1400);
        } catch (error) {
          console.warn("[NVU Session] Could not attach user listener; recovering.", error);
          void recoverUserDocument(firebaseUser, "listener-attach", sessionGeneration);
        }
      } else {
        // Firebase can emit its initial null snapshot before the native
        // fallback has finished checking the Android session. Do not interpret
        // that transient state as an explicit logout or erase the warm-start
        // snapshot; finalize signed-out only after both hydration paths settle.
        if (!persistenceSettled || !nativeSessionRestoreSettled) {
          pendingSignedOutGeneration = sessionGeneration;
          return;
        }
        finalizeSignedOut(sessionGeneration);
      }
    });
    };

    // Attach the Web observer first. The native restore is only a fallback and
    // must never delay the first Firebase persistence callback or the Login /
    // SelectProfile decision.
    attachAuthListener();
    const settleDeferredSignedOut = () => {
      if (
        disposed ||
        !persistenceSettled ||
        !nativeSessionRestoreSettled ||
        pendingSignedOutGeneration === null ||
        auth.currentUser
      ) {
        return;
      }
      const pendingGeneration = pendingSignedOutGeneration;
      pendingSignedOutGeneration = null;
      finalizeSignedOut(pendingGeneration);
    };
    void authPersistenceReady.then(() => {
      persistenceSettled = true;
      settleDeferredSignedOut();
    });
    const nativeSessionRestore = restoreNativeGoogleSession()
      .then((restoredUser) => {
        if (restoredUser) {
          console.info("[NVU Auth] native session restored", {
            uid: restoredUser.uid,
          });
        }
      })
      .catch((error) => {
        console.warn("[NVU Auth] native session restore unavailable", error);
      })
      .finally(() => {
        nativeSessionRestoreSettled = true;
        settleDeferredSignedOut();
      });

    return () => {
      disposed = true;
      stopUserDocumentListener();
      void nativeSessionRestore;
      unsubAuth?.();
    };
  }, [sessionRefreshEpoch]);

  // Atualização dinâmica do contexto do Push Capacitor
  useEffect(() => {
    // Push registration may load a native plugin, install listeners and call the
    // bridge. It is not needed on the interaction-first selector/status screens.
    const currentForegroundPath = getForegroundPathname();
    if (
      interactionFirstRoute ||
      currentForegroundPath === "/login" ||
      currentForegroundPath === "/" ||
      !authInitialized ||
      !currentUser?.id ||
      auth.currentUser?.uid !== currentUser.id
    ) {
      return;
    }

    console.log('[NVU PUSH UPDATE] Atualizando contexto do dispositivo...');
    try {
      void registerDeviceForPush({
        userId: currentUser.id,
        companyId: activeCompanyId,
        activeProfile: activeRole || currentUser.role,
      });
    } catch (error) {
      console.warn("[NVU PUSH ERROR] Falha ao atualizar contexto do Push", error);
    }
  }, [
    authInitialized,
    currentUser?.id,
    activeCompanyId,
    activeRole,
    currentUser?.role,
    interactionFirstRoute,
  ]);

  const [users, setUsers] = useState<User[]>([]);
  const [fetchedMissingUsers, setFetchedMissingUsers] = useState<User[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [trailers, setTrailers] = useState<Trailer[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [serverJobs, setJobs] = useState<Job[]>([]);
  const [outboxRevision, setOutboxRevision] = useState(0);
  const jobs = useMemo(() => {
    if (activeRole !== "driver" || !currentUser?.id || !activeCompanyId) return serverJobs;
    try { return operationOutbox.project(serverJobs as any[], currentUser.id, activeCompanyId) as Job[]; }
    catch { return serverJobs; } // Never turn unavailable local storage into a blank workspace.
  },
    [serverJobs, currentUser?.id, activeRole, activeCompanyId, outboxRevision]);
  useEffect(() => {
    const refresh = (event: Event) => {
      if ((event as CustomEvent).detail?.uid === currentUser?.id) setOutboxRevision(revision => revision + 1);
    };
    try { if (currentUser?.id) operationOutbox.entries(currentUser.id); }
    catch { toast.error("Os comandos locais não puderam ser lidos. Os registros foram preservados; novas confirmações estão bloqueadas neste aparelho."); }
    window.addEventListener(OPERATION_OUTBOX_CHANGED, refresh);
    return () => window.removeEventListener(OPERATION_OUTBOX_CHANGED, refresh);
  }, [currentUser?.id]);
  const operationalCommandScopeRef = useRef("");
  useEffect(() => {
    const uid = currentUser?.id || "";
    if (!uid || activeRole !== "driver" || !activeCompanyId || auth.currentUser?.uid !== uid) return;
    try {
      presentConfirmedOperationResult({uid, companyId: activeCompanyId, entries: operationOutbox.entries(uid),
        contracts, trips: canonicalTripRepository.list(),
        acknowledge: entryId => operationOutbox.acknowledgeResultPresented(uid, entryId)});
    } catch (error) { console.warn("[NVU] Resultado confirmado será apresentado na retomada", error); }
  }, [currentUser?.id, activeRole, activeCompanyId, outboxRevision, contracts]);
  operationalCommandScopeRef.current = JSON.stringify([currentUser?.id, activeCompanyId, activeRole]);
  const assertOperationalCommandScope = (uid: string, scope: string) => {
    if (auth.currentUser?.uid !== uid || operationalCommandScopeRef.current !== scope) throw new Error("OPERATIONAL_COMMAND_SESSION_CHANGED");
  };
  const operationalAcknowledgements = useRef(new ManagedOperationAcknowledgementCache<Job>());
  operationalAcknowledgements.current.resetScope(operationalCommandScopeRef.current);
  const mergeManagedConfirmedJob = (job: Job): Job => operationalAcknowledgements.current.merge(job);

  const finishJobInFlightRef = useRef<Map<string, Promise<ConfirmedOperationCompletion>>>(new Map());
  const startJobInFlightRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!authInitialized || !currentUser?.id || !isSimpleAutomationNativeAvailable()) return;
    const refresh = () => {
      if (document.hidden) return;
      void reconcileCompletedOperationQueues().catch((error) =>
        console.warn("[NVU] limpeza de operações encerradas será retomada", error),
      );
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [authInitialized, currentUser?.id]);
  const [jobDemands, setJobDemands] = useState<JobDemand[]>([]);
  const [operationalReadiness, setOperationalReadiness] =
    useState<OperationalReadiness>(EMPTY_OPERATIONAL_READINESS);
  const [simulators, setSimulators] = useState<Simulator[]>(() => {
    const snapshotSimulators = bootSession.simulators
      .map(normalizeCachedSimulator)
      .filter((simulator): simulator is Simulator => Boolean(simulator));
    return snapshotSimulators.length > 0
      ? snapshotSimulators
      : readCachedSimulators();
  });
  const [simulatorsLoading, setSimulatorsLoading] = useState(true);
  const [simulatorsError, setSimulatorsError] = useState<string | null>(null);
  const {
    companies,
    setCompanies,
    companiesLoading,
    companyCatalogLoaded,
    companyCatalogAttempted,
    loadCompanyCatalog,
    loadCompanyById,
    primeCompanyProfile,
    companiesRef,
    companyCatalogLoadedRef,
  } = useCompanyDataController({
    authInitialized,
    currentUser,
    memberships,
    activeCompanyId,
    suspendedRealtime: suspendCompanyScopedRealtime,
  });

  useEffect(() => {
    if (isSeniorAuthenticated) {
      writeSessionStorageValue("isSeniorAuthenticated", "true");
    } else {
      removeSessionStorageValue("isSeniorAuthenticated");
    }
    if (seniorCompanyId) {
      writeSessionStorageValue("seniorCompanyId", seniorCompanyId);
    } else {
      removeSessionStorageValue("seniorCompanyId");
    }
  }, [isSeniorAuthenticated, seniorCompanyId]);

  useEffect(() => {
    const uid = firebaseSessionUid;
    if (!uid || currentUser?.id !== uid) return;

    if (activeCompanyId) {
      writeLocalStorageValue(sessionActiveCompanyKey(uid), activeCompanyId);
    } else {
      removeLocalStorageValue(sessionActiveCompanyKey(uid));
    }
    if (activeRole) {
      writeLocalStorageValue(sessionActiveRoleKey(uid), activeRole);
    } else {
      removeLocalStorageValue(sessionActiveRoleKey(uid));
    }
    // Generic keys belonged to older builds and were shared by every account.
    removeLocalStorageValue("activeCompanyId");
    removeLocalStorageValue("activeRole");
  }, [activeCompanyId, activeRole, currentUser?.id, firebaseSessionUid]);

  // --- Simulators Subscription ---
  // Firebase is the single source of truth.
  // No automatic creation, seed, or hardcoded simulators.
  const simulatorCatalogEnabled = !interactionFirstRoute && foregroundPathname !== "/login";
  useEffect(() => {
    // The simulator catalog is not needed to open Pending Applications. Stop
    // the listener before entering the selector so a network snapshot cannot
    // normalize the catalog and invalidate OperationalContext during a tap.
    // Existing simulator data remains in memory and the listener reconnects on
    // routes that actually consume the catalog.
    if (!simulatorCatalogEnabled) return;

    setSimulatorsLoading(true);
    setSimulatorsError(null);

    const unsub = onSnapshot(
      collection(db, "simulators"),
      (snap) => {
        const simulatorsData = normalizeSimulatorDocuments(
          snap.docs.map((simulatorDoc) => ({
            id: simulatorDoc.id,
            data: simulatorDoc.data(),
          })),
        ) as Simulator[];

        // An offline Firestore listener may emit an empty cache snapshot before
        // connectivity is known. Never let that transient empty result erase the
        // last validated simulator catalog required by Print/Pro offline work.
        if (snap.metadata.fromCache && simulatorsData.length === 0) {
          setSimulators((current) => current.length > 0 ? current : readCachedSimulators());
        } else {
          setSimulators(simulatorsData);
          if (simulatorsData.length > 0 || !snap.metadata.fromCache) {
            writeCachedSimulators(simulatorsData);
          }
        }
        setSimulatorsError(null);
        setSimulatorsLoading(false);

        console.log("[NVU] Simuladores carregados:", simulatorsData.length);
      },
      (error) => {
        if (isAuthTeardownActive()) return;
        console.error("[NVU] Erro ao carregar simuladores:", error);

        // Keep the last known catalog for visual profile hydration. Do not
        // create or inject simulators; the server error remains explicit.
        setSimulatorsError(error?.code || error?.message || "simulators-read-failed");
        setSimulatorsLoading(false);
      },
    );

    return () => unsub();
  }, [simulatorCatalogEnabled]);

  // --- Real-time Firestore Subscriptions (Authenticated) ---
  useEffect(() => {
    const membershipEffectGeneration = ++membershipEffectGenerationRef.current;
    const membershipSessionGeneration = authSessionGenerationRef.current;

    if (!currentUser || !currentUser.id) {
      confirmedMembershipsRef.current = null;
      membershipsUnsubscribeRef.current = null;
      setMemberships([]);
      setMembershipsUiReady(true);
      setMembershipsLoaded(true);
      return;
    }

    // Start the canonical membership read as soon as Firebase confirms the UID.
    // Identity reconciliation runs in parallel. A non-empty server snapshot is
    // already sufficient to authorize the explicit profile choice; only an
    // empty server result remains pending until reconciliation settles, because
    // legacy onboarding may still be migrating a membership to this UID.
    const canProcessMembershipCallback = () =>
      membershipEffectGenerationRef.current === membershipEffectGeneration &&
      canProcessAuthenticatedCallback(currentUser.id, membershipSessionGeneration);

    const hasCurrentConfirmedSnapshot = () => {
      const snapshot = confirmedMembershipsRef.current;
      return Boolean(
        snapshot &&
          snapshot.uid === currentUser.id &&
          snapshot.sessionGeneration === membershipSessionGeneration,
      );
    };

    const identityPendingAtStart =
      !hasCurrentConfirmedSnapshot() && identityReconciliationStatus !== "complete";

    const membershipRepository = createMembershipRepository<CompanyMember>({
      db,
      uid: currentUser.id,
      normalize: normalizeCompanyMember,
      readCache: () => readCachedMemberships(currentUser.id),
      hasCachedSnapshot: () => hasCachedMembershipSnapshot(currentUser.id),
      writeCache: (records) => writeCachedMemberships(currentUser.id, records),
      getCurrentUser: () => auth.currentUser,
    });
    const cachedMemberships = membershipRepository.readCache();
    const hasCachedMemberships = membershipRepository.hasCachedSnapshot();
    const hasEphemeralMemberships = membershipsRef.current.some(
      (membership) => membership.userId === currentUser.id,
    );
    const confirmedSnapshot = confirmedMembershipsRef.current;
    const hasConfirmedSnapshot = Boolean(
      confirmedSnapshot &&
        confirmedSnapshot.uid === currentUser.id &&
        confirmedSnapshot.sessionGeneration === membershipSessionGeneration,
    );
    setMembershipsUiReady(
      hasCachedMemberships || hasEphemeralMemberships || hasConfirmedSnapshot,
    );
    if (hasConfirmedSnapshot && confirmedSnapshot) {
      membershipsRef.current = confirmedSnapshot.memberships;
      setMemberships(confirmedSnapshot.memberships);
    } else if (hasCachedMemberships) {
      membershipsRef.current = cachedMemberships;
      setMemberships(cachedMemberships);
    }
    // A same-generation server snapshot remains authoritative while its
    // listener is reconnected after resume/online. Only a new UID/generation
    // returns to the strict pending state.
    setMembershipsLoaded(hasConfirmedSnapshot);
    setSessionRecovering(!hasConfirmedSnapshot);
    if (!hasConfirmedSnapshot) {
      publishSessionDiagnostic(
        hasCachedMemberships ? "MEMBERSHIP_CACHE_ONLY" : "MEMBERSHIP_SERVER_PENDING",
        currentUser.id,
        membershipSessionGeneration,
      );
    }

    let membershipServerTimer: number | undefined;
    let membershipRecoveryInFlight = false;

    const commitServerMemberships = (
      recoveredMemberships: CompanyMember[],
      source: string,
    ) => {
      if (!canProcessMembershipCallback()) return;
      markProfilePerf("T7_MEMBERSHIP_END", {
        source,
        result: "success",
        serverSide: true,
        cacheHit: false,
        count: recoveredMemberships.length,
      });
      membershipsRef.current = recoveredMemberships;
      confirmedMembershipsRef.current = {
        uid: currentUser.id,
        sessionGeneration: membershipSessionGeneration,
        memberships: recoveredMemberships,
      };
      setMemberships(recoveredMemberships);
      writeCachedMemberships(currentUser.id, recoveredMemberships);
      markServerConfirmedMemberships(currentUser.id);
      setMembershipsLoaded(true);
      setMembershipsUiReady(true);
      setSessionRecovering(false);
      publishSessionDiagnostic(
        recoveredMemberships.length > 0
          ? "MEMBERSHIP_SERVER_FOUND"
          : "MEMBERSHIP_SERVER_EMPTY",
        currentUser.id,
        membershipSessionGeneration,
        `serverCount=${recoveredMemberships.length}|${source}`,
      );
    };

    const recoverMembershipsFromServer = async (source: string) => {
      if (
        membershipRecoveryInFlight ||
        !canProcessMembershipCallback() ||
        !auth.currentUser ||
        auth.currentUser.uid !== currentUser.id
      ) {
        return;
      }
      membershipRecoveryInFlight = true;
      const retainConfirmedSnapshot = hasCurrentConfirmedSnapshot();
      markProfilePerf("T6_MEMBERSHIP_START", {
        source,
        serverSide: true,
        cacheHit: retainConfirmedSnapshot,
        count: membershipsRef.current.length,
      });
      setMembershipsLoaded(retainConfirmedSnapshot);
      setSessionRecovering(!retainConfirmedSnapshot);
      try {
        const recoveredMemberships =
          await membershipRepository.recoverFromServer();
        if (!canProcessMembershipCallback()) return;
        if (membershipServerTimer !== undefined) {
          window.clearTimeout(membershipServerTimer);
          membershipServerTimer = undefined;
        }
        commitServerMemberships(recoveredMemberships, source);
      } catch (recoveryError) {
        if (!canProcessMembershipCallback()) return;
        const retainConfirmedSnapshot = hasCurrentConfirmedSnapshot();
        setMembershipsLoaded(retainConfirmedSnapshot);
        setMembershipsUiReady(
          membershipsRef.current.some(
            (membership) => membership.userId === currentUser.id,
          ) || hasCachedMemberships || retainConfirmedSnapshot,
        );
        setSessionRecovering(!retainConfirmedSnapshot);
        markProfilePerf("T7_MEMBERSHIP_END", {
          source,
          result: source === "listener-timeout" ? "timeout" : "failure",
          serverSide: true,
          cacheHit: retainConfirmedSnapshot,
          count: membershipsRef.current.length,
        });
        publishSessionDiagnostic(
          "MEMBERSHIP_SERVER_ERROR",
          currentUser.id,
          membershipSessionGeneration,
          recoveryError instanceof Error
            ? recoveryError.message
            : String(recoveryError),
        );
      } finally {
        membershipRecoveryInFlight = false;
      }
    };

    membershipServerTimer = window.setTimeout(() => {
      if (!canProcessMembershipCallback()) return;
      void recoverMembershipsFromServer("listener-timeout");
    }, 12_000);

    markProfilePerf("T6_MEMBERSHIP_START", {
      source: "membership-listener",
      serverSide: true,
      cacheHit: hasCachedMemberships || hasEphemeralMemberships || hasConfirmedSnapshot,
      count: membershipsRef.current.length,
    });

    const unsubscribeMemberships = membershipRepository.subscribe({
      onSnapshot: (fetchedMemberships, fromCache) => {
        if (!canProcessMembershipCallback()) return;

        // Any local snapshot is presentation-only. Even non-empty cached rows
        // may belong to a stale account/session; only fromCache=false can release
        // the profile guards.
        if (fromCache) {
          const preservedMemberships =
            membershipsRef.current.length > 0
              ? membershipsRef.current
              : cachedMemberships;
          membershipsRef.current = preservedMemberships;
          setMemberships(preservedMemberships);
          const retainConfirmedSnapshot = hasCurrentConfirmedSnapshot();
          setMembershipsLoaded(retainConfirmedSnapshot);
          setMembershipsUiReady(
            hasCachedMemberships ||
              preservedMemberships.length > 0 ||
              retainConfirmedSnapshot,
          );
          setSessionRecovering(!retainConfirmedSnapshot);
          if (!retainConfirmedSnapshot) {
            publishSessionDiagnostic(
              "MEMBERSHIP_CACHE_ONLY",
              currentUser.id,
              membershipSessionGeneration,
            );
          }
          return;
        }

        if (identityPendingAtStart && fetchedMemberships.length === 0) {
          // An empty canonical query can be a transient first-login result:
          // unifyUserDocument may still be discovering/migrating a legacy
          // identity. Keep a complete same-UID snapshot visible while that
          // reconciliation settles; Phase B must not destroy Phase A.
          const preservedMemberships =
            membershipsRef.current.length > 0
              ? membershipsRef.current
              : cachedMemberships;
          membershipsRef.current = preservedMemberships;
          setMemberships(preservedMemberships);
          if (preservedMemberships.length === 0) {
            writeCachedMemberships(currentUser.id, fetchedMemberships);
          }
          setMembershipsLoaded(false);
          setMembershipsUiReady(true);
          setSessionRecovering(true);
          publishSessionDiagnostic(
            "IDENTITY_RECONCILIATION_PENDING",
            currentUser.id,
            membershipSessionGeneration,
            `server-memberships=${fetchedMemberships.length}`,
          );
          return;
        }

        if (identityPendingAtStart && fetchedMemberships.length > 0) {
          // This is a canonical, server-confirmed membership snapshot. It is
          // enough for the user to choose a profile; identity/document
          // reconciliation remains an independent background operation.
          membershipsRef.current = fetchedMemberships;
          confirmedMembershipsRef.current = {
            uid: currentUser.id,
            sessionGeneration: membershipSessionGeneration,
            memberships: fetchedMemberships,
          };
          setMemberships(fetchedMemberships);
          writeCachedMemberships(currentUser.id, fetchedMemberships);
          markServerConfirmedMemberships(currentUser.id);
          setMembershipsLoaded(true);
          setMembershipsUiReady(true);
          setSessionRecovering(false);
          markProfilePerf("T7_MEMBERSHIP_END", {
            source: "membership-listener",
            result: "success",
            serverSide: true,
            cacheHit: false,
            count: fetchedMemberships.length,
          });
          publishSessionDiagnostic(
            "MEMBERSHIP_SERVER_FOUND",
            currentUser.id,
            membershipSessionGeneration,
            `server-memberships=${fetchedMemberships.length}|identity-reconciliation-background`,
          );
          return;
        }

        if (membershipServerTimer !== undefined) {
          window.clearTimeout(membershipServerTimer);
          membershipServerTimer = undefined;
        }
        setSessionRecovering(false);
        setMembershipsUiReady(true);

        // companyMembers é a única fonte de autorização. Nunca recrie um
        // vínculo ativo a partir de companyId/memberships legados do usuário:
        // após uma remoção, esses campos podem estar em cache ou pertencer a
        // uma inscrição anterior e não podem devolver acesso silenciosamente.
        membershipsRef.current = fetchedMemberships;
        confirmedMembershipsRef.current = {
          uid: currentUser.id,
          sessionGeneration: membershipSessionGeneration,
          memberships: fetchedMemberships,
        };
        setMemberships(fetchedMemberships);
        writeCachedMemberships(currentUser.id, fetchedMemberships);
        markServerConfirmedMemberships(currentUser.id);
        setMembershipsLoaded(true);
        setSessionRecovering(false);
        markProfilePerf("T7_MEMBERSHIP_END", {
          source: "membership-listener",
          result: "success",
          serverSide: true,
          cacheHit: false,
          count: fetchedMemberships.length,
        });
        publishSessionDiagnostic(
          fetchedMemberships.length > 0
            ? "MEMBERSHIP_SERVER_FOUND"
            : "MEMBERSHIP_SERVER_EMPTY",
          currentUser.id,
          membershipSessionGeneration,
          `serverCount=${fetchedMemberships.length}`,
        );
      },
      onError: (err) => {
        if (!canProcessMembershipCallback()) {
          return;
        }

        console.warn("[NVU Session] Membership listener interrupted; recovering.", err);
        membershipsUnsubscribeRef.current = null;
        const existingMemberships =
          membershipsRef.current.length > 0
            ? membershipsRef.current
            : readCachedMemberships(currentUser.id);

        if (existingMemberships.length > 0) {
          membershipsRef.current = existingMemberships;
          setMemberships(existingMemberships);
          // Existing rows are presentation-only after a listener error. They
          // must not make protected routes or the empty state authoritative.
          setMembershipsLoaded(false);
          setMembershipsUiReady(true);
        } else {
          setMembershipsLoaded(false);
          setMembershipsUiReady(false);
        }
        setSessionRecovering(true);
        void recoverMembershipsFromServer("listener-error");
      },
    });

    let membershipsStopped = false;
    const stopMembershipsSubscription = () => {
      if (membershipsStopped) return;
      membershipsStopped = true;
      unsubscribeMemberships();
    };

    membershipsUnsubscribeRef.current = stopMembershipsSubscription;

    return () => {
      if (membershipServerTimer !== undefined) {
        window.clearTimeout(membershipServerTimer);
        membershipServerTimer = undefined;
      }
      stopMembershipsSubscription();
      if (
        membershipsUnsubscribeRef.current === stopMembershipsSubscription
      ) {
        membershipsUnsubscribeRef.current = null;
      }
    };
  }, [currentUser?.id, sessionRefreshEpoch, identityReconciliationStatus]);

  // Stable primitives for dependencies to avoid excessive re-renders/listener recreations
  const currentUserId = currentUser?.id;
  const currentUserCompanyId = currentUser?.companyId;

  useEffect(() => {
    // Cached memberships may paint the UI, but cannot replace an explicit
    // profile/company choice before canonical reconciliation completes.
    if (
      !currentUser ||
      memberships.length === 0 ||
      !membershipsLoaded ||
      identityReconciliationStatus !== "complete"
    ) {
      return;
    }

    const normalizedCompanyId = String(activeCompanyId || "").trim();

    // A empresa inspecionada pelo Painel Sênior é um escopo de leitura
    // independente da empresa operacional do usuário. Ela pode não existir em
    // memberships e nunca deve ser limpa por este reconciliador.
    const seniorInspectionCompanyId = String(seniorCompanyId || "").trim();
    if (
      isSeniorAuthenticated &&
      seniorInspectionCompanyId &&
      normalizedCompanyId === seniorInspectionCompanyId
    ) {
      return;
    }

    const explicitRole = activeRole;
    const activeMembership = memberships.find(
      (membership) =>
        membership.status === "active" &&
        String(membership.companyId || "").trim() === normalizedCompanyId,
    );
    const roleMembership = explicitRole
      ? memberships.find(
          (membership) =>
            membership.status === "active" &&
            membership.roles.includes(explicitRole),
        )
      : null;

    // No explicit profile means the selector remains the first-login surface;
    // never choose Admin or Driver just because memberships arrived.
    if (!explicitRole) {
      return;
    }

    // Keep the explicit role and repair only its company scope when necessary.
    if (!normalizedCompanyId) {
      if (roleMembership) setActiveCompanyId(roleMembership.companyId);
      return;
    }

    if (!activeMembership) {
      if (roleMembership) {
        setActiveCompanyId(roleMembership.companyId);
      } else {
        // The server no longer confirms the previously selected profile.
        // Clear it so the selector can ask explicitly; never switch roles.
        setActiveCompanyId(null);
        setActiveRole(null);
      }
      return;
    }

    if (activeMembership.roles.includes(explicitRole)) return;

    // If the selected role still exists under another active membership, keep
    // the role and move only the company. Otherwise revoke the local choice.
    if (roleMembership) {
      setActiveCompanyId(roleMembership.companyId);
    } else {
      setActiveCompanyId(null);
      setActiveRole(null);
    }
  }, [
    currentUserId,
    memberships,
    activeCompanyId,
    activeRole,
    identityReconciliationStatus,
    membershipsLoaded,
    isSeniorAuthenticated,
    seniorCompanyId,
  ]);

  // Senior is an authorization role, not a separate operational profile.
  // Never overwrite an explicit Admin/Driver profile selection just because
  // the account also has Senior access. A default Admin role is used only
  // when no operational profile has been established yet.
  useEffect(() => {
    const roles = Array.isArray((currentUser as any)?.roles)
      ? (currentUser as any).roles
      : [];
    const hasSeniorRole =
      (currentUser as any)?.role === "senior" || roles.includes("senior");
    if (hasSeniorRole && !activeRole) {
      setActiveRole("admin");
    }
  }, [currentUser?.id, (currentUser as any)?.role, activeRole]);

  const isActiveUser = useMemo(() => {
    if (!currentUser) return false;
    const seniorAccess = readSessionStorageValue("seniorAccess") === "true";
    const seniorId = readSessionStorageValue("seniorCompanyId");
    if (hasSeniorPanelAccess && seniorAccess && seniorId === activeCompanyId)
      return true;
    if (
      hasSeniorPanelAccess &&
      isSeniorAuthenticated &&
      seniorCompanyId === activeCompanyId
    )
      return true;
    const currentMembership = memberships.find(
      (m) => m.companyId === activeCompanyId,
    );
    return currentMembership?.status === "active";
  }, [
    currentUser,
    memberships,
    activeCompanyId,
    hasSeniorPanelAccess,
    isSeniorAuthenticated,
    seniorCompanyId,
  ]);

  const targetCompanyId = useMemo(() => {
    return resolveOperationalCompanyId({
      activeCompanyId,
      currentUserCompanyId,
      seniorCompanyId,
      seniorAccess:
        hasSeniorPanelAccess &&
        (isSeniorAuthenticated ||
          readSessionStorageValue("seniorAccess") === "true"),
    });
  }, [
    activeCompanyId,
    currentUserCompanyId,
    hasSeniorPanelAccess,
    isSeniorAuthenticated,
    seniorCompanyId,
  ]);


  const {
    allCompanyMembers,
    allCompanyMembersReady,
    allCompanyMembersError,
    setAllCompanyMembers,
  } = useCompanyMembersController({
      userId: currentUserId,
      targetCompanyId,
      isActive: isActiveUser,
      suspended: suspendCompanyScopedRealtime,
    });
  const {
    driverRequests,
    setDriverRequests,
    recruitmentApplications,
    setRecruitmentApplications,
  } = useCompanyRecruitmentController({
    userId: currentUserId,
    userEmail: currentUser?.email,
    activeRole,
    targetCompanyId,
    isActive: isActiveUser,
    suspended: suspendCompanyScopedRealtime,
  });


  // Warm only the identity visible on every screen immediately. Broader fleet
  // photo work is bounded by runtime capability so mobile WebViews are not
  // interrupted by speculative decoding after each users/jobs snapshot.
  useEffect(() => {
    if (interactionFirstRoute) return;

    const runtime = getRuntimePerformanceProfile();
    const memberIds = new Set(
      allCompanyMembers
        .filter((member) => member.companyId === activeCompanyId)
        .map((member) => member.userId),
    );
    const activeCompany = companies.find(
      (company) => company.id === activeCompanyId,
    );
    const resolveUserPhoto = (user: any) =>
      user?.profilePhotoURL ||
      user?.photoURL ||
      user?.photoUrl ||
      user?.avatar ||
      user?.profileImage ||
      user?.imageUrl ||
      user?.photo ||
      "";

    const identityImages = Array.from(
      new Set(
        [
          resolveUserPhoto(currentUser),
          activeCompany?.logoUrl,
          activeCompany?.logoURL,
          (activeCompany as any)?.logo,
        ]
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    );
    if (identityImages.length > 0) {
      void preloadImages(
        identityImages,
        runtime.mobileViewport ? 1 : 2,
        "high",
      );
    }

    const maxDeferredPhotos = runtime.constrained
      ? 0
      : runtime.mobileViewport
        ? 18
        : 60;
    if (maxDeferredPhotos === 0) return;

    const companyUsers = users.filter(
      (user) =>
        user.companyId === activeCompanyId || memberIds.has(user.id),
    );
    const activeJobDriverIds = new Set(
      jobs
        .filter((job) => job.companyId === activeCompanyId && job.driverId)
        .map((job) => job.driverId),
    );
    const activeJobDrivers = users.filter((user) =>
      activeJobDriverIds.has(user.id),
    );
    const deferredUsers = Array.from(
      new Map<string, User>(
        [...companyUsers, ...activeJobDrivers]
          .filter((user) => Boolean(resolveUserPhoto(user)))
          .map((user) => [user.id, user] as const),
      ).values(),
    ).slice(0, maxDeferredPhotos);
    const deferredPhotos = Array.from(
      new Set(deferredUsers.map(resolveUserPhoto).filter(Boolean)),
    );
    const signature = [activeCompanyId || "", ...deferredPhotos].join("|");
    if (
      deferredPhotos.length === 0 ||
      deferredPhotoWarmSignatureRef.current === signature
    ) {
      return;
    }
    deferredPhotoWarmSignatureRef.current = signature;

    const idleApi = window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId: number | null = null;
    const warmDeferredPhotos = () => {
      if (!runtime.mobileViewport) {
        void warmRankingUserProfiles(deferredUsers, 6);
      }
      void preloadImages(
        deferredPhotos,
        runtime.backgroundImageConcurrency,
        "low",
      );
    };
    const timer = window.setTimeout(() => {
      if (idleApi.requestIdleCallback) {
        idleId = idleApi.requestIdleCallback(warmDeferredPhotos, {
          timeout: runtime.mobileViewport ? 4800 : 2800,
        });
      } else {
        warmDeferredPhotos();
      }
    }, runtime.mobileViewport ? 3600 : 1800);

    return () => {
      window.clearTimeout(timer);
      if (idleId !== null) idleApi.cancelIdleCallback?.(idleId);
    };
  }, [
    interactionFirstRoute,
    currentUser,
    activeCompanyId,
    companies,
    users,
    allCompanyMembers,
    jobs,
  ]);

  useLayoutEffect(() => {
    if (!currentUserId) {
      privateDataScopeRef.current = null;
      privateSubscriptionsGenerationRef.current += 1;
      privateSubscriptionsUnsubscribeRef.current = null;
      setVehicles([]);
      setTrailers([]);
      setContracts([]);
      setSequences([]);
      setJobs([]);
      setJobDemands([]);
      setUsers([]);
      setFetchedMissingUsers([]);
      setOperationalReadiness(EMPTY_OPERATIONAL_READINESS);
      operationalScopeCache.clear();
      operationalScopePersistTimers.forEach((timer) => clearTimeout(timer));
      operationalScopePersistTimers.clear();
      priorityContractLoadsRef.current.clear();
      priorityContractResolvedRef.current.clear();
      priorityAssetLoadsRef.current.clear();
      priorityAssetResolvedRef.current.clear();
      return;
    }

    const operationalRealtimePolicy = resolveOperationalRealtimePolicy({
      currentUserId,
      foregroundPathname,
    });
    // Select Profile/Pendências/Status must remain a quiet foreground surface.
    // Keep the last operational snapshot in memory, but do not attach the
    // vehicles/contracts/jobs/users listeners while these screens are visible.
    // The previous effect cleanup unsubscribes an existing operational scope
    // before this branch runs, so Firestore snapshot mapping cannot block taps.
    if (!operationalRealtimePolicy.enabled) return;

    const uid = currentUserId;
    const previousPrivateScope = privateDataScopeRef.current;
    const sameCompanyScope =
      previousPrivateScope?.uid === uid &&
      previousPrivateScope.companyId === targetCompanyId;
    const roleChangedWithinCompany =
      sameCompanyScope && previousPrivateScope?.role !== activeRole;
    privateDataScopeRef.current = {
      uid,
      companyId: targetCompanyId,
      role: activeRole,
    };
    const isActive = isActiveUser;
    const subscriptionGeneration =
      ++privateSubscriptionsGenerationRef.current;
    const canPublishPrivateSnapshot = () =>
      privateSubscriptionsGenerationRef.current === subscriptionGeneration &&
      canProcessAuthenticatedCallback(uid);

    const hydratePriorityDriverContract = (nextJobs: Job[]) => {
      if (activeRole !== "driver" || !targetCompanyId) return;

      const priorityJob = selectCurrentOperationJob(nextJobs, uid, targetCompanyId);

      const contractId = String(priorityJob?.contractId || "").trim();
      if (!contractId) return;

      const requestKey = `${operationalScopeKey}|${contractId}`;
      if (
        priorityContractResolvedRef.current.has(requestKey) ||
        priorityContractLoadsRef.current.has(requestKey)
      ) {
        return;
      }

      const request = getDoc(doc(db, "contratos", contractId))
        .then((contractSnapshot) => {
          if (!canPublishPrivateSnapshot() || !contractSnapshot.exists()) return;
          const contract = {
            ...contractSnapshot.data(),
            id: contractSnapshot.id,
          } as Contract;
          if (contract.deleted) return;

          priorityContractResolvedRef.current.add(requestKey);
          setContracts((current) => {
            const next = current.some((item) => item.id === contract.id)
              ? current.map((item) =>
                  item.id === contract.id ? contract : item,
                )
              : [contract, ...current];
            mergeOperationalScopeSnapshot(operationalScopeKey, {
              contracts: next,
            });
            return next;
          });
        })
        .catch((error) => {
          if (
            canPublishPrivateSnapshot() &&
            error?.code !== "permission-denied"
          ) {
            console.warn(
              "[NVU] Falha ao antecipar contrato da operação ativa:",
              error,
            );
          }
        })
        .finally(() => {
          priorityContractLoadsRef.current.delete(requestKey);
        });

      priorityContractLoadsRef.current.set(requestKey, request);
    };

    const hydratePriorityDriverAssets = (nextJobs: Job[]) => {
      if (activeRole !== "driver" || !targetCompanyId) return;
      const priorityJob = selectCurrentOperationJob(nextJobs, uid, targetCompanyId);
      if (!priorityJob) return;

      const assets = [
        { kind: "vehicle" as const, collection: "veiculos", id: String(priorityJob.vehicleId || "").trim() },
        { kind: "trailer" as const, collection: "reboques", id: String(priorityJob.trailerId || "").trim() },
      ].filter((asset) => asset.id);

      assets.forEach(({ kind, collection, id }) => {
        const requestKey = `${operationalScopeKey}|${priorityJob.id}|${kind}|${id}`;
        if (
          priorityAssetResolvedRef.current.has(requestKey) ||
          priorityAssetLoadsRef.current.has(requestKey)
        ) {
          return;
        }

        const request = getDoc(doc(db, collection, id))
          .then((assetSnapshot) => {
            if (!canPublishPrivateSnapshot() || !assetSnapshot.exists()) return;
            const data = assetSnapshot.data() as Record<string, unknown>;
            if (data.deleted) return;
            const assetCompanyId = String(data.companyId || "").trim();
            const expectedCompanyId = String(priorityJob.companyId || targetCompanyId || "").trim();
            if (assetCompanyId && expectedCompanyId && assetCompanyId !== expectedCompanyId) return;

            priorityAssetResolvedRef.current.add(requestKey);
            if (kind === "vehicle") {
              const vehicle = { ...data, id: assetSnapshot.id } as Vehicle;
              setVehicles((current) => {
                const next = current.some((item) => item.id === vehicle.id)
                  ? current.map((item) => (item.id === vehicle.id ? vehicle : item))
                  : [vehicle, ...current];
                mergeOperationalScopeSnapshot(operationalScopeKey, { vehicles: next });
                return next;
              });
            } else {
              const trailer = { ...data, id: assetSnapshot.id } as Trailer;
              setTrailers((current) => {
                const next = current.some((item) => item.id === trailer.id)
                  ? current.map((item) => (item.id === trailer.id ? trailer : item))
                  : [trailer, ...current];
                mergeOperationalScopeSnapshot(operationalScopeKey, { trailers: next });
                return next;
              });
            }
          })
          .catch((error) => {
            if (canPublishPrivateSnapshot() && error?.code !== "permission-denied") {
              console.warn(`[NVU] Falha ao antecipar ${kind} da operação atual:`, error);
            }
          })
          .finally(() => {
            priorityAssetLoadsRef.current.delete(requestKey);
          });

        priorityAssetLoadsRef.current.set(requestKey, request);
      });
    };

    // Rehydrate the exact user/company/role scope before attaching the live
    // listeners. Returning to a profile within the same session therefore
    // keeps its last complete snapshot visible instead of painting a false
    // empty state for one or two seconds. Firebase remains authoritative and
    // replaces this snapshot as soon as each listener emits.
    const operationalScopeKey = buildOperationalScopeKey(
      uid,
      targetCompanyId,
      activeRole,
    );
    const cachedScope = readOperationalScopeSnapshot(operationalScopeKey);

    if (cachedScope) {
      if (cachedScope.vehicles) setVehicles(cachedScope.vehicles);
      if (cachedScope.trailers) setTrailers(cachedScope.trailers);
      if (cachedScope.contracts) setContracts(cachedScope.contracts);
      if (cachedScope.sequences) setSequences(cachedScope.sequences);
      if (cachedScope.jobs) setJobs(cachedScope.jobs);
      if (cachedScope.jobDemands) setJobDemands(cachedScope.jobDemands);
      if (cachedScope.users) setUsers(cachedScope.users);
      const cachedActiveDriverJob =
        activeRole === "driver"
          ? selectCurrentOperationJob(cachedScope.jobs || [], uid, targetCompanyId)
          : undefined;
      const cachedActiveContract = cachedActiveDriverJob
        ? cachedScope.contracts?.some(
            (contract) => contract.id === cachedActiveDriverJob.contractId,
          )
        : false;
      const restoredAdminScope =
        cachedScope.restoredFromSession && activeRole === "admin";
      setOperationalReadiness({
        vehicles: Boolean(cachedScope.vehicles),
        trailers: Boolean(cachedScope.trailers),
        // Non-empty cached critical data can paint immediately. Cached empty
        // arrays remain "refreshing" until Firestore confirms the current
        // server state, preventing a false "solicitar trabalho" screen.
        contracts: restoredAdminScope
          ? Array.isArray(cachedScope.contracts)
          : cachedScope.restoredFromSession
            ? Boolean(cachedActiveContract)
          : Boolean(cachedScope.contracts?.length),
        sequences: Boolean(cachedScope.sequences),
        jobs: restoredAdminScope
          ? Array.isArray(cachedScope.jobs)
          : cachedScope.restoredFromSession
            ? Boolean(cachedActiveDriverJob)
          : Boolean(cachedScope.jobs?.length),
        demands: Boolean(cachedScope.jobDemands?.length),
        users: Boolean(cachedScope.users),
      });
    } else if (!sameCompanyScope) {
      // Never expose data from another account or company.
      setVehicles([]);
      setTrailers([]);
      setContracts([]);
      setSequences([]);
      setJobs([]);
      setJobDemands([]);
      setUsers([]);
      setFetchedMissingUsers([]);
      setOperationalReadiness(EMPTY_OPERATIONAL_READINESS);
    } else if (roleChangedWithinCompany) {
      // Shared company collections are still valid. When entering the driver
      // profile, the admin snapshot can be narrowed synchronously to the
      // current driver, making an active operation visible in the first frame.
      // The new scoped listener then confirms/replaces it.
      if (activeRole === "driver") {
        setJobs((current) =>
          current.filter(
            (job) =>
              job.companyId === targetCompanyId && job.driverId === uid,
          ),
        );
        setJobDemands((current) =>
          current.filter(
            (demand) =>
              demand.companyId === targetCompanyId && demand.driverId === uid,
          ),
        );
      }
      setOperationalReadiness((current) => ({
        ...current,
        jobs: false,
        demands: false,
      }));
    }

    if (cachedScope?.jobs?.length) {
      hydratePriorityDriverContract(cachedScope.jobs);
      hydratePriorityDriverAssets(cachedScope.jobs);
    }

    let unsubVehicles: () => void = () => {};
    let unsubTrailers: () => void = () => {};
    let unsubContracts: () => void = () => {};
    let unsubSequences: () => void = () => {};
    let unsubJobs: () => void = () => {};
    let unsubDemands: () => void = () => {};
    let unsubUsers: () => void = () => {};
    

    const handleSnapError =
      (prefix: string, readinessKey?: keyof OperationalReadiness) =>
      (error: any) => {
        if (
          !canPublishPrivateSnapshot() ||
          isLoggingOutRef.current ||
          isAuthTeardownActive() ||
          !auth.currentUser
        ) return;
        if (readinessKey) {
          // A failed listener must not leave the destination in an endless
          // synchronization state. Any exact cached snapshot remains visible.
          setOperationalReadiness((current) => ({
            ...current,
            [readinessKey]: true,
          }));
        }
        if (error.code !== "permission-denied") {
          console.error(`${prefix}:`, error);
        }
      };

    if (isActive) {
      // For dependent resources (vehicles, trailers, contracts, jobs), Admins and Drivers fetch by companyId.
      const vehicleQuery = activeCompanyId
        ? query(
            collection(db, "veiculos"),
            where("companyId", "==", activeCompanyId),
          )
        : null;

      if (vehicleQuery)
        unsubVehicles = onSnapshot(
          vehicleQuery,
          (snap) => {
            if (!canPublishPrivateSnapshot()) return;
            const nextVehicles = snap.docs.map(
              (doc) => ({ ...doc.data(), id: doc.id }) as Vehicle,
            );
            const cachedVehicles = readOperationalScopeSnapshot(operationalScopeKey)?.vehicles || [];
            const preserveCachedVehicles =
              snap.metadata.fromCache && nextVehicles.length === 0 && cachedVehicles.length > 0;
            const effectiveVehicles = preserveCachedVehicles ? cachedVehicles : nextVehicles;
            setVehicles(effectiveVehicles);
            if (!preserveCachedVehicles) {
              mergeOperationalScopeSnapshot(operationalScopeKey, {
                vehicles: effectiveVehicles,
              });
            }
            setOperationalReadiness((current) => ({
              ...current,
              vehicles: true,
            }));
          },
          handleSnapError("Error fetching veiculos snap", "vehicles"),
        );

      const trailerQuery = activeCompanyId
        ? query(
            collection(db, "reboques"),
            where("companyId", "==", activeCompanyId),
          )
        : null;

      if (trailerQuery)
        unsubTrailers = onSnapshot(
          trailerQuery,
          (snap) => {
            if (!canPublishPrivateSnapshot()) return;
            const nextTrailers = snap.docs.map(
              (doc) => ({ ...doc.data(), id: doc.id }) as Trailer,
            );
            const cachedTrailers = readOperationalScopeSnapshot(operationalScopeKey)?.trailers || [];
            const preserveCachedTrailers =
              snap.metadata.fromCache && nextTrailers.length === 0 && cachedTrailers.length > 0;
            const effectiveTrailers = preserveCachedTrailers ? cachedTrailers : nextTrailers;
            setTrailers(effectiveTrailers);
            if (!preserveCachedTrailers) {
              mergeOperationalScopeSnapshot(operationalScopeKey, {
                trailers: effectiveTrailers,
              });
            }
            setOperationalReadiness((current) => ({
              ...current,
              trailers: true,
            }));
          },
          handleSnapError("Error fetching reboques snap", "trailers"),
        );

      const contractQuery = activeCompanyId
        ? query(
            collection(db, "contratos"),
            where("companyId", "==", activeCompanyId),
          )
        : null;

      const sequenceQuery = activeCompanyId
        ? query(
            collection(db, "sequencias"),
            where("companyId", "==", activeCompanyId)
          )
        : null;

      if (sequenceQuery)
        unsubSequences = onSnapshot(
          sequenceQuery,
          (snap) => {
            if (!canPublishPrivateSnapshot()) return;
            const nextSequences = snap.docs
              .map((doc) => ({ ...doc.data(), id: doc.id }) as Sequence)
              .filter((sequence) => !sequence.deleted);
            setSequences(nextSequences);
            mergeOperationalScopeSnapshot(operationalScopeKey, {
              sequences: nextSequences,
            });
            setOperationalReadiness((current) => ({
              ...current,
              sequences: true,
            }));
          },
          handleSnapError("Error fetching sequencias snap", "sequences")
        );

      if (contractQuery)
        unsubContracts = onSnapshot(
          contractQuery,
          (snap) => {
            if (!canPublishPrivateSnapshot()) return;
            const nextContracts = snap.docs
              .map((doc) => ({ ...doc.data(), id: doc.id }) as Contract)
              .filter((contract) => !contract.deleted);
            const cachedContracts = readOperationalScopeSnapshot(operationalScopeKey)?.contracts || [];
            const preserveCachedContracts =
              snap.metadata.fromCache && nextContracts.length === 0 && cachedContracts.length > 0;
            const effectiveContracts = preserveCachedContracts ? cachedContracts : nextContracts;
            setContracts(effectiveContracts);
            if (!preserveCachedContracts) {
              mergeOperationalScopeSnapshot(operationalScopeKey, {
                contracts: effectiveContracts,
              });
            }
            setOperationalReadiness((current) => ({
              ...current,
              contracts: true,
            }));
          },
          handleSnapError("Error fetching contratos snap", "contracts"),
        );

      // For jobs, query by companyId and driverId directly in Firestore to avoid overfetching
      const jobQuery = activeCompanyId
        ? activeRole === "admin"
          ? query(
              collection(db, "trabalhos"),
              where("companyId", "==", activeCompanyId),
            )
          : query(
              collection(db, "trabalhos"),
              where("companyId", "==", activeCompanyId),
              where("driverId", "==", uid),
            )
        : null;

      if (jobQuery) {
        unsubJobs = onSnapshot(
          jobQuery,
          (snap) => {
            if (!canPublishPrivateSnapshot()) return;
            const nextJobs = snap.docs.map(
              (doc) => ({ ...doc.data(), id: doc.id }) as Job,
            ).map(mergeManagedConfirmedJob).filter(job => !job.archived);
            if (activeRole === "driver" && !snap.metadata.fromCache) operationOutbox.observe(uid, targetCompanyId, nextJobs);
            // Prioritize the single contract required by the driver's current
            // operation instead of waiting for the full company contract
            // collection before the screen can render.
            hydratePriorityDriverContract(nextJobs);
            hydratePriorityDriverAssets(nextJobs);
            const cachedJobs = readOperationalScopeSnapshot(operationalScopeKey)?.jobs || [];
            const preserveCachedJobs =
              snap.metadata.fromCache && nextJobs.length === 0 && cachedJobs.length > 0;
            const effectiveJobs = preserveCachedJobs ? cachedJobs : nextJobs;
            setJobs(current => effectiveJobs.map(job => mergeManagedOperationAcknowledgement(current.find(previous => previous.id === job.id), job)));
            // Cache-originated emptiness is not authoritative while offline.
            // Persist only a real payload or a server-confirmed empty state.
            if (!preserveCachedJobs) {
              mergeOperationalScopeSnapshot(operationalScopeKey, { jobs: effectiveJobs });
            }
            setOperationalReadiness((current) => ({
              ...current,
              jobs: true,
            }));
          },
          handleSnapError("Error fetching trabalhos snap", "jobs")
        );
      }

      const demandsQuery =
        activeRole === "admin"
          ? targetCompanyId
            ? query(
                collection(db, "jobDemands"),
                where("companyId", "==", targetCompanyId),
                where("status", "==", "pending"),
                limit(MAX_PENDING_REQUESTS),
              )
            : null
          : query(
              collection(db, "jobDemands"),
              where("driverId", "==", uid),
              where("status", "==", "pending"),
              limit(20),
            );

      if (demandsQuery)
        unsubDemands = onSnapshot(
          demandsQuery,
          (snap) => {
            if (!canPublishPrivateSnapshot()) return;
            const nextJobDemands = snap.docs.map(
              (doc) => ({ ...doc.data(), id: doc.id }) as JobDemand,
            );
            setJobDemands(nextJobDemands);
            mergeOperationalScopeSnapshot(operationalScopeKey, {
              jobDemands: nextJobDemands,
            });
            setOperationalReadiness((current) => ({
              ...current,
              demands: true,
            }));
          },
          handleSnapError("Error fetching jobDemands", "demands"),
        );

      const usersQuery = targetCompanyId
        ? query(
            collection(db, "public_users"),
            where("companyId", "==", targetCompanyId),
          )
        : null;

      if (usersQuery) {
        unsubUsers = onSnapshot(
          usersQuery,
          (snap) => {
            if (!canPublishPrivateSnapshot()) return;
            let mappedUsers = snap.docs.map(
              (doc) => ({ ...doc.data(), id: doc.id }) as User,
            );

            mappedUsers = mappedUsers.map((u) => {
              if (!u.roles) u.roles = [u.role || "driver"];
              if (u.roles.includes("admin") && !u.roles.includes("driver"))
                u.roles.push("driver");
              if (u.roles.includes("admin")) u.status = "active";
              return u;
            });

            setUsers(mappedUsers);
            mergeOperationalScopeSnapshot(operationalScopeKey, {
              users: mappedUsers,
            });
            setOperationalReadiness((current) => ({
              ...current,
              users: true,
            }));
          },
          handleSnapError("Error fetching users snap", "users")
        );
      }
    }

    let privateSubscriptionsStopped = false;
    const stopPrivateSubscriptions = () => {
      if (privateSubscriptionsStopped) return;
      privateSubscriptionsStopped = true;

      unsubVehicles();
      unsubTrailers();
      unsubContracts();
      unsubSequences();
      unsubJobs();
      unsubUsers();
      unsubDemands();
    };

    privateSubscriptionsUnsubscribeRef.current = stopPrivateSubscriptions;

    return () => {
      if (
        privateSubscriptionsGenerationRef.current === subscriptionGeneration
      ) {
        privateSubscriptionsGenerationRef.current += 1;
      }
      stopPrivateSubscriptions();
      if (
        privateSubscriptionsUnsubscribeRef.current === stopPrivateSubscriptions
      ) {
        privateSubscriptionsUnsubscribeRef.current = null;
      }
    };
  }, [
    currentUserId,
    targetCompanyId,
    activeCompanyId,
    activeRole,
    isActiveUser,
    interactionFirstRoute,
  ]);

  useEffect(() => {
    if (interactionFirstRoute || !currentUserId || !activeCompanyId) return;
    const expectedUid = currentUserId;
    const existingIds = new Set(users.map(user => user.id));
    const company = companies.find(row => row.id === activeCompanyId);
    const missingIds = [...new Set([
      ...allCompanyMembers.filter(member => member.companyId === activeCompanyId && member.status === "active").map(member => member.userId),
      company?.ownerId, company?.userId,
      ...jobs.filter(job => job.companyId === activeCompanyId).map(job => job.driverId),
    ].filter((id): id is string => Boolean(id) && !existingIds.has(id)))];
    // Only this exact account/company/ID set may supply supplemental display metadata.
    setFetchedMissingUsers(previous => previous.filter(user => missingIds.includes(user.id)));
    let active = true;
    const stops: Array<() => void> = [];
    for (let offset = 0; offset < missingIds.length; offset += 30) {
      const ids = missingIds.slice(offset, offset + 30);
      stops.push(onSnapshot(query(collection(db, "public_users"), where("__name__", "in", ids)), snapshot => {
        if (!active || auth.currentUser?.uid !== expectedUid || isAuthTeardownActive()) return;
        const profiles = snapshot.docs.map(row => ({ ...row.data(), id: row.id }) as User);
        setFetchedMissingUsers(previous => [...previous.filter(user => !ids.includes(user.id)), ...profiles]);
      }, error => {
        if (active && auth.currentUser?.uid === expectedUid && !isAuthTeardownActive()) console.warn("Error reading public member identity:", error);
      }));
    }
    return () => { active = false; stops.forEach(stop => stop()); };
  }, [interactionFirstRoute, currentUserId, allCompanyMembers, activeCompanyId, companies, jobs, users.map(user => user.id).join(",")]);

  // Helper para getCurrentUserId (conforme requisitos)
  const getCurrentUserId = () => {
    if (!auth.currentUser) throw new Error("Usuário não autenticado");
    return auth.currentUser.uid;
  };

  const handleFirebaseError = (error: any) => {
    if (isLoggingOutRef.current || isAuthTeardownActive()) return;
    console.error("Firebase Error: ", error);
    const message = String(error?.message || error || "");
    if (
      ["permission-denied", "functions/permission-denied"].includes(String(error?.code || "")) ||
      message.includes("permission-denied") ||
      message.includes("Missing or insufficient permissions")
    ) {
      toast.error("Você não tem permissão para esta ação");
    } else if (["functions/unauthenticated", "unauthenticated"].includes(String(error?.code || ""))) {
      toast.error("Sua sessão expirou. Entre novamente para concluir a ação.");
    } else if (["functions/unavailable", "unavailable", "functions/deadline-exceeded", "deadline-exceeded"].includes(String(error?.code || ""))) {
      toast.error("O servidor não confirmou a ação a tempo. Verifique o estado atual e tente novamente.");
    } else if (["functions/internal", "internal"].includes(String(error?.code || "")) && !error?.details?.diagnosticId) {
      toast.error("O servidor não confirmou a ação. Verifique o estado atual; se o erro continuar, informe a ação e o horário ao suporte.");
    } else if (message.includes("OPERATION_TRIPS_NOT_VALIDATED")) {
      toast.error("O servidor ainda não confirmou todas as viagens previstas. Aguarde a sincronização e tente finalizar novamente.");
    } else if (message.includes("OPERATION_COMPLETION_NOT_SETTLED")) {
      toast.error("Não foi possível confirmar o encerramento agora. Verifique a conexão e tente novamente.");
    } else {
      toast.error("Ocorreu um erro: " + message);
    }
  };

  // --- Implement Actions ---
  const updateRecruitmentSettings = async (
    companyId: string,
    settings: RecruitmentSettings,
  ) => {
    try {
      getCurrentUserId();
      await updateDoc(doc(db, "frotas", companyId), {
        recruitmentSettings: settings,
      });
      setCompanies((current) => {
        const target = current.find((company) => company.id === companyId);
        if (!target) return current;
        const next = mergeCompanyProfile(current, {
          ...target,
          recruitmentSettings: settings,
        });
        companiesRef.current = next;
        if (companyCatalogLoadedRef.current) writeCachedCompanies(next);
        return next;
      });
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const submitRecruitmentApplication = async (
    data: Omit<RecruitmentApplication, "id" | "status" | "createdAt">,
  ) => {
    try {
      const normalizedEmail = String(data.email || "").trim().toLowerCase();
      if (data.userId || normalizedEmail) {
        // Validate if owner
        const targetCompany = companies.find((c) => c.id === data.companyId);
        if (targetCompany && targetCompany.ownerId === data.userId) {
          throw new Error("Você é proprietário desta empresa e não pode se inscrever como motorista.");
        }

        // Validate membership without ever building a Firestore query with an
        // undefined userId. Anonymous/legacy applications are matched by the
        // normalized e-mail against an existing user profile first.
        const membershipUserIds = new Set<string>();
        if (data.userId) membershipUserIds.add(data.userId);
        if (!data.userId && normalizedEmail) {
          try {
            const usersByEmail = await queryPrivateUsers({ email: normalizedEmail });
            usersByEmail.docs.forEach((userDoc) => membershipUserIds.add(userDoc.id));
          } catch (err) {
            console.warn("Could not fetch user by email query (likely permissions):", err);
          }
        }

        const membershipSnapshots = await Promise.all(
          Array.from(membershipUserIds).map(async (userId) => {
            try {
              return await getDocs(
                query(
                  collection(db, "companyMembers"),
                  where("userId", "==", userId),
                  where("companyId", "==", data.companyId),
                  where("status", "==", "active"),
                ),
              );
            } catch (err) {
              console.warn("Could not fetch membership query (likely permissions):", err);
              return null;
            }
          }),
        );
        if (membershipSnapshots.filter(Boolean).some((snapshot) => !snapshot!.empty)) {
          throw new Error("Você já faz parte desta empresa e não precisa enviar uma nova inscrição.");
        }

      }

      // Cada envio é uma nova instância do fluxo. O histórico continua visível
      // ao RH, mas nunca bloqueia ou é reutilizado para montar esta inscrição.
      const createdAt = new Date().toISOString();
      if (data.userId || normalizedEmail) {
        try {
          const previousQueries = [
            data.userId
              ? query(
                  collection(db, "recruitment_applications"),
                  where("userId", "==", data.userId),
                )
              : null,
            normalizedEmail && auth.currentUser?.emailVerified
              ? query(
                  collection(db, "recruitment_applications"),
                  where("email", "==", normalizedEmail),
                )
              : null,
          ].filter(Boolean) as ReturnType<typeof query>[];
          const previousSnapshots = await Promise.all(
            previousQueries.map((previousQuery) => getDocs(previousQuery)),
          );
          const previousRefs = new Map<string, any>();
          previousSnapshots.forEach((snapshot) =>
            snapshot.docs.forEach((previousApplication) => {
              const previousData = previousApplication.data() as Partial<RecruitmentApplication>;
              const previousType = String(
                previousData.type ||
                  previousData.registrationType ||
                  "driver_application",
              );
              // Driver submissions replace only older driver submissions.
              // A simultaneous company registration is an independent flow
              // and must remain pending/visible until the NVU evaluates it.
              if (previousType !== "company_registration") {
                previousRefs.set(previousApplication.id, previousApplication.ref);
              }
            }),
          );
          await Promise.all(
            Array.from(previousRefs.values()).map((previousRef) =>
              updateDoc(previousRef, {
                isCurrent: false,
                supersededAt: createdAt,
              }),
            ),
          );
        } catch (historyError) {
          console.warn(
            "Não foi possível marcar todo o histórico como substituído; a nova inscrição continuará independente.",
            historyError,
          );
        }
      }
      const applicationRef = doc(collection(db, "recruitment_applications"));
      try {
        await setDoc(applicationRef, {
          ...data,
          type: "driver_application",
          email: normalizedEmail,
          status: "pending",
          flowVersion: 2,
          isCurrent: true,
          createdAt,
        });
      } catch (err) {
        console.error("addDoc recruitment_applications failed:", err);
        throw new Error("addDoc recruitment_applications failed: " + err.message);
      }

      try {
        await createCorporateNotifications({
          companyId: data.companyId,
          type: "RH_APPLICATION",
          title: "Nova inscrição no RH",
          message: `${data.fullName} enviou uma inscrição para a empresa.`,
          metadata: { applicationId: applicationRef.id, applicantUserId: data.userId ?? null },
          dedupeKey: `RH_APPLICATION_${applicationRef.id}`,
        });
      } catch (notificationError) {
        console.error(
          "[NVU Notifications] A inscrição foi salva, mas o aviso corporativo falhou:",
          notificationError,
        );
      }

      if (auth.currentUser) {
        // Use setDoc with merge: true instead of updateDoc to ensure it doesn't fail if the user doc hasn't been created yet
        try {
          await setDoc(
            doc(db, "users", auth.currentUser.uid),
            {
              applicationSubmitted: true,
              currentRecruitmentApplicationId: applicationRef.id,
              currentRecruitmentCompanyId: data.companyId,
              currentRecruitmentSimulatorId: resolveSimulatorId(data, simulators) || data.simulatorId || "",
              currentRecruitmentStatus: "pending",
              currentRecruitmentType: "driver_application",
              // A nova inscrição substitui qualquer aprovação antiga como
              // referência de acesso/identidade do fluxo.
              approvedIdentityApplicationId: deleteField(),
              approvedIdentityName: deleteField(),
            },
            { merge: true },
          );
        } catch (err) {
          console.error("setDoc users failed:", err);
          throw new Error("setDoc users failed: " + err.message);
        }
      }

      setRecruitmentApplications((current) => {
        const optimisticApplication: RecruitmentApplication = {
          id: applicationRef.id,
          type: "driver_application",
          userId: data.userId,
          companyId: data.companyId,
          simulatorId: data.simulatorId,
          companyName: data.companyName,
          companyLogoURL: data.companyLogoURL,
          simulatorName: data.simulatorName,
          applicationPhotoURL: data.applicationPhotoURL,
          applicationPhotoTransport: data.applicationPhotoTransport,
          fullName: data.fullName,
          whatsapp: data.whatsapp,
          email: normalizedEmail,
          reason: data.reason,
          objective: data.objective,
          deliveriesPerWeek: data.deliveriesPerWeek,
          hasExperience: data.hasExperience,
          primaryVehicle: data.primaryVehicle,
          secondaryVehicle: data.secondaryVehicle,
          status: "pending",
          flowVersion: 2,
          isCurrent: true,
          createdAt,
        };
        return [
          optimisticApplication,
          ...current.filter((application) => application.id !== applicationRef.id),
        ];
      });

      return applicationRef.id;
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  const applyApprovedFleetAck = (result: any, application?: RecruitmentApplication) => {
    if (auth.currentUser?.uid !== currentUserId || !result.userId || !result.companyId) return;
    const roles = Array.isArray(result.roles) ? result.roles : ["driver"];
    const now = new Date().toISOString();
    setAllCompanyMembers(rows => [...rows.filter(row => !(row.userId === result.userId && row.companyId === result.companyId)),
      { id: `${result.userId}_${result.companyId}`, userId: result.userId, companyId: result.companyId, roles,
        status: "active", permissions: [], joinedAt: now }]);
    if (application) setRecruitmentApplications(rows => rows.map(row => row.id === application.id ? { ...row, status: "approved" } : row));
    if (result.requestId) setDriverRequests(rows => rows.filter(row => row.id !== result.requestId));
    // The callable returns committed profile fields, including later edits on
    // an idempotent replay. Never guess identity from a stale form here.
    if (result.displayProfile) {
      const profile = { ...result.displayProfile, id: result.userId, companyId: result.companyId,
        roles, role: roles.includes("admin") ? "admin" : "driver", status: "active" } as User;
      setUsers(rows => rows.map(row => row.id === result.userId ? { ...row, ...profile } : row));
      setFetchedMissingUsers(rows => [...rows.filter(row => row.id !== result.userId), profile]);
    }
  };

  const approveRecruitmentApplication = async (applicationId: string, companyIdOverride?: string) => {
    try {
      getCurrentUserId();
      const companyId = String(companyIdOverride || activeCompanyId || "");
      if (!companyId) throw new Error("Selecione a empresa antes de aprovar a inscrição.");
      const application = recruitmentApplications.find(row => row.id === applicationId);
      const result = await manageFleetMembership({ action: "approve-application", companyId, applicationId });
      applyApprovedFleetAck(result, application);
      toast.success("Motorista aprovado e vínculo sincronizado.");
    } catch (e) { handleFirebaseError(e); throw e; }
  };

  const rejectRecruitmentApplication = async (applicationId: string) => {
    try {
      await rejectRecruitmentApplicationOnServer(applicationId);
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const deleteRecruitmentApplication = async (applicationId: string) => {
    try {
      getCurrentUserId();
      await deleteDoc(doc(db, "recruitment_applications", applicationId));
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const createCompany = async (data: Omit<CompanyProfile, "id" | "cnpj">) => {
    try {
      const uid = getCurrentUserId();
      if (!isSeniorAuthenticated) throw new Error("O cadastro da empresa precisa ser aprovado no painel Sênior.");
      const cnpj = generateCnpj();
      const ownerEmail = String(
        data.email || data.ownerEmail || currentUserRef.current?.email || "",
      )
        .trim()
        .toLowerCase();
      const payload = {
        ...data,
        ...(ownerEmail && {
          email: ownerEmail,
          ownerEmail,
        }),
        userId: uid,
        ownerId: uid,
        cnpj,
        createdAt: new Date().toISOString(),
      };
      const newDoc = doc(collection(db, "frotas"));
      const batch = writeBatch(db);
      batch.set(newDoc, payload);
      batch.update(doc(db, "users", uid), {
        companyId: newDoc.id, roles: ["admin", "driver"], status: "active",
      });
      batch.set(doc(db, "companyMembers", `${uid}_${newDoc.id}`), {
        companyId: newDoc.id, userId: uid, roles: ["admin", "driver"], status: "active",
        permissions: ["admin", "owner", "manage_fleet", "all"], joinedAt: payload.createdAt,
      });
      batch.set(doc(db, "simulator_members", `${uid}_${newDoc.id}`), {
        companyId: newDoc.id, userId: uid, roles: ["admin", "driver"], role: "admin", status: "active",
        simulatorId: resolveSimulatorId(payload as any) || "default", isEligible: true,
      });
      // Publish the new company only when company + owner + both memberships
      // commit together. A denied write leaves no half-created company behind.
      await batch.commit();
      setCompanies((current) => {
        const next = mergeCompanyProfile(
          current,
          normalizeCompanyProfile(newDoc.id, payload),
        );
        companiesRef.current = next;
        if (companyCatalogLoadedRef.current) writeCachedCompanies(next);
        return next;
      });

      setActiveCompanyId(newDoc.id);
      setActiveRole("admin");
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const updateCompany = async (
    id: string,
    updates: Partial<Omit<CompanyProfile, "id" | "cnpj">>,
  ) => {
    try {
      getCurrentUserId(); // valida se tá autenticado

      // The company display name is user-editable and `frotas/{companyId}.companyName`
      // is the canonical source of truth for the current company identity.
      // Simulator assignment remains controlled by the dedicated operational flow.
      const editableUpdates = { ...updates };
      delete editableUpdates.simulatorId;
      delete editableUpdates.simulatorName;

      if (typeof editableUpdates.companyName === "string") {
        const normalizedCompanyName = editableUpdates.companyName.trim();
        if (!normalizedCompanyName) {
          throw new Error("Nome da empresa é obrigatório.");
        }
        editableUpdates.companyName = normalizedCompanyName;
      }

      await updateDoc(doc(db, "frotas", id), editableUpdates);
      setCompanies((current) => {
        const target = current.find((company) => company.id === id);
        if (!target) return current;
        const next = mergeCompanyProfile(current, {
          ...target,
          ...editableUpdates,
          id,
        } as CompanyProfile);
        companiesRef.current = next;
        if (companyCatalogLoadedRef.current) writeCachedCompanies(next);
        return next;
      });
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const deleteCompany = async (id: string) => {
    try {
      getCurrentUserId(); // valida

      await deleteCompanyCanonical(id);
      setCompanies((current) => {
        const next = current.filter((company) => company.id !== id);
        companiesRef.current = next;
        if (companyCatalogLoadedRef.current) writeCachedCompanies(next);
        return next;
      });

      if (activeCompanyId === id) setActiveCompanyId(null);
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const createContract = async (data: Omit<Contract, "id" | "status">) => {
    try {
      if (!activeCompanyId) throw new Error("Selecione uma empresa antes de salvar.");
      const uid = getCurrentUserId();
      const activeCompany = companies.find((c) => c.id === activeCompanyId);
      if (!activeCompany) throw new Error("Empresa ativa não encontrada. Atualize a seleção e tente novamente.");

      
      const rawPayload = {
        ...data,
        simulator: activeCompany.simulatorName, // Auto-populate simulator
        companyName: activeCompany.companyName, // Auto-populate company name
        userId: uid,
        companyId: activeCompanyId,
        status: "active",
        createdAt: new Date().toISOString(),
      };
      
      const cleanPayload = { ...rawPayload };
      Object.keys(cleanPayload).forEach(key => {
        if (cleanPayload[key] === undefined) {
          cleanPayload[key] = null;
        }
      });

      await addDoc(collection(db, "contratos"), cleanPayload);
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const createSequence = async (sequence: Omit<Sequence, "id" | "createdAt">) => {
    try {
      getCurrentUserId();
      const sequenceRef = await addDoc(collection(db, "sequencias"), {
        ...sequence,
        createdAt: new Date().toISOString(),
      });
      return sequenceRef.id;
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const updateSequence = async (id: string, updates: Partial<Omit<Sequence, "id">>) => {
    try {
      getCurrentUserId();
      const cleanUpdates: any = {};
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined) cleanUpdates[key] = deleteField();
        else cleanUpdates[key] = value;
      }
      await updateDoc(doc(db, "sequencias", id), cleanUpdates);
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const deleteSequence = async (id: string) => {
    try {
      getCurrentUserId();
      const batch = writeBatch(db);
      const sequence = sequences.find((item) => item.id === id);
      const scope = sequence?.scope || "operations";
      batch.update(doc(db, "sequencias", id), { deleted: true });
      if (scope === "operations") {
        const relatedContracts = contracts.filter((c) => c.sequenceId === id);
        relatedContracts.forEach((contract) => {
          batch.update(doc(db, "contratos", contract.id), {
            sequenceId: deleteField(),
            sequenceOrder: deleteField(),
          });
        });
      }
      if (scope === "vehicles") {
        const relatedVehicles = vehicles.filter((vehicle) => vehicle.sequenceId === id);
        relatedVehicles.forEach((vehicle) => {
          batch.update(doc(db, "veiculos", vehicle.id), {
            sequenceId: deleteField(),
            sequenceOrder: deleteField(),
          });
        });
      }
      if (scope === "trailers") {
        const relatedTrailers = trailers.filter((trailer) => trailer.sequenceId === id);
        relatedTrailers.forEach((trailer) => {
          batch.update(doc(db, "reboques", trailer.id), {
            sequenceId: deleteField(),
            sequenceOrder: deleteField(),
          });
        });
      }
      await batch.commit();
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const updateContract = async (
    id: string,
    updates: Partial<Omit<Contract, "id">>,
  ) => {
    try {
      getCurrentUserId();
      const cleanUpdates: any = {};
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined) {
          cleanUpdates[key] = deleteField();
        } else {
          cleanUpdates[key] = value;
        }
      }
      await updateDoc(doc(db, "contratos", id), cleanUpdates);
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const deleteContract = async (id: string) => {
    try {
      getCurrentUserId();
      // Soft delete preserves historical trip references.
      await updateDoc(doc(db, "contratos", id), {
        deleted: true,
        deletedAt: new Date().toISOString(),
      });
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const assignJob = async (
    contractId: string,
    driverId: string,
    vehicleId: string,
    trailerId?: string,
    customDeadlineDays?: number,
    requestId?: string,
  ) => {
    try {
      if (!activeCompanyId) throw new Error("Empresa ativa não encontrada para designar a operação.");
      const uid = getCurrentUserId();
      const commandScope = operationalCommandScopeRef.current;
      if (companies.find(company => company.id === activeCompanyId)?.operationalCommandVersion === 1) {
        const result = await canonicalOperationCommandService.executeManaged({ action: "assign", companyId: activeCompanyId,
          contractId, driverId, vehicleId, trailerId: trailerId || null,
          ...(customDeadlineDays !== undefined ? { deadlineDays: customDeadlineDays } : {}) }, requestId);
        assertOperationalCommandScope(uid, commandScope);
        const confirmedJob = mergeManagedConfirmedJob({ ...(result.currentJob || result.job), id: result.jobId } as Job);
        setJobs(current => [mergeManagedOperationAcknowledgement(current.find(job => job.id === result.jobId), confirmedJob), ...current.filter(job => job.id !== result.jobId)].filter(job => !job.archived));
        setJobDemands(current => current.filter(demand => !(demand.companyId === activeCompanyId && demand.driverId === driverId && demand.status === "pending")));
        return;
      }
      const contract = contracts.find((c) => c.id === contractId);
      if (!contract) throw new Error("A operação selecionada não está disponível.");
      if (!driverId || !vehicleId) throw new Error("Motorista e veículo são obrigatórios.");

      const deadline = new Date();
      if (
        customDeadlineDays !== undefined &&
        customDeadlineDays !== null &&
        customDeadlineDays > 0
      ) {
        deadline.setDate(deadline.getDate() + customDeadlineDays);
      } else {
        deadline.setDate(deadline.getDate() + contract.deadlineDays);
      }
      const nowISO = new Date().toISOString();
      const deadlineISO = deadline.toISOString();
      const tripId = `TRIP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const assignedVehicle = vehicles.find((vehicle) => vehicle.id === vehicleId);
      const assignedTrailer = trailerId
        ? trailers.find((trailer) => trailer.id === trailerId)
        : null;
      const jobRef = doc(collection(db, "trabalhos"));
      const jobData: Omit<Job, "id"> & Record<string, unknown> = {
        userId: uid,
        companyId: activeCompanyId,
        contractId,
        driverId,
        motoristaId: driverId,
        assignedDriverId: driverId,
        tripId,
        vehicleId,
        vehicleName: assignedVehicle?.name || "",
        vehiclePlate: assignedVehicle?.plate || "",
        trailerId: trailerId || null,
        trailerName: assignedTrailer?.name || "",
        contractName: contract.name || "",
        totalDeliveries: Number(contract.totalDeliveries || 0),
        status: "pending",
        progress: 0,
        // New operations start on the canonical reconciliation contract.
        // Legacy recovery is reserved for operations created by older builds.
        operationReconciliationVersion: 4,
        operationProgressReconciled: true,
        operationProjectionSource: "new-operation-v4",
        deadlineDate: deadlineISO,
        createdAt: nowISO,
        assignedAt: nowISO,
        dueAt: deadlineISO,
      };

      // Core assignment is one atomic write. A driver never observes a job
      // whose vehicle/trailer status or pending demand update is still partial.
      const batch = writeBatch(db);
      batch.set(jobRef, jobData);
      batch.update(doc(db, "veiculos", vehicleId), { status: "in_use" });
      if (trailerId) {
        batch.update(doc(db, "reboques", trailerId), { status: "in_use" });
      }
      const pendingDemands = jobDemands.filter(
        (d) =>
          d.driverId === driverId &&
          d.status === "pending" &&
          d.companyId === activeCompanyId,
      );
      pendingDemands.forEach((demand) => {
        batch.update(doc(db, "jobDemands", demand.id), { status: "reviewed" });
      });
      await batch.commit();

      // Paint the confirmed assignment immediately; the realtime listener
      // later reconciles the same document ID without duplicating it.
      setJobs((current) => {
        if (current.some((job) => job.id === jobRef.id)) return current;
        return [{ id: jobRef.id, ...jobData } as Job, ...current];
      });

      // Notifications and cleanup of old notices are secondary. They must not
      // delay the assignment confirmation or make a durable job look failed.
      void createNotification({
        userId: driverId,
        companyId: activeCompanyId,
        targetProfile: "driver",
        type: "NEW_OPERATION",
        title: "Nova operação recebida",
        message: `Você recebeu a operação ${contract.name}.`,
        metadata: {
          jobId: jobRef.id,
          contractId,
          vehicleId,
          trailerId: trailerId || null,
        },
        dedupeKey: `NEW_OPERATION_${jobRef.id}`,
      }).catch((notificationError) => {
        console.error(
          "[NVU Notifications] A operação foi criada, mas o aviso ao motorista falhou:",
          notificationError,
        );
      });
      void Promise.all([
        resolveNotifications({
          companyId: activeCompanyId,
          type: "WORK_REQUEST",
          metadata: { driverId },
        }),
        resolveNotifications({
          companyId: activeCompanyId,
          type: "OPERATION_COMPLETED",
          metadata: { driverId },
        }),
      ]).catch((cleanupError) => {
        console.warn("[NVU] Limpeza de avisos pós-designação adiada:", cleanupError);
      });

      return;
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const startJob = async (jobId: string) => {
    const id = String(jobId || "").trim(), uid = getCurrentUserId(), scope = operationalCommandScopeRef.current;
    if (!id || activeRole !== "driver" || !activeCompanyId) throw new Error("Selecione seu perfil de motorista para iniciar.");
    if (startJobInFlightRef.current.has(id)) return;
    startJobInFlightRef.current.add(id);
    try {
      if (getOperationalSuspension(currentUser as any).active) throw new Error("Suas atividades operacionais estão suspensas.");
      let target = jobs.find(job => job.id === id);
      if (!target && navigator.onLine !== false) {
        const row = await getDocFromServer(doc(db, "trabalhos", id));
        if (row.exists()) target = { ...row.data(), id } as Job;
      }
      assertOperationalCommandScope(uid, scope);
      if (!target || target.driverId !== uid || target.companyId !== activeCompanyId) throw new Error("Esta operação não está disponível para este motorista no aparelho.");
      if (["active", "delayed", "awaiting_completion"].includes(target.status)) return;
      if (target.status !== "pending") throw new Error("A operação não está aguardando início.");
      if (jobs.some(job => job.id !== id && job.driverId === uid && job.companyId === activeCompanyId && ["active", "delayed", "awaiting_completion"].includes(job.status))) throw new Error("Finalize sua operação atual antes de iniciar outra.");
      const company = companies.find(company => company.id === target!.companyId), contract = resolveOperationContract(target, contracts);
      const simulatorId = String(target.simulatorId || contract?.simulator || resolveAvailabilitySimulator(company, simulators) || "");
      assertCachedNewOperationAllowed(simulatorId);
      const command = { action: "start" as const, companyId: target.companyId, jobId: id };
      const managed = target.operationalCommandVersion === 1 || company?.operationalCommandVersion === 1;
      const requestId = managed ? canonicalOperationCommandService.reserveManagedRequestId(command) : operationalRequestId();
      const local = { ...target, status: "active", totalDeliveries: Number(target.totalDeliveries || contract?.totalDeliveries || 0), simulatorId,
        contractSnapshot: target.contractSnapshot || (contract ? { ...contract, snapshotVersion: 1 } : undefined) };
      await mirrorOperationStart(uid, target.companyId, id, true);
      assertOperationalCommandScope(uid, scope);
      try { operationOutbox.enqueueStart({ requestId, transport: managed ? "managed" : "legacy", command, job: local }); }
      catch (error) { if (!operationOutbox.startUnsettled(uid, id)) void mirrorOperationStart(uid, target.companyId, id, false); throw error; }
      toast.message("Início salvo neste aparelho. A confirmação será sincronizada.");
    } finally { startJobInFlightRef.current.delete(id); }
  };

  const startAutomaticOperation = async (next: QueueNext, vehicleId: string): Promise<void> => {
    const uid = getCurrentUserId(), scope = operationalCommandScopeRef.current, companyId = activeCompanyId;
    if (activeRole !== "driver" || !companyId || !next || !vehicleId) throw new Error("Escolha a operação e um veículo disponível.");
    if (getOperationalSuspension(currentUser as any).active) throw new Error("Suas atividades operacionais estão suspensas.");
    if (jobs.some(job => job.companyId === companyId && job.driverId === uid && ["active", "delayed", "awaiting_completion"].includes(job.status))) throw new Error("Finalize sua operação atual antes de iniciar outra.");
    const company = companies.find(company => company.id === companyId);
    const cache = await readOperationalQueueCache(automaticQueueScope(uid, companyId, "driver", String(company?.simulatorId || company?.simulatorName || "unknown")));
    const view = cache?.snapshot;
    if (!view || view.reason !== "ready" || view.next?.previewToken !== next.previewToken || view.next.contractId !== next.contractId || view.next.queueId !== next.queueId || view.configRevision !== next.configRevision || !view.vehicles.some(vehicle => vehicle.id === vehicleId)) throw new Error("A próxima operação não está salva neste aparelho ou foi atualizada. Confira a fila.");
    let contract = contracts.find(contract => contract.id === next.contractId && contract.companyId === companyId);
    if (!contract && navigator.onLine !== false) { const row = await getDocFromServer(doc(db, "contratos", next.contractId)); if (row.exists()) contract = { ...row.data(), id: row.id } as Contract; }
    assertOperationalCommandScope(uid, scope);
    if (!contract || contract.companyId !== companyId || contract.deleted || !Number.isSafeInteger(contract.deadlineDays) || contract.deadlineDays < 1) throw new Error("Os dados completos desta operação ainda não estão salvos no aparelho.");
    assertCachedNewOperationAllowed(view.simulatorId);
    const command = { action: "startAutomatic" as const, companyId, ...next, vehicleId };
    const requestId = canonicalOperationCommandService.reserveManagedRequestId(command), jobId = await automaticOperationJobId(uid, requestId);
    const vehicle = view.vehicles.find(vehicle => vehicle.id === vehicleId)!;
    const now = new Date().toISOString(), due = new Date(Date.now() + contract.deadlineDays * 86_400_000).toISOString();
    const local = { id: jobId, companyId, driverId: uid, motoristaId: uid, userId: uid, contractId: contract.id,
      contractName: contract.name, contractNameSnapshot: contract.name, contractSnapshot: { ...contract, snapshotVersion: 1 }, totalDeliveries: Number(contract.totalDeliveries),
      vehicleId, vehicleName: vehicle.name, vehiclePlate: vehicle.plate, trailerId: contract.trailerId || null, simulatorId: view.simulatorId,
      status: "active", progress: 0, createdAt: now, assignedAt: now, startedAt: now, deadlineDate: due, dueAt: due,
      queueId: next.queueId, queueRevision: next.configRevision, operationalCommandVersion: 1, operationReconciliationVersion: 4,
      operationProgressReconciled: true, operationProjectionSource: "new-operation-v4", operationSource: "operational-queue-v1" };
    await mirrorOperationStart(uid, companyId, jobId, true);
    assertOperationalCommandScope(uid, scope);
    try { operationOutbox.enqueueStart({ requestId, transport: "managed", command, job: local }); }
    catch (error) { if (!operationOutbox.startUnsettled(uid, jobId)) void mirrorOperationStart(uid, companyId, jobId, false); throw error; }
  };

  const finishJob = (jobId: string): Promise<ConfirmedOperationCompletion> => {
    const uid = getCurrentUserId(), scope = operationalCommandScopeRef.current;
    const job = jobs.find(job => job.id === jobId && job.driverId === uid && job.companyId === activeCompanyId);
    if (!job || activeRole !== "driver") return Promise.reject(new Error("Operação inválida para finalizar."));
    const key = JSON.stringify([uid, jobId]), existing = finishJobInFlightRef.current.get(key);
    if (existing) return existing;
    const execution = (async () => {
      const total = Number(resolveOperationContract(job, contracts)?.totalDeliveries || 0);
      const pending = await pendingOperationTripCount(uid, job.companyId, jobId);
      assertOperationalCommandScope(uid, scope);
      if (total < 1 || Number(job.progress || 0) + pending < total) throw new Error("Ainda faltam entregas nesta operação.");
      await mirrorOperationCapturePause(uid, job.companyId, jobId, true);
      try {
        assertOperationalCommandScope(uid, scope);
        operationOutbox.enqueueFinish({ ...job, totalDeliveries: total }, operationalRequestId());
      } catch (error) {
        if (!operationOutbox.pending(uid).some(entry => entry.jobId === jobId && entry.kind === "finish"))
          void mirrorOperationCapturePause(uid, job.companyId, jobId, false).catch(() => undefined);
        throw error;
      }
      return { pendingSync: true, completed: false, jobId, status: "pending_sync", progress: Number(job.progress || 0), total };
    })();
    finishJobInFlightRef.current.set(key, execution);
    const cleanup = () => finishJobInFlightRef.current.delete(key);
    void execution.then(cleanup, cleanup);
    return execution;
  };

  const cancelJob = async (jobId: string): Promise<boolean> => {
    let prevJobState: Job | undefined;
    try {
      console.log(
        "[cancelJob] INICIO - Solicitando cancelamento para o jobId:",
        jobId,
      );
      if (!jobId) {
        console.error("[cancelJob] ERRO: jobId é nulo ou indefinido!");
        toast.error("Erro: ID do trabalho ausente.");
        return false;
      }
      const uid = getCurrentUserId();
      const commandScope = operationalCommandScopeRef.current;
      const target = jobs.find(job => job.id === jobId);
      const companyId = target?.companyId || activeCompanyId;
      if (companyId && (target?.operationalCommandVersion === 1 || companies.find(company => company.id === companyId)?.operationalCommandVersion === 1)) {
        const result = await canonicalOperationCommandService.executeManaged({ action: "cancel", companyId, jobId });
        assertOperationalCommandScope(uid, commandScope);
        const confirmedJob = mergeManagedConfirmedJob({ ...(result.currentJob || result.job), id: jobId } as Job);
        setJobs(current => current.map(job => job.id === jobId ? mergeManagedOperationAcknowledgement(job, confirmedJob) : job).filter(job => !job.archived));
        toast.success("Trabalho cancelado com sucesso!");
        return true;
      }
      console.log("[cancelJob] User UID:", uid);

      const docRef = doc(db, "trabalhos", jobId);
      console.log("[cancelJob] Verificando existência...");
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        console.error("[cancelJob] Documento não encontrado no Firestore!");
        toast.error("Erro: Operação não encontrada no servidor.");
        return false;
      }

      console.log(
        "[cancelJob] Referência do documento criada, chamando updateDoc...",
      );

      // Salva snapshot antigo para caso de rollback
      prevJobState = jobs.find((j) => j.id === jobId);

      // Força alteração da UI instantaneamente para sensação de realtime
      setJobs((prev: Job[]) =>
        prev.map((j: Job) =>
          j.id === jobId ? { ...j, status: "cancelled" as const } : j,
        ),
      );

      await canonicalOperationCommandService.setLifecycleStatus(jobId, { status: "cancelled" });
      console.log("[cancelJob] updateDoc 'trabalhos' concluído com sucesso.");

      const job = prevJobState || jobs.find((j) => j.id === jobId);
      if (job) {
        console.log(
          "[cancelJob] Trabalho encontrado no local state, liberando vínculos. Vehicle:",
          job.vehicleId,
          "Trailer:",
          job.trailerId,
        );
        if (job.vehicleId) {
          try {
            await updateDoc(doc(db, "veiculos", job.vehicleId), {
              status: "available",
            });
          } catch (err) {
            console.error("[cancelJob] Ignorado erro ao liberar veiculo", err);
          }
        }
        if (job.trailerId) {
          try {
            await updateDoc(doc(db, "reboques", job.trailerId), {
              status: "available",
            });
          } catch (err) {
            console.error("[cancelJob] Ignorado erro ao liberar reboque", err);
          }
        }
      } else {
        console.warn(
          "[cancelJob] AVISO: Trabalho NÃO encontrado no local state 'jobs'!",
        );
      }
      toast.success("Trabalho cancelado com sucesso!");
      return true;
    } catch (e: any) {
      console.error("[cancelJob] ERRO FATAL:", e);
      // Rollback da UI
      if (prevJobState) {
        setJobs((prev: Job[]) =>
          prev.map((j) => (j.id === jobId ? prevJobState! : j)),
        );
      }
      if (e.code) {
        console.error("Error Code:", e.code);
      }
      if (e.message) {
        console.error("Error Message:", e.message);
      }

      const debugInfo = `Falha ao cancelar!\nID: ${jobId}\nUID: ${getCurrentUserId()}\nRole: ${currentUser?.role || "null"}\nPayload: { status: 'cancelled' }\nErro: ${e.code || "unknown"} - ${e.message || String(e)}`;
      toast.error(debugInfo, {
        duration: 15000,
        style: { minWidth: "350px", whiteSpace: "pre-wrap" },
      });
      handleFirebaseError(e);
      return false;
    }
  };

  /** Links another vehicle of the same company to an open job. Throws, so the caller can offer a retry. */
  const changeJobVehicle = async (jobId: string, vehicleId: string): Promise<void> => {
    const uid = getCurrentUserId();
    const commandScope = operationalCommandScopeRef.current;
    const target = jobs.find(job => job.id === jobId);
    const companyId = target?.companyId || activeCompanyId;
    if (!jobId || !vehicleId || !companyId) throw new Error("Selecione o trabalho e o veículo.");
    const result = await canonicalOperationCommandService.executeManaged({ action: "changeVehicle", companyId, jobId, vehicleId });
    assertOperationalCommandScope(uid, commandScope);
    const confirmedJob = mergeManagedConfirmedJob({ ...(result.currentJob || result.job), id: jobId } as Job);
    setJobs(current => current.map(job => job.id === jobId ? mergeManagedOperationAcknowledgement(job, confirmedJob) : job));
    toast.success("Veículo da operação atualizado.");
  };

  const deleteJob = async (jobId: string) => {
    let prevJobState: Job | undefined;
    try {
      console.log(
        "[deleteJob] INICIO - Solicitando exclusão para o jobId:",
        jobId,
      );
      if (!jobId) {
        console.error("[deleteJob] ERRO: jobId incompleto.");
        toast.error("Erro ao excluir. ID ausente.");
        return;
      }
      const uid = getCurrentUserId();
      const commandScope = operationalCommandScopeRef.current;
      const target = jobs.find(job => job.id === jobId);
      const companyId = target?.companyId || activeCompanyId;
      if (companyId && (target?.operationalCommandVersion === 1 || companies.find(company => company.id === companyId)?.operationalCommandVersion === 1)) {
        const result = await canonicalOperationCommandService.executeManaged({ action: "archive", companyId, jobId });
        assertOperationalCommandScope(uid, commandScope);
        mergeManagedConfirmedJob({ ...(result.currentJob || result.job), id: jobId } as Job);
        setJobs(current => current.filter(job => job.id !== jobId));
        if (activeRole) {
          const key = buildOperationalScopeKey(uid, companyId, activeRole);
          const cached = readOperationalScopeSnapshot(key);
          if (cached?.jobs) mergeOperationalScopeSnapshot(key, { jobs: cached.jobs.filter(job => job.id !== jobId) });
        }
        toast.success("Trabalho retirado da listagem. O histórico foi preservado.");
        return;
      }
      console.log("[deleteJob] User UID:", uid);

      const docRef = doc(db, "trabalhos", jobId);

      console.log("[deleteJob] Verificando existência...");
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        console.error("[deleteJob] Documento não encontrado no Firestore!");
        toast.error("Erro: Operação não encontrada no servidor.");
        return;
      }

      console.log("[deleteJob] Chamando deleteDoc...");

      prevJobState = jobs.find((j) => j.id === jobId);

      // Força alteração da UI instantaneamente para sensação de realtime
      setJobs((prev: Job[]) => prev.filter((j: Job) => j.id !== jobId));

      await deleteDoc(docRef);
      console.log("[deleteJob] deleteDoc finalizado.");
      toast.success("Histórico de trabalho excluído com sucesso!");
    } catch (e: any) {
      console.error("[deleteJob] ERRO FATAL:", e);
      // Rollback
      if (prevJobState) {
        setJobs((prev: Job[]) => {
          // Avoid duplicating if onSnapshot already fetched it
          if (prev.find((j) => j.id === jobId)) return prev;
          return [...prev, prevJobState!];
        });
      }
      if (e.code) {
        console.error("Error Code:", e.code);
      }
      if (e.message) {
        console.error("Error Message:", e.message);
      }

      const debugInfo = `Falha ao excluir!\nID: ${jobId}\nUID: ${getCurrentUserId()}\nRole: ${currentUser?.role || "null"}\nErro: ${e.code || "unknown"} - ${e.message || String(e)}`;
      toast.error(debugInfo, {
        duration: 15000,
        style: { minWidth: "350px", whiteSpace: "pre-wrap" },
      });
      handleFirebaseError(e);
    }
  };

  const requestJoinCompany = async (companyId: string) => {
    try {
      const uid = getCurrentUserId();
      if (!companyId) return;

      // Check if already requested
      const hasPending = driverRequests.some(
        (r) => r.empresaId === companyId && r.status === "pending",
      );
      if (hasPending) {
        alert("Você já tem uma solicitação pending para esta empresa.");
        return;
      }

      const activeCompany = companies.find((c) => c.id === companyId);

      await addDoc(collection(db, "solicitacoes_motoristas"), {
        motoristaId: uid,
        empresaId: companyId,
        simulatorId: (activeCompany as any)?.simulatorId || (activeCompany ? resolveSimulatorId(activeCompany as any) : ""),
        adminId: activeCompany?.userId || "", // Adiciona adminId para regras de segurança
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Notifica proprietário e todos os administradores ativos da empresa.
      if (activeCompany) {
        try {
          await createCorporateNotifications({
            companyId,
            type: "WORK_REQUEST",
            title: "Nova solicitação de entrada",
            message: `${currentUser?.name || "Um motorista"} solicitou entrada na empresa ${activeCompany.companyName}.`,
            metadata: { driverId: uid },
            dedupeKey: `JOIN_COMPANY_${companyId}_${uid}`,
          });
        } catch (notificationError) {
          console.error(
            "[NVU Notifications] A solicitação foi salva, mas o aviso corporativo falhou:",
            notificationError,
          );
        }
      }

      alert("Solicitação enviada com sucesso!");
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const cancelRequestJoinCompany = async (requestId: string) => {
    try {
      getCurrentUserId();
      await deleteDoc(doc(db, "solicitacoes_motoristas", requestId));
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const approveDriver = async (requestId: string) => {
    try {
      getCurrentUserId();
      const req = driverRequests.find((row) => row.id === requestId);
      const companyId = String(req?.empresaId || activeCompanyId || "");
      const result = await manageFleetMembership({ action: "approve-request", companyId, requestId });
      applyApprovedFleetAck(result);
      toast.success("Motorista aprovado e vínculo sincronizado.");
    } catch (e) { handleFirebaseError(e); throw e; }
  };

  const rejectDriver = async (requestId: string) => {
    try {
      await rejectDriverRequestOnServer(requestId);
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };


  const switchRole = async (role: Role, newCompanyId?: string) => {
    if (!currentUser || auth.currentUser?.uid !== currentUser.id || isAuthTeardownActive()) return;

    const targetCompanyId =
      newCompanyId || activeCompanyId || currentUser.companyId;
    if (!targetCompanyId) return;

    const membership = memberships.find(
      (item) =>
        item.companyId === targetCompanyId && item.status === "active",
    );
    const memberRoles = resolveMembershipRoles(
      membership,
      currentUser,
    ) as Role[];
    const targetCompany = companies.find(
      (company) => company.id === targetCompanyId,
    );
    const isOwner = Boolean(
      targetCompany &&
        (targetCompany.ownerId === currentUser.id ||
          targetCompany.userId === currentUser.id),
    );

    const hasSeniorAccess =
      hasSeniorPanelAccess &&
      isSeniorAuthenticated &&
      (seniorCompanyId === targetCompanyId || newCompanyId === targetCompanyId);
    const ownerAdminAccess = isOwner && role === "admin";
    const hasMembershipAccess = Boolean(
      membership && memberRoles.includes(role),
    );
    if (!hasMembershipAccess && !hasSeniorAccess && !ownerAdminAccess) {
      return;
    }

    const effectiveRoles: Role[] = Array.from(
      new Set<Role>(
        hasSeniorAccess
          ? ["admin"]
          : [
              ...memberRoles,
              role,
              ...(ownerAdminAccess ? (["admin", "driver"] as Role[]) : []),
            ],
      ),
    );

    // Commit the UI context synchronously. The previous implementation waited
    // for Firestore before navigation, creating a visible loading intermission
    // every time the user changed profiles. Authorization has already been
    // checked against the active membership above; persistence can complete in
    // the background without blocking the destination screen.
    setActiveRole(role);
    setActiveCompanyId(targetCompanyId);
    writeLocalStorageValue(sessionActiveRoleKey(currentUser.id), role);
    writeLocalStorageValue(sessionActiveCompanyKey(currentUser.id), targetCompanyId);

    if (hasSeniorAccess) {
      setCurrentUser({ ...currentUser });
      return;
    }

    const latestUser = currentUserRef.current?.id === currentUser.id ? currentUserRef.current : currentUser;
    // Always commit the latest local choice, but do not write an unchanged
    // preference to Firestore. The ref also sees an uncommitted earlier choice.
    if (latestUser.role === role && latestUser.companyId === targetCompanyId) return;

    const optimisticUser: User = {
      ...latestUser,
      role,
      companyId: targetCompanyId,
      roles: effectiveRoles,
    };
    currentUserRef.current = optimisticUser;
    setCurrentUser(optimisticUser);
    writeCachedSessionUser(optimisticUser);

    void updateDoc(doc(db, "users", currentUser.id), {
      role,
      companyId: targetCompanyId,
    }).catch((error) => {
      if (!isAuthTeardownActive()) {
        console.error("Failed to persist role/company switch:", error);
      }
    });
  };

  const setFleetRole = async (driverId: string, role: "admin" | "driver") => {
    getCurrentUserId();
    if (!activeCompanyId) throw new Error("Selecione a empresa antes de alterar o vínculo.");
    try { await manageFleetMembership({action:"set-role",companyId:activeCompanyId,targetUserId:driverId,role}); }
    catch (error) { handleFirebaseError(error); throw error; }
  };
  const promoteDriverToAdmin = (driverId: string) => setFleetRole(driverId, "admin");
  const demoteAdminToDriver = (driverId: string) => setFleetRole(driverId, "driver");

  const updateUserOnlineStatus = async (isOnline: boolean) => {
    try {
      const uid = getCurrentUserId();
      if (isOnline && getOperationalSuspension(currentUser as any).active) {
        throw new Error(
          "Você não pode ficar disponível enquanto a suspensão operacional estiver ativa.",
        );
      }
      await updateDoc(doc(db, "users", uid), { isOnline });
      if (currentUser) {
        setCurrentUser({ ...currentUser, isOnline });
      }
    } catch (e) {
      handleFirebaseError(e);
    }
  };

  const removeDriverFromFleet = async (driverId: string, companyIdOverride?: string) => {
    try {
      getCurrentUserId();
      const companyId = companyIdOverride || activeCompanyId;
      if (!companyId || !driverId) throw new Error("Empresa ou motorista inválido para remoção.");
      await manageFleetMembership({ action: "remove", companyId, targetUserId: driverId });
      if (auth.currentUser?.uid !== currentUserId) return;
      setAllCompanyMembers(rows => rows.filter(row => !(row.companyId === companyId && row.userId === driverId)));
      const removeScope = (user: User): User => {
        if (user.id !== driverId) return user;
        const memberships = { ...user.memberships }; delete memberships[companyId];
        return { ...user, memberships, ...(user.companyId === companyId ? { companyId: null, status: "pending" as const, roles: ["driver" as const], role: "driver" as const } : {}) };
      };
      setUsers(rows => rows.map(removeScope));
      setFetchedMissingUsers(rows => rows.map(removeScope));
      toast.success("Motorista removido da empresa com sucesso.");
    } catch (e) { handleFirebaseError(e); throw e; }
  };

  const createManualDriver = async (driverData: Partial<User>) => {
    try {
      if (!activeCompanyId) throw new Error("Nenhuma empresa ativa.");

      const email = driverData.email;
      if (!email) throw new Error("Email é obrigatório.");

      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("Não autenticado");

      // Verificamos se há algum usuário no sistema com este email
      const result = await lookupPrivateProfiles({ email: email.trim().toLowerCase(), companyId: activeCompanyId, existenceOnly: true });
      if (result.exists) {
        throw new Error(
          "Já existe um usuário com este email. Use o fluxo de convite ou peça para ele se inscrever.",
        );
      }

      const newDocRef = doc(collection(db, "users"));
      const newUserId = newDocRef.id;

      const payload = {
        id: newUserId,
        email: email.trim().toLowerCase(),
        name: driverData.name || "Motorista",
        whatsapp: driverData.whatsapp || "",
        profilePhotoURL: driverData.profilePhotoURL || "",
        status: "active",
        companyId: activeCompanyId,
        role: "driver",
        roles: ["driver"],
        createdAt: new Date().toISOString(),
      };

      await setDoc(newDocRef, payload);

      // Criar companyMember
      await addDoc(collection(db, "companyMembers"), {
        userId: newUserId,
        companyId: activeCompanyId,
        roles: ["driver"],
        status: "active",
        permissions: [],
        joinedAt: new Date().toISOString(),
      });
      syncSingleSimulatorMember(newUserId, activeCompanyId, "active", ["driver"]);
    } catch (e) {
      console.error("Erro ao criar motorista manual:", e);
      handleFirebaseError(e);
      throw e;
    }
  };

  const requestNewJobDemand = async () => {
    try {
      const uid = getCurrentUserId();
      const suspension = getOperationalSuspension(currentUser as any);
      if (suspension.active) {
        throw new Error(
          "Suas atividades operacionais estão suspensas. Aguarde o término da suspensão para solicitar um novo trabalho.",
        );
      }
      const targetCompanyId = activeCompanyId || currentUser?.companyId;
      if (!targetCompanyId)
        throw new Error(
          "Você precisa estar em uma empresa para solicitar demandas.",
        );

      // Check if already requested
      const existing = jobDemands.find(
        (d) =>
          d.driverId === uid &&
          d.status === "pending" &&
          d.companyId === targetCompanyId,
      );
      if (existing) return; // Already pending

      const payload = {
        driverId: uid,
        companyId: targetCompanyId,
        status: "pending",
        createdAt: new Date().toISOString(),
      };

      const demandRef = await addDoc(collection(db, "jobDemands"), payload);

      const driverName = currentUser?.name || "Um motorista";
      try {
        await createCorporateNotifications({
          companyId: targetCompanyId,
          type: "WORK_REQUEST",
          title: "Nova solicitação de trabalho",
          message: `${driverName} solicitou uma nova operação.`,
          metadata: { demandId: demandRef.id, driverId: uid },
          dedupeKey: `WORK_REQUEST_${demandRef.id}`,
        });

      } catch (notificationError) {
        console.error(
          "[NVU Notifications] A solicitação foi salva, mas o aviso corporativo falhou:",
          notificationError,
        );
      }
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const cancelJobDemand = async () => {
    try {
      const uid = getCurrentUserId();
      const targetCompanyId = activeCompanyId || currentUser?.companyId;
      const existing = jobDemands.find(
        (d) =>
          d.driverId === uid &&
          d.status === "pending" &&
          d.companyId === targetCompanyId,
      );
      if (!existing) return;

      await deleteDoc(doc(db, "jobDemands", existing.id));
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const rejectJobDemand = async (demandId: string) => {
    try {
      const uid = getCurrentUserId();
      await updateDoc(doc(db, "jobDemands", demandId), { status: "rejected" });

      // Notify driver
      const demand = jobDemands.find((d) => d.id === demandId);
      if (demand) {
        await createNotification({
          userId: demand.driverId,
          companyId: demand.companyId,
          targetProfile: "driver",
          type: "JOB_REQUEST_REJECTED",
          title: "Solicitação recusada",
          message:
            "Sua solicitação de nova operação foi recusada no momento. Aguarde ou informe o administrador.",
          dedupeKey: `JOB_REQUEST_REJECTED_${demandId}`,
        });
      }
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const registerUser = (
    userData: Pick<User, "name" | "email" | "password" | "role">,
  ) => {
    // This is handled via Firebase Auth in the Login component now, we don't need this local function.
  };

  const addVehicle = async (
    data: Omit<Vehicle, "id" | "status" | "companyId">,
  ) => {
    try {
      if (!activeCompanyId) throw new Error("Selecione uma empresa antes de salvar.");
      const uid = getCurrentUserId();
      await addDoc(collection(db, "veiculos"), {
        ...data,
        userId: uid,
        companyId: activeCompanyId,
        plate: data.plate || "---",
        status: "available",
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const updateVehicle = async (
    id: string,
    updates: Partial<Omit<Vehicle, "id">>,
  ) => {
    try {
      getCurrentUserId();
      await updateDoc(doc(db, "veiculos", id), updates);
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const deleteVehicle = async (id: string) => {
    try {
      getCurrentUserId();
      await deleteDoc(doc(db, "veiculos", id));
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const addTrailer = async (
    data: Omit<Trailer, "id" | "status" | "companyId">,
  ) => {
    try {
      if (!activeCompanyId) throw new Error("Selecione uma empresa antes de salvar.");
      const uid = getCurrentUserId();
      await addDoc(collection(db, "reboques"), {
        ...data,
        userId: uid,
        companyId: activeCompanyId,
        plate: data.plate || "---",
        status: "available",
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const updateTrailer = async (
    id: string,
    updates: Partial<Omit<Trailer, "id">>,
  ) => {
    try {
      getCurrentUserId();
      await updateDoc(doc(db, "reboques", id), updates);
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const deleteTrailer = async (id: string) => {
    try {
      getCurrentUserId();
      await deleteDoc(doc(db, "reboques", id));
    } catch (e) {
      handleFirebaseError(e);
      throw e;
    }
  };

  const logOutApp = async () => {
    // Prevent duplicate taps from starting overlapping Auth/Firestore teardowns.
    if (isLoggingOutRef.current) return;
    const logoutUid = auth.currentUser?.uid || currentUserRef.current?.id || null;
    isLoggingOutRef.current = true;
    // Invalidate every in-flight callback immediately, before signOut and before
    // the next login can reuse the same Google UID.
    authSessionGenerationRef.current += 1;
    setIdentityReconciliationStatus("idle");
    setMembershipsUiReady(false);
    // Notify page-level hooks and long-lived services before Auth is revoked.
    // They can unsubscribe synchronously and ignore any late callbacks.
    beginAuthTeardown();
    const pushLogoutCleanup = clearPushRegistrationContext();

    // End the native GTO session before authentication is revoked. R3.1 keeps
    // an already-confirmed delivery in its durable retry queue, but discards an
    // unfinished route so it can never leak into the next account on a shared device.
    try {
      if (isNativeAndroid() && isGtoObserverAvailable()) {
        await GtoObserver.logoutCleanup();
      }
    } catch (gtoLogoutError) {
      // Older APKs may not expose logoutCleanup yet. Logout must still proceed.
      console.warn("[NVU Logout] GTO native cleanup warning:", gtoLogoutError);
    }

    // Stop every AppContext listener that requires authentication before
    // revoking Firebase Auth. This ordering prevents the transient
    // permission-denied error reported by Google AI Studio.
    const authenticatedUnsubscribes = [
      privateSubscriptionsUnsubscribeRef.current,
      membershipsUnsubscribeRef.current,
      userDocumentUnsubscribeRef.current,
    ];

    privateSubscriptionsUnsubscribeRef.current = null;
    membershipsUnsubscribeRef.current = null;
    userDocumentUnsubscribeRef.current = null;

    for (const unsubscribe of authenticatedUnsubscribes) {
      try {
        unsubscribe?.();
      } catch (unsubscribeError) {
        // Cleanup is best-effort and must never block logout.
        console.warn("[NVU Logout] Listener cleanup warning:", unsubscribeError);
      }
    }

    // Keep only an in-memory presentation snapshot for an immediate re-login
    // with the same Firebase UID. It is discarded for another UID and never
    // counts as server authorization.
    if (logoutUid && membershipsRef.current.length > 0) {
      reauthMembershipsRef.current = {
        uid: logoutUid,
        memberships: membershipsRef.current.map((membership) => ({
          ...membership,
          roles: [...membership.roles],
          permissions: [...membership.permissions],
        })),
      };
    } else {
      reauthMembershipsRef.current = null;
    }
    clearSessionResumeRoute(logoutUid);

    // Clear private UI state first. ProtectedRoute then unmounts page-level
    // listeners before signOut removes Firestore authorization.
    currentUserRef.current = null;
    membershipsRef.current = [];
    confirmedMembershipsRef.current = null;
    setFirebaseSessionUid(null);
    setCurrentUser(null);
    setActiveCompanyId(null);
    setActiveRole(null);
    setIsSeniorAuthenticated(false);
    setSeniorCompanyId(null);
    setMemberships([]);
    setMembershipsLoaded(false);
    setAllCompanyMembers([]);
    setUsers([]);
    setFetchedMissingUsers([]);
    setVehicles([]);
    setTrailers([]);
    setContracts([]);
    setSequences([]);
    setJobs([]);
    setJobDemands([]);
    setDriverRequests([]);
    setRecruitmentApplications([]);
    setSessionRecovering(false);
    clearCachedSession(logoutUid);
    if (logoutUid) clearTripHistoryCacheForUser(logoutUid);
    clearAllPrivateClientCaches();

    clearSessionStorage();

    // Give React one paint to unmount route/page subscriptions. This is
    // especially important in the AI Studio iframe and Android WebView.
    await new Promise<void>((resolve) => {
      if (
        typeof window !== "undefined" &&
        typeof window.requestAnimationFrame === "function"
      ) {
        window.requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 0);
      }
    });

    await pushLogoutCleanup;
    try {
      await signOut(auth);
    } catch (error) {
      // Avoid console.error here: embedded previews display it as a runtime
      // crash even after the interface completed a safe logout.
      console.warn("[NVU Logout] Firebase signOut warning:", error);
    }

    // The Android login uses both Firebase JS Auth and the native
    // @capacitor-firebase/authentication session. Signing out only the JS side
    // leaves the previous Google account available to the next registration.
    try {
      if (Capacitor.isNativePlatform()) {
        await FirebaseAuthentication.signOut();
      }
    } catch (nativeSignOutError) {
      console.warn("[NVU Logout] Native signOut warning:", nativeSignOutError);
    } finally {
      endAuthTeardown();
      isLoggingOutRef.current = false;
      setAuthInitialized(true);
    }
  };

  // Resource release already belongs to the canonical completion/cancel
  // transaction/trigger. A driver's scoped or cached jobs list cannot prove
  // that another driver's vehicle/trailer is free. Do not write resource
  // availability from incomplete UI snapshots.
  const syncCompanyData = async () => {
    if (isLoggingOutRef.current || isAuthTeardownActive() || !auth.currentUser) return;
    const { SyncManager } = await import("../services/syncManager");
    await SyncManager.syncPendingTrips();
  };

  const combinedUsersRaw = useMemo(() => {
    const merged = [...users];
    const company = companies.find(row => row.id === activeCompanyId);
    const displayIds = new Set([
      ...allCompanyMembers.filter(member => member.companyId === activeCompanyId && member.status === "active").map(member => member.userId),
      company?.ownerId, company?.userId,
      ...jobs.filter(job => job.companyId === activeCompanyId).map(job => job.driverId),
    ]);
    fetchedMissingUsers.forEach((missingUser) => {
      if (displayIds.has(missingUser.id) && !merged.some((user) => user.id === missingUser.id)) merged.push(missingUser);
    });

    if (currentUser && !merged.some((user) => user.id === currentUser.id)) {
      const belongsToActiveCompany = Boolean(
        activeCompanyId &&
          (currentUser.companyId === activeCompanyId ||
            currentUser.memberships?.[activeCompanyId] ||
            company?.ownerId === currentUser.id || company?.userId === currentUser.id ||
            allCompanyMembers.some((member) => member.companyId === activeCompanyId && member.userId === currentUser.id && member.status === "active")),
      );
      if (belongsToActiveCompany) merged.push(currentUser);
    }

    return merged.map(user => {
      const member = allCompanyMembers.find(row => row.userId === user.id && row.companyId === activeCompanyId && row.status === "active");
      if (!member) return user;
      return { ...user, roles: resolveMembershipRoles(member, undefined) as Role[], role: (member.roles?.includes("admin") || (member.roles as string[] | undefined)?.includes("owner")) ? "admin" as const : "driver" as const };
    });
  }, [
    activeCompanyId,
    allCompanyMembers,
    currentUser,
    fetchedMissingUsers,
    companies,
    jobs,
    users,
  ]);

  const combinedUsers = useDriverDisplayProfiles(combinedUsersRaw, activeCompanyId || "", currentUserId || "");

  const scopedJobDemands = useMemo(
    () =>
      jobDemands.filter(
        (demand) =>
          demand.companyId === activeCompanyId ||
          demand.driverId === currentUser?.id,
      ),
    [activeCompanyId, currentUser?.id, jobDemands],
  );

  const scopedDriverRequests = useMemo(
    () =>
      driverRequests.filter(
        (request) =>
          request.empresaId === activeCompanyId ||
          request.motoristaId === currentUser?.id,
      ),
    [activeCompanyId, currentUser?.id, driverRequests],
  );

  const scopedRecruitmentApplications = useMemo(
    () =>
      recruitmentApplications.filter(
        (application) =>
          application.companyId === activeCompanyId ||
          (currentUser?.id && application.userId === currentUser.id) ||
          (currentUser?.email &&
            application.email?.toLowerCase() === currentUser.email.toLowerCase()),
      ),
    [
      activeCompanyId,
      currentUser?.email,
      currentUser?.id,
      recruitmentApplications,
    ],
  );

  const visibleCompanies = useMemo(
    () =>
      hasSeniorPanelAccess
        ? companies
        : companies.filter((company) =>
            memberships.some((membership) => membership.companyId === company.id),
          ),
    [companies, hasSeniorPanelAccess, memberships],
  );

  const stableCreateSequence = useStableEvent(createSequence);
  const stableUpdateSequence = useStableEvent(updateSequence);
  const stableDeleteSequence = useStableEvent(deleteSequence);
  const stableCreateCompany = useStableEvent(createCompany);
  const stableUpdateCompany = useStableEvent(updateCompany);
  const stableDeleteCompany = useStableEvent(deleteCompany);
  const stableCreateContract = useStableEvent(createContract);
  const stableUpdateContract = useStableEvent(updateContract);
  const stableDeleteContract = useStableEvent(deleteContract);
  const stableAssignJob = useStableEvent(assignJob);
  const stableStartJob = useStableEvent(startJob);
  const stableStartAutomaticOperation = useStableEvent(startAutomaticOperation);
  const stableFinishJob = useStableEvent(finishJob);
  const stableCancelJob = useStableEvent(cancelJob);
  const stableChangeJobVehicle = useStableEvent(changeJobVehicle);
  const stableDeleteJob = useStableEvent(deleteJob);
  const stableRequestJoinCompany = useStableEvent(requestJoinCompany);
  const stableCancelRequestJoinCompany = useStableEvent(cancelRequestJoinCompany);
  const stableApproveDriver = useStableEvent(approveDriver);
  const stableRejectDriver = useStableEvent(rejectDriver);
  const stableCreateManualDriver = useStableEvent(createManualDriver);
  const stableRegisterUser = useStableEvent(registerUser);
  const stableRequestNewJobDemand = useStableEvent(requestNewJobDemand);
  const stableCancelJobDemand = useStableEvent(cancelJobDemand);
  const stableRejectJobDemand = useStableEvent(rejectJobDemand);
  const stableSyncCompanyData = useStableEvent(syncCompanyData);
  const stableAddVehicle = useStableEvent(addVehicle);
  const stableUpdateVehicle = useStableEvent(updateVehicle);
  const stableDeleteVehicle = useStableEvent(deleteVehicle);
  const stableAddTrailer = useStableEvent(addTrailer);
  const stableUpdateTrailer = useStableEvent(updateTrailer);
  const stableDeleteTrailer = useStableEvent(deleteTrailer);
  const stableLogOutApp = useStableEvent(logOutApp);
  const stableSwitchRole = useStableEvent(switchRole);
  const stablePromoteDriverToAdmin = useStableEvent(promoteDriverToAdmin);
  const stableDemoteAdminToDriver = useStableEvent(demoteAdminToDriver);
  const stableRemoveDriverFromFleet = useStableEvent(removeDriverFromFleet);
  const stableUpdateUserOnlineStatus = useStableEvent(updateUserOnlineStatus);
  const stableUpdateRecruitmentSettings = useStableEvent(updateRecruitmentSettings);
  const stableSubmitRecruitmentApplication = useStableEvent(submitRecruitmentApplication);
  const stableApproveRecruitmentApplication = useStableEvent(approveRecruitmentApplication);
  const stableRejectRecruitmentApplication = useStableEvent(rejectRecruitmentApplication);
  const stableDeleteRecruitmentApplication = useStableEvent(deleteRecruitmentApplication);
  const stableRefreshSession = useStableEvent(refreshSession);
  const stableConfirmCanonicalMemberships = useStableEvent(confirmCanonicalMemberships);
  const stableLoadCompanyCatalog = useStableEvent(loadCompanyCatalog);
  const stableLoadCompanyById = useStableEvent(loadCompanyById);
  const stablePrimeCompanyProfile = useStableEvent(primeCompanyProfile);
  useEffect(() => {
    const handleProgressReconciled = (rawEvent: Event) => {
      const detail = (rawEvent as CustomEvent<any>).detail || {};
      const jobId = String(detail.jobId || "").trim();
      const progress = Math.max(0, Number(detail.progress || 0));
      if (!jobId || detail.source !== "validated-server-trips") return;
      setJobs((current) => applyAuthoritativeJobProjection(current, jobId, progress));
    };
    window.addEventListener("nvu-operation-progress-reconciled", handleProgressReconciled);
    return () => window.removeEventListener("nvu-operation-progress-reconciled", handleProgressReconciled);
  }, []);

  useEffect(() => {
    const handleIntegrityChecked = (rawEvent: Event) => {
      const detail = (rawEvent as CustomEvent<any>).detail || {};
      const jobId = String(detail.jobId || "").trim();
      const progress = Math.max(0, Number(detail.progress || 0));
      if (!jobId || detail.source !== "canonical-server-trips") return;
      if (detail.userId && detail.userId !== currentUserRef.current?.id) return;
      const status = typeof detail.status === "string" && detail.status.trim() ? detail.status : undefined;
      setJobs((current) => applyAuthoritativeJobProjection(current, jobId, progress, status));
    };
    window.addEventListener("nvu-operation-integrity-checked", handleIntegrityChecked);
    return () => window.removeEventListener("nvu-operation-integrity-checked", handleIntegrityChecked);
  }, []);

  useInitialOperationIntegrity({
    uid: currentUser?.id || "",
    enabled: Boolean(firebaseSessionUid && currentUser?.id === firebaseSessionUid),
    jobs,
    contracts,
  });

  useEffect(() => {
    const handleValidatedTrip = async (rawEvent: Event) => {
      const detail = (rawEvent as CustomEvent<any>).detail || {};
      const jobId = String(detail.jobId || "").trim();
      if (!jobId || isAuthTeardownActive()) return;
      try {
        // Server validation may move a full operation to `awaiting_completion`,
        // but it must never press the driver's Finalizar Operação action.
        await canonicalTripOperationService.syncJobProgress(jobId);
      } catch (error) {
        console.warn("[NVU] Reconciliação de operação após validação offline será repetida na próxima atualização:", error);
      }
    };
    window.addEventListener("nvu-offline-trip-validated", handleValidatedTrip);
    return () => window.removeEventListener("nvu-offline-trip-validated", handleValidatedTrip);
  }, []);

  const sessionProjection = projectAuthSession({
    authInitialized,
    firebaseSessionUid,
    currentUserId: currentUser?.id || null,
    visualIdentityReady: Boolean(currentUser?.id),
    sessionRecovering,
    membershipsLoaded,
  });
  const sessionReady = sessionProjection.sessionAuthorized;
  const profileIndex = useMemo(
    () =>
      buildProfileIndex({
        uid: currentUser?.id,
        memberships,
        membershipsLoaded,
        membershipsHydrated: membershipsUiReady,
        companies,
        simulators,
        currentUser,
      }),
    [
      companies,
      currentUser,
      currentUser?.id,
      memberships,
      membershipsLoaded,
      membershipsUiReady,
      simulators,
    ],
  );
  const activeProfileContext = useMemo(() => {
    if (!activeRole || !activeCompanyId || profileIndex.status !== "ready") {
      return null;
    }
    const activeProfile = profileIndex.profiles.find(
      (profile) =>
        profile.role === activeRole && profile.companyId === activeCompanyId,
    );
    return activeProfile ? toActiveProfileContext(activeProfile) : null;
  }, [
    activeCompanyId,
    activeRole,
    profileIndex,
  ]);
  // The selector is a safe authenticated UI surface. A UID-scoped local
  // snapshot may mount it before Firebase settles; membership rows reconcile
  // from cache/server afterward. Protected Admin/Driver routes continue to use
  // strict sessionReady and never use this visual fast path.
  const sessionUiReady = sessionProjection.sessionUiReady;

  useEffect(() => {
    const uid = String(firebaseSessionUid || currentUser?.id || "").trim();
    if (
      !uid ||
      !currentUser ||
      currentUser.id !== uid ||
      firebaseSessionUid !== uid ||
      isAuthTeardownActive()
    ) {
      return;
    }

    const activeMemberships = memberships.filter(
      (membership) =>
        membership.status === "active" &&
        membership.userId === uid &&
        Boolean(membership.companyId),
    );
    const membershipCompanyIds = Array.from(
      new Set(activeMemberships.map((membership) => membership.companyId)),
    );
    const hasAllMembershipCompanies =
      membershipCompanyIds.length > 0 &&
      membershipCompanyIds.every((companyId) =>
        companies.some((company) => company.id === companyId),
      );

    // Never persist a partial offline context. The snapshot is only a visual
    // warm-start boundary; strict server authorization remains separate.
    if (
      !hasAllMembershipCompanies ||
      profileIndex.status !== "ready" ||
      profileIndex.profiles.length === 0
    ) {
      return;
    }

    const snapshotUser = { ...currentUser };
    delete snapshotUser.password;
    const snapshot = {
      uid,
      user: snapshotUser as unknown as Record<string, unknown>,
      memberships: activeMemberships.map((membership) => ({ ...membership })),
      companies: companies
        .filter((company) => membershipCompanyIds.includes(company.id))
        .map((company) => ({ ...company })),
      simulators: simulators.map((simulator) => ({ ...simulator })),
      activeCompanyId: activeCompanyId || null,
      activeRole: activeRole || null,
      profileContext: activeProfileContext
        ? { ...activeProfileContext }
        : null,
    };
    const signature = JSON.stringify(snapshot);
    if (signature === offlineSnapshotSignatureRef.current) return;

    if (writeOfflineSessionSnapshot(snapshot)) {
      offlineSnapshotSignatureRef.current = signature;
      markSessionBootEvent(
        "SNAPSHOT_READ",
        {
          uidPresent: true,
          role: activeRole,
          companyPresent: Boolean(activeCompanyId),
        },
        "SNAPSHOT_READ",
      );
    }
  }, [
    activeCompanyId,
    activeProfileContext,
    activeRole,
    companies,
    currentUser,
    firebaseSessionUid,
    memberships,
    profileIndex,
    simulators,
  ]);

  useEffect(() => {
    markSessionBootEvent("APP_START", {}, "APP_START");
  }, []);

  useEffect(() => {
    const uid = currentUser?.id || null;
    const role = activeRole;
    const companyPresent = Boolean(activeCompanyId);
    const hasCoherentFirebaseIdentity = Boolean(
      authInitialized &&
        firebaseSessionUid &&
        currentUser?.id &&
        currentUser.id === firebaseSessionUid,
    );

    if (visualBootUid) {
      markSessionBootEvent(
        "SNAPSHOT_READ",
        { uidPresent: true, role, companyPresent },
        "SNAPSHOT_READ",
      );
    }
    if (hasCoherentFirebaseIdentity) {
      markSessionBootEvent(
        "AUTH_RESTORED",
        { uidPresent: true, role, companyPresent },
        "AUTH_RESTORED",
      );
    }
    if (visualBootUid && role) {
      markSessionBootEvent(
        "PROFILE_RESTORED",
        { uidPresent: true, role, companyPresent },
        "PROFILE_RESTORED",
      );
    }
    if (sessionUiReady) {
      markSessionBootEvent(
        "SESSION_UI_READY",
        { uidPresent: Boolean(uid), role, companyPresent },
        "SESSION_UI_READY",
      );
      markSessionBootEvent(
        "DATA_SYNC_STARTED",
        { uidPresent: Boolean(uid), role, companyPresent },
        "DATA_SYNC_STARTED",
      );
    }
    if (sessionReady) {
      markSessionBootEvent(
        "AUTHORIZATION_READY",
        { uidPresent: Boolean(uid), role, companyPresent },
        "AUTHORIZATION_READY",
      );
    }
  }, [
    activeCompanyId,
    activeRole,
    authInitialized,
    currentUser?.id,
    firebaseSessionUid,
    sessionReady,
    sessionUiReady,
    visualBootUid,
  ]);

  const sessionValue = useMemo<SessionStoreType>(
    () => ({
      isSeniorAuthenticated,
      setIsSeniorAuthenticated,
      seniorCompanyId,
      setSeniorCompanyId,
      currentUser,
      setCurrentUser,
      authInitialized,
      membershipsLoaded,
      sessionReady,
      sessionUiReady,
      membershipsUiReady,
      identityReconciliationStatus,
      sessionDiagnostic,
      sessionRecovering,
      profileIndex,
      activeProfileContext,
      refreshSession: stableRefreshSession,
      confirmCanonicalMemberships: stableConfirmCanonicalMemberships,
      activeRole,
      memberships,
      activeCompanyId,
      setActiveCompanyId,
      switchRole: stableSwitchRole,
      logOutApp: stableLogOutApp,
    }),
    [
      activeCompanyId,
      activeRole,
      authInitialized,
      currentUser,
      isSeniorAuthenticated,
      memberships,
      membershipsLoaded,
      seniorCompanyId,
      sessionReady,
      sessionUiReady,
      membershipsUiReady,
      identityReconciliationStatus,
      sessionDiagnostic,
      sessionRecovering,
      profileIndex,
      activeProfileContext,
      stableConfirmCanonicalMemberships,
      stableRefreshSession,
      stableLogOutApp,
      stableSwitchRole,
    ],
  );


  const activityValue = useMemo<ActivityStoreType>(
    () => ({ jobDemands: scopedJobDemands }),
    [scopedJobDemands],
  );

  // Dedicated company/recruitment slice. Its controllers own the company,
  // member and recruitment reads; AppProvider only exposes the compatibility
  // actions and session bridge, so no duplicate Firestore subscriptions exist.
  const companyValue = useMemo<CompanyStoreType>(
    () => ({
      companies: visibleCompanies,
      companiesLoading,
      allCompanies: companies,
      companyCatalogLoaded,
      companyCatalogAttempted,
      loadCompanyCatalog: stableLoadCompanyCatalog,
      loadCompanyById: stableLoadCompanyById,
      primeCompanyProfile: stablePrimeCompanyProfile,
      activeCompanyId,
      setActiveCompanyId,
      memberships,
      allCompanyMembers,
      allCompanyMembersReady,
      allCompanyMembersError,
      recruitmentApplications: scopedRecruitmentApplications,
      driverRequests: scopedDriverRequests,
      updateRecruitmentSettings: stableUpdateRecruitmentSettings,
      submitRecruitmentApplication: stableSubmitRecruitmentApplication,
      approveRecruitmentApplication: stableApproveRecruitmentApplication,
      rejectRecruitmentApplication: stableRejectRecruitmentApplication,
      deleteRecruitmentApplication: stableDeleteRecruitmentApplication,
      createCompany: stableCreateCompany,
      updateCompany: stableUpdateCompany,
      deleteCompany: stableDeleteCompany,
      requestJoinCompany: stableRequestJoinCompany,
      cancelRequestJoinCompany: stableCancelRequestJoinCompany,
      approveDriver: stableApproveDriver,
      rejectDriver: stableRejectDriver,
      promoteDriverToAdmin: stablePromoteDriverToAdmin,
      demoteAdminToDriver: stableDemoteAdminToDriver,
      removeDriverFromFleet: stableRemoveDriverFromFleet,
    }),
    [
      activeCompanyId,
      allCompanyMembers,
      allCompanyMembersReady,
      allCompanyMembersError,
      companies,
      companyCatalogAttempted,
      companyCatalogLoaded,
      companiesLoading,
      memberships,
      scopedDriverRequests,
      scopedRecruitmentApplications,
      visibleCompanies,
    ],
  );

  const rankingFilterValue = useMemo<RankingFilterStoreType>(
    () => ({
      globalPeriodPreset,
      setGlobalPeriodPreset,
      globalStartDateStr,
      setGlobalStartDateStr,
      globalEndDateStr,
      setGlobalEndDateStr,
    }),
    [globalEndDateStr, globalPeriodPreset, globalStartDateStr],
  );

  const operationalDataReady = Boolean(
    activeCompanyId &&
      operationalReadiness.jobs &&
      operationalReadiness.contracts &&
      operationalReadiness.vehicles &&
      operationalReadiness.trailers &&
      operationalReadiness.users
  );
  const operationalDataRefreshing = Boolean(
    !operationalDataReady &&
      (jobs.length > 0 ||
        contracts.length > 0 ||
        vehicles.length > 0 ||
        trailers.length > 0 ||
        users.length > 0),
  );

  useEffect(() => {
    if (!operationalDataReady) return;
    markSessionBootEvent(
      "DATA_SYNC_READY",
      {
        uidPresent: Boolean(currentUser?.id),
        role: activeRole,
        companyPresent: Boolean(activeCompanyId),
      },
      "DATA_SYNC_READY",
    );
  }, [activeCompanyId, activeRole, currentUser?.id, operationalDataReady]);

  const operationalValue = useMemo<OperationalStoreType>(
    () => ({
      users: combinedUsers,
      vehicles,
      trailers,
      contracts,
      sequences,
      jobs,
      simulators,
      simulatorsLoading,
      simulatorsError,
      operationalDataReady,
      operationalDataRefreshing,
      jobsReady: operationalReadiness.jobs,
      contractsReady: operationalReadiness.contracts,
      usersReady: operationalReadiness.users,
      createContract: stableCreateContract,
      updateContract: stableUpdateContract,
      deleteContract: stableDeleteContract,
      createSequence: stableCreateSequence,
      updateSequence: stableUpdateSequence,
      deleteSequence: stableDeleteSequence,
      assignJob: stableAssignJob,
      startJob: stableStartJob,
      startAutomaticOperation: stableStartAutomaticOperation,
      finishJob: stableFinishJob,
      cancelJob: stableCancelJob,
      changeJobVehicle: stableChangeJobVehicle,
      deleteJob: stableDeleteJob,
      requestNewJobDemand: stableRequestNewJobDemand,
      cancelJobDemand: stableCancelJobDemand,
      rejectJobDemand: stableRejectJobDemand,
      updateUserOnlineStatus: stableUpdateUserOnlineStatus,
      createManualDriver: stableCreateManualDriver,
      registerUser: stableRegisterUser,
      syncCompanyData: stableSyncCompanyData,
      addVehicle: stableAddVehicle,
      updateVehicle: stableUpdateVehicle,
      deleteVehicle: stableDeleteVehicle,
      addTrailer: stableAddTrailer,
      updateTrailer: stableUpdateTrailer,
      deleteTrailer: stableDeleteTrailer,
    }),
    [
      combinedUsers,
      contracts,
      jobs,
      sequences,
      simulators,
      simulatorsError,
      simulatorsLoading,
      operationalDataReady,
      operationalDataRefreshing,
      operationalReadiness,
      trailers,
      vehicles,
    ],
  );

  return (
    <SessionContext.Provider value={sessionValue}>
      <CompanyProvider value={companyValue}>
        <NotificationsProvider
          userId={currentUserId}
          activeRole={activeRole}
          activeCompanyId={targetCompanyId}
          enabled={
            !interactionFirstRoute && isActiveUser && Boolean(activeRole)
          }
        >
          <ActivityContext.Provider value={activityValue}>
            <RankingFilterContext.Provider value={rankingFilterValue}>
              <OperationalContext.Provider value={operationalValue}>
                {children}
              </OperationalContext.Provider>
            </RankingFilterContext.Provider>
          </ActivityContext.Provider>
        </NotificationsProvider>
      </CompanyProvider>
    </SessionContext.Provider>
  );
};


export const useSessionStore = () => {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSessionStore must be used within AppProvider");
  return context;
};


export const useActivityStore = () => {
  const context = useContext(ActivityContext);
  if (!context) throw new Error("useActivityStore must be used within AppProvider");
  return context;
};

export const useRankingFilterStore = () => {
  const context = useContext(RankingFilterContext);
  if (!context) throw new Error("useRankingFilterStore must be used within AppProvider");
  return context;
};
export const useOperationalStore = () => {
  const context = useContext(OperationalContext);
  if (!context) throw new Error("useOperationalStore must be used within AppProvider");
  return context;
};
