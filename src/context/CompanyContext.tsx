import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  limit,
  onSnapshot,
  or,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { isAuthTeardownActive } from "../lib/authLifecycle";
import { readOfflineSessionSnapshot } from "../lib/offlineSessionSnapshot";
import { resolveMembershipRoles } from "../lib/membershipRoles";
import type {
  CompanyMember,
  CompanyProfile,
  DriverRequest,
  RecruitmentApplication,
  RecruitmentSettings,
  Role,
  User,
} from "./AppContext";

const COMPANIES_CACHE_KEY = "nvu.public.companies.v5";
// A cache written by older builds may contain the first page/chunk of the
// catalog while claiming `complete: true`.  Keep it useful for the first
// paint, but never use it as this session's authoritative catalog.
const PUBLIC_COMPANIES_CACHE_SCHEMA_VERSION = 2;
const scopedCompaniesCacheKey = (uid: string) =>
  `nvu.session.v5.scoped-companies.${uid}`;

const isValidCacheTimestamp = (cachedAt: unknown) =>
  typeof cachedAt === "number" &&
  Number.isFinite(cachedAt) &&
  cachedAt > 0;

type CachedPublicCompanies = {
  companies: CompanyProfile[];
  serverConfirmed: boolean;
};

const readCachedCompanies = (): CachedPublicCompanies => {
  try {
    const raw = localStorage.getItem(COMPANIES_CACHE_KEY);
    if (!raw) return { companies: [], serverConfirmed: false };
    const parsed = JSON.parse(raw) as {
      companies?: CompanyProfile[];
      cachedAt?: number;
      complete?: boolean;
      cacheSchemaVersion?: number;
      serverConfirmed?: boolean;
      documentCount?: number;
    };
    if (
      !Array.isArray(parsed.companies) ||
      !isValidCacheTimestamp(parsed.cachedAt)
    ) {
      return { companies: [], serverConfirmed: false };
    }

    const serverConfirmed =
      parsed.cacheSchemaVersion === PUBLIC_COMPANIES_CACHE_SCHEMA_VERSION &&
      parsed.complete === true &&
      parsed.serverConfirmed === true &&
      Number.isInteger(parsed.documentCount) &&
      parsed.documentCount === parsed.companies.length;

    return { companies: parsed.companies, serverConfirmed };
  } catch {
    return { companies: [], serverConfirmed: false };
  }
};

export const writeCachedCompanies = (
  companies: CompanyProfile[],
  options: { serverConfirmed?: boolean } = {},
) => {
  try {
    localStorage.setItem(
      COMPANIES_CACHE_KEY,
      JSON.stringify({
        companies,
        cachedAt: Date.now(),
        complete: options.serverConfirmed !== false,
        serverConfirmed: options.serverConfirmed !== false,
        cacheSchemaVersion: PUBLIC_COMPANIES_CACHE_SCHEMA_VERSION,
        documentCount: companies.length,
      }),
    );
  } catch {
    // Public company cache is best-effort only.
  }
};

const readCachedScopedCompanies = (uid?: string): CompanyProfile[] => {
  if (!uid) return [];
  try {
    const raw = localStorage.getItem(scopedCompaniesCacheKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      uid?: string;
      companies?: CompanyProfile[];
      cachedAt?: number;
    };
    return parsed.uid === uid &&
      Array.isArray(parsed.companies) &&
      isValidCacheTimestamp(parsed.cachedAt)
      ? parsed.companies
      : [];
  } catch {
    return [];
  }
};

const writeCachedScopedCompanies = (
  uid: string | undefined,
  companies: CompanyProfile[],
) => {
  if (!uid || companies.length === 0) return;
  try {
    localStorage.setItem(
      scopedCompaniesCacheKey(uid),
      JSON.stringify({ uid, companies, cachedAt: Date.now() }),
    );
  } catch {
    // Scoped identity cache is best-effort only.
  }
};

const mergeCompanyCatalogs = (
  base: CompanyProfile[],
  incoming: CompanyProfile[],
) => incoming.reduce(
  (catalog, company) => mergeCompanyProfile(catalog, company),
  base,
);

export const normalizeCompanyProfile = (
  id: string,
  raw: Record<string, unknown>,
): CompanyProfile => ({
  ...raw,
  id,
  companyName: String(raw.companyName || raw.fleetName || "Sem Nome"),
} as CompanyProfile);

export const mergeCompanyProfile = (
  current: CompanyProfile[],
  incoming: CompanyProfile,
): CompanyProfile[] => {
  const index = current.findIndex((company) => company.id === incoming.id);
  if (index < 0) return [...current, incoming];
  const next = [...current];
  next[index] = { ...current[index], ...incoming };
  return next;
};

export interface CompanyDataControllerOptions {
  authInitialized: boolean;
  currentUser: User | null;
  memberships: CompanyMember[];
  activeCompanyId: string | null;
  suspendedRealtime?: boolean;
}

export interface CompanyDataController {
  companies: CompanyProfile[];
  setCompanies: Dispatch<SetStateAction<CompanyProfile[]>>;
  companiesLoading: boolean;
  companyCatalogLoaded: boolean;
  companyCatalogAttempted: boolean;
  loadCompanyCatalog: (force?: boolean) => Promise<CompanyProfile[]>;
  loadCompanyById: (companyId: string) => Promise<CompanyProfile | null>;
  primeCompanyProfile: (company: CompanyProfile) => CompanyProfile | null;
  companiesRef: React.MutableRefObject<CompanyProfile[]>;
  companyCatalogLoadedRef: React.MutableRefObject<boolean>;
}

/**
 * Owns the company catalog and the only realtime company-document listener.
 *
 * Keeping this controller in the dedicated module lets AppProvider consume the
 * data during the compatibility phase without duplicating Firestore reads.
 * Company/recruitment screens subscribe only to CompanyContext.
 */
export const useCompanyDataController = ({
  authInitialized,
  currentUser,
  memberships,
  activeCompanyId,
  suspendedRealtime = false,
}: CompanyDataControllerOptions): CompanyDataController => {
  const initialCompanyState = useMemo(() => {
    const publicCatalogCache = readCachedCompanies();
    const scopedCatalog = readCachedScopedCompanies(currentUser?.id);
    const offlineSnapshot = readOfflineSessionSnapshot(currentUser?.id);
    const snapshotCompanies = (offlineSnapshot?.companies || [])
      .map((company) =>
        normalizeCompanyProfile(
          String(company.id || ""),
          company,
        ),
      )
      .filter((company) => Boolean(company.id));
    return {
      // The atomic snapshot is the strongest local visual source because it was
      // written only after the UID, memberships, companies and ProfileIndex
      // were structurally consistent. Server confirmation remains separate.
      companies: mergeCompanyCatalogs(
        mergeCompanyCatalogs(publicCatalogCache.companies, scopedCatalog),
        snapshotCompanies,
      ),
      publicCatalogLoaded: false,
    };
  }, [currentUser?.id]);
  const [companies, setCompanies] = useState<CompanyProfile[]>(
    initialCompanyState.companies,
  );
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [companyCatalogLoaded, setCompanyCatalogLoaded] = useState(
    initialCompanyState.publicCatalogLoaded,
  );
  const [companyCatalogAttempted, setCompanyCatalogAttempted] = useState(
    initialCompanyState.publicCatalogLoaded,
  );
  const companiesRef = useRef<CompanyProfile[]>(initialCompanyState.companies);
  const companyCatalogLoadedRef = useRef(initialCompanyState.publicCatalogLoaded);
  const companyCatalogPromiseRef = useRef<Promise<CompanyProfile[]> | null>(
    null,
  );
  const companyDocumentLoadsRef = useRef<
    Map<string, Promise<CompanyProfile | null>>
  >(new Map());
  const companyDocumentRetryTimerRef = useRef<
    ReturnType<typeof setTimeout> | null
  >(null);
  const companyDocumentRetryAttemptRef = useRef(0);
  const [companyDocumentRetryTick, setCompanyDocumentRetryTick] = useState(0);
  const companiesLoadingCountRef = useRef(0);

  useEffect(() => {
    companiesRef.current = companies;
  }, [companies]);

  useEffect(() => {
    companyCatalogLoadedRef.current = companyCatalogLoaded;
  }, [companyCatalogLoaded]);

  useEffect(() => {
    return () => {
      if (companyDocumentRetryTimerRef.current) {
        clearTimeout(companyDocumentRetryTimerRef.current);
        companyDocumentRetryTimerRef.current = null;
      }
      companyDocumentRetryAttemptRef.current = 0;
      companyDocumentLoadsRef.current.clear();
    };
  }, [currentUser?.id]);

  // Hydrate the authenticated user's own company cards before the browser
  // paints the profile selector. Firestore still refreshes every document,
  // but returning to Select Profile no longer waits for those reads to show
  // names, logos and simulator labels.
  useLayoutEffect(() => {
    const cachedScopedCompanies = readCachedScopedCompanies(currentUser?.id);
    const offlineSnapshot = readOfflineSessionSnapshot(currentUser?.id);
    const snapshotCompanies = (offlineSnapshot?.companies || [])
      .map((company) =>
        normalizeCompanyProfile(String(company.id || ""), company),
      )
      .filter((company) => Boolean(company.id));
    if (cachedScopedCompanies.length === 0 && snapshotCompanies.length === 0) return;
    setCompanies((current) => {
      const next = mergeCompanyCatalogs(
        mergeCompanyCatalogs(current, cachedScopedCompanies),
        snapshotCompanies,
      );
      companiesRef.current = next;
      return next;
    });
  }, [currentUser?.id]);

  const beginCompaniesLoad = () => {
    companiesLoadingCountRef.current += 1;
    setCompaniesLoading(true);
  };

  const endCompaniesLoad = () => {
    companiesLoadingCountRef.current = Math.max(
      0,
      companiesLoadingCountRef.current - 1,
    );
    if (companiesLoadingCountRef.current === 0) {
      setCompaniesLoading(false);
    }
  };

  // Senior company handoff must not depend on a second catalog round-trip.
  // Merge the company card already selected in the Senior Panel immediately,
  // then let the targeted Firestore listener refresh it in the background.
  const primeCompanyProfile = (company: CompanyProfile): CompanyProfile | null => {
    const companyId = String(company?.id || "").trim();
    if (!companyId) return null;

    const normalized = normalizeCompanyProfile(
      companyId,
      company as unknown as Record<string, unknown>,
    );
    setCompanies((current) => {
      const next = mergeCompanyProfile(current, normalized);
      companiesRef.current = next;
      return next;
    });
    return normalized;
  };

  // Resolve one company deterministically. The previous implementation kept
  // only a Set of in-flight ids inside an effect. If that effect was cleaned
  // up while a Senior workspace switch was still reading Firestore, the
  // successful result could be discarded while the next effect saw the id as
  // already in-flight. Once the request finished there was no trigger left to
  // read it again, leaving CompanyTab on "Sincronizando empresa" forever.
  //
  // Keep the promise itself instead: every caller joins the same request and
  // the resolved public company identity is safe to merge even if the original
  // effect has already re-rendered. A normal getDoc fallback also lets a warm
  // WebView cache paint the company when a server-only read is temporarily
  // unavailable.
  const loadCompanyById = (rawCompanyId: string): Promise<CompanyProfile | null> => {
    const companyId = String(rawCompanyId || "").trim();
    if (!companyId) return Promise.resolve(null);

    const existing = companiesRef.current.find(
      (company) => String(company.id) === companyId,
    );
    if (existing) return Promise.resolve(existing);

    const inFlight = companyDocumentLoadsRef.current.get(companyId);
    if (inFlight) return inFlight;

    beginCompaniesLoad();
    const companyRef = doc(db, "frotas", companyId);
    const request = getDocFromServer(companyRef)
      .catch(async (serverError) => {
        if (!isAuthTeardownActive() && import.meta.env.DEV) {
          console.warn(
            "[CompanyContext] Leitura direta da empresa no servidor falhou; tentando cache padrão:",
            companyId,
            serverError,
          );
        }
        return getDoc(companyRef);
      })
      .then((snapshot) => {
        if (isAuthTeardownActive() || !snapshot.exists()) return null;
        const company = normalizeCompanyProfile(
          snapshot.id,
          snapshot.data(),
        );
        setCompanies((current) => {
          const next = mergeCompanyProfile(current, company);
          companiesRef.current = next;
          if (companyCatalogLoadedRef.current) writeCachedCompanies(next);

          const liveUid = auth.currentUser?.uid;
          if (liveUid && liveUid === currentUser?.id) {
            const scopedIds = new Set(
              [
                ...memberships
                  .filter((membership) => membership.status === "active")
                  .map((membership) => membership.companyId),
                activeCompanyId,
                companyId,
              ].filter((value): value is string => Boolean(value)),
            );
            writeCachedScopedCompanies(
              liveUid,
              next.filter((item) => scopedIds.has(item.id)),
            );
          }
          return next;
        });
        return company;
      })
      .catch((error) => {
        if (!isAuthTeardownActive()) {
          console.warn(
            "[CompanyContext] Falha ao resolver empresa por id:",
            companyId,
            error,
          );
        }
        return null;
      })
      .finally(() => {
        companyDocumentLoadsRef.current.delete(companyId);
        endCompaniesLoad();
      });

    companyDocumentLoadsRef.current.set(companyId, request);
    return request;
  };

  // PUBLIC_COMPANY_CATALOG_ON_DEMAND
  // The complete public catalog is fetched only by collective pages.
  const loadCompanyCatalog = async (
    force = false,
  ): Promise<CompanyProfile[]> => {
    if (!force && companyCatalogLoadedRef.current) {
      return companiesRef.current;
    }
    if (companyCatalogPromiseRef.current) {
      return companyCatalogPromiseRef.current;
    }

    setCompanyCatalogAttempted(false);
    beginCompaniesLoad();
    // `getDocs` may resolve from the Android/WebView persistence layer.  A
    // full catalog is only allowed to become authoritative after this
    // explicit server read succeeds.
    const request = getDocsFromServer(collection(db, "frotas"))
      .then((snapshot) => {
        const nextCompanies = snapshot.docs.map((companyDocument) =>
          normalizeCompanyProfile(companyDocument.id, companyDocument.data()),
        );
        companiesRef.current = nextCompanies;
        companyCatalogLoadedRef.current = true;
        setCompanies(nextCompanies);
        setCompanyCatalogLoaded(true);
        setCompanyCatalogAttempted(true);
        writeCachedCompanies(nextCompanies);
        return nextCompanies;
      })
      .catch((error) => {
        if (!isAuthTeardownActive()) {
          console.error("Error loading public frotas catalog on demand:", error);
        }
        setCompanyCatalogAttempted(true);
        return companiesRef.current;
      })
      .finally(() => {
        companyCatalogPromiseRef.current = null;
        endCompaniesLoad();
      });

    companyCatalogPromiseRef.current = request;
    return request;
  };

  // Load only documents referenced by the authenticated user's memberships
  // plus the explicit Senior target. Requests are promise-deduped by
  // loadCompanyById, so an effect cleanup can no longer orphan a successful
  // company read during a workspace transition.
  useEffect(() => {
    // Company cards are presentation data. Start from the UID-scoped
    // membership snapshot immediately and let server confirmation refresh them
    // independently in the background.
    if (!authInitialized || !currentUser?.id) return;

    const companyIds = Array.from(
      new Set(
        [
          ...memberships
            .filter((membership) => membership.status === "active")
            .map((membership) => membership.companyId),
          activeCompanyId,
        ]
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    );
    const knownIds = new Set(
      companiesRef.current.map((company) => String(company.id)),
    );
    const missingIds = companyIds.filter((companyId) => !knownIds.has(companyId));
    if (missingIds.length === 0) return;

    void Promise.all(missingIds.map((companyId) => loadCompanyById(companyId))).then(
      (resolvedCompanies) => {
        if (isAuthTeardownActive() || auth.currentUser?.uid !== currentUser.id) {
          return;
        }

        const failedIds = missingIds.filter(
          (_companyId, index) => !resolvedCompanies[index],
        );
        if (failedIds.length === 0) {
          companyDocumentRetryAttemptRef.current = 0;
          if (companyDocumentRetryTimerRef.current) {
            clearTimeout(companyDocumentRetryTimerRef.current);
            companyDocumentRetryTimerRef.current = null;
          }
          return;
        }

        if (!companyDocumentRetryTimerRef.current) {
          const delay = Math.min(
            30_000,
            1_000 * 2 ** companyDocumentRetryAttemptRef.current,
          );
          companyDocumentRetryAttemptRef.current += 1;
          companyDocumentRetryTimerRef.current = setTimeout(() => {
            companyDocumentRetryTimerRef.current = null;
            if (isAuthTeardownActive()) return;
            setCompanyDocumentRetryTick((value) => value + 1);
          }, delay);
        }
      },
    );
  }, [
    activeCompanyId,
    authInitialized,
    currentUser?.id,
    memberships,
    companyDocumentRetryTick,
  ]);

  // Preserve realtime behavior only for the company active in the session.
  // The selector/pending screens use the already hydrated company identity and
  // deliberately detach this listener so its cache writes/re-render cannot
  // compete with a direct user interaction.
  useEffect(() => {
    if (suspendedRealtime) return;

    const companyId = String(activeCompanyId || "").trim();
    if (!companyId) return;

    const unsubscribeActiveCompany = onSnapshot(
      doc(db, "frotas", companyId),
      (companySnapshot) => {
        if (isAuthTeardownActive()) return;
        setCompanies((current) => {
          const activeCompany = companySnapshot.exists()
            ? normalizeCompanyProfile(
                companySnapshot.id,
                companySnapshot.data(),
              )
            : null;
          const next = companySnapshot.exists()
            ? mergeCompanyProfile(
                current,
                activeCompany as CompanyProfile,
              )
            : current.filter((company) => company.id !== companyId);
          companiesRef.current = next;
          if (companyCatalogLoadedRef.current) writeCachedCompanies(next);
          if (activeCompany) {
            const scopedIds = new Set(
              [
                ...memberships
                  .filter((membership) => membership.status === "active")
                  .map((membership) => membership.companyId),
                activeCompanyId,
              ].filter((value): value is string => Boolean(value)),
            );
            writeCachedScopedCompanies(
              currentUser?.id,
              next.filter((company) => scopedIds.has(company.id)),
            );
          }
          return next;
        });
      },
      (error) => {
        if (isAuthTeardownActive()) return;
        console.warn("Error observing active company:", error);
      },
    );

    return () => unsubscribeActiveCompany();
  }, [
    activeCompanyId,
    currentUser?.id,
    memberships,
    suspendedRealtime,
  ]);

  return {
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
  };
};



const MAX_PENDING_REQUESTS = 100;

interface CompanyScopedControllerOptions {
  userId: string | undefined;
  targetCompanyId: string | null;
  isActive: boolean;
  suspended?: boolean;
}

export interface CompanyMembersController {
  allCompanyMembers: CompanyMember[];
  allCompanyMembersReady: boolean;
  setAllCompanyMembers: Dispatch<SetStateAction<CompanyMember[]>>;
}

/** Owns the active company's member listener outside the global AppContext. */
export const useCompanyMembersController = ({
  userId,
  targetCompanyId,
  isActive,
  suspended = false,
}: CompanyScopedControllerOptions): CompanyMembersController => {
  const [allCompanyMembers, setAllCompanyMembers] = useState<CompanyMember[]>([]);
  const [allCompanyMembersReady, setAllCompanyMembersReady] = useState(false);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    const canPublish = () =>
      generationRef.current === generation &&
      !isAuthTeardownActive() &&
      Boolean(userId) &&
      auth.currentUser?.uid === userId;

    // Foreground selector/status screens keep the last known company state but
    // intentionally detach broad company listeners. Preserving the array here
    // avoids an unnecessary context invalidation/re-render just to pause work.
    if (suspended) return;

    if (!userId || !targetCompanyId || !isActive) {
      setAllCompanyMembers([]);
      setAllCompanyMembersReady(true);
      return;
    }

    setAllCompanyMembersReady(false);
    const unsubscribe = onSnapshot(
      query(
        collection(db, "companyMembers"),
        where("companyId", "==", targetCompanyId),
      ),
      (snapshot) => {
        if (!canPublish()) return;
        setAllCompanyMembers(
          snapshot.docs.map((membershipDocument) => {
            const raw = membershipDocument.data() as Record<string, unknown>;
            const companyId = String(raw.companyId || targetCompanyId);
            const roles = resolveMembershipRoles({
              ...raw,
              companyId,
            }) as Role[];
            return {
              ...raw,
              id: membershipDocument.id,
              companyId,
              userId: String(raw.userId || ""),
              roles,
              role: (raw.role || roles[0] || "driver") as Role,
              permissions: Array.isArray(raw.permissions)
                ? raw.permissions.filter(
                    (permission): permission is string =>
                      typeof permission === "string",
                  )
                : [],
              status:
                raw.status === "pending" || raw.status === "rejected"
                  ? raw.status
                  : "active",
            } as CompanyMember;
          }),
        );
        setAllCompanyMembersReady(true);
      },
      (error) => {
        if (!canPublish()) return;
        setAllCompanyMembersReady(false);
        console.warn("Error fetching all company members", error);
      },
    );

    return () => {
      generationRef.current += 1;
      unsubscribe();
    };
  }, [isActive, suspended, targetCompanyId, userId]);

  return { allCompanyMembers, allCompanyMembersReady, setAllCompanyMembers };
};

interface CompanyRecruitmentControllerOptions extends CompanyScopedControllerOptions {
  activeRole: Role | null;
  userEmail?: string;
}

export interface CompanyRecruitmentController {
  driverRequests: DriverRequest[];
  setDriverRequests: Dispatch<SetStateAction<DriverRequest[]>>;
  recruitmentApplications: RecruitmentApplication[];
  setRecruitmentApplications: Dispatch<SetStateAction<RecruitmentApplication[]>>;
}

/** Owns recruitment/request listeners and guarantees a single scoped set. */
export const useCompanyRecruitmentController = ({
  userId,
  userEmail,
  activeRole,
  targetCompanyId,
  isActive,
  suspended = false,
}: CompanyRecruitmentControllerOptions): CompanyRecruitmentController => {
  const [driverRequests, setDriverRequests] = useState<DriverRequest[]>([]);
  const [recruitmentApplications, setRecruitmentApplications] = useState<
    RecruitmentApplication[]
  >([]);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    const canPublish = () =>
      generationRef.current === generation &&
      !isAuthTeardownActive() &&
      Boolean(userId) &&
      auth.currentUser?.uid === userId;

    // SelectProfile and PendingApplications already own a narrow, user-scoped
    // pending request listener. Do not keep the broader recruitment controller
    // attached at the same time; that duplicated Firestore work could publish
    // a large company snapshot while the user is tapping the pending button.
    if (suspended) return;

    if (!userId) {
      setDriverRequests([]);
      setRecruitmentApplications([]);
      return;
    }

    setDriverRequests([]);
    setRecruitmentApplications([]);

    const normalizedEmail = String(userEmail || "").trim().toLowerCase();
    const userApplicationsQuery = normalizedEmail
      ? query(
          collection(db, "recruitment_applications"),
          or(
            where("userId", "==", userId),
            where("email", "==", normalizedEmail),
          ),
          limit(100),
        )
      : query(
          collection(db, "recruitment_applications"),
          where("userId", "==", userId),
          limit(100),
        );

    let unsubscribeRequests: () => void = () => {};
    let unsubscribeApplications: () => void = () => {};
    const onError = (label: string) => (error: unknown) => {
      if (!canPublish()) return;
      console.warn(label, error);
    };

    if (isActive && activeRole === "admin" && targetCompanyId) {
      unsubscribeRequests = onSnapshot(
        query(
          collection(db, "solicitacoes_motoristas"),
          where("empresaId", "==", targetCompanyId),
          where("status", "==", "pending"),
          limit(MAX_PENDING_REQUESTS),
        ),
        (snapshot) => {
          if (!canPublish()) return;
          setDriverRequests(
            snapshot.docs.map(
              (requestDocument) =>
                ({
                  ...requestDocument.data(),
                  id: requestDocument.id,
                }) as DriverRequest,
            ),
          );
        },
        onError("Error fetching driver requests admin"),
      );

      unsubscribeApplications = onSnapshot(
        query(
          collection(db, "recruitment_applications"),
          where("companyId", "==", targetCompanyId),
          where("status", "==", "pending"),
          limit(MAX_PENDING_REQUESTS),
        ),
        (snapshot) => {
          if (!canPublish()) return;
          setRecruitmentApplications(
            snapshot.docs.map(
              (applicationDocument) =>
                ({
                  ...applicationDocument.data(),
                  id: applicationDocument.id,
                }) as RecruitmentApplication,
            ),
          );
        },
        onError("Error fetching recruitment apps admin"),
      );
    } else {
      if (isActive && activeRole !== "admin") {
        unsubscribeRequests = onSnapshot(
          query(
            collection(db, "solicitacoes_motoristas"),
            where("motoristaId", "==", userId),
            where("status", "==", "pending"),
            limit(20),
          ),
          (snapshot) => {
            if (!canPublish()) return;
            setDriverRequests(
              snapshot.docs.map(
                (requestDocument) =>
                  ({
                    ...requestDocument.data(),
                    id: requestDocument.id,
                  }) as DriverRequest,
              ),
            );
          },
          onError("Error fetching driver requests motorista"),
        );
      }

      unsubscribeApplications = onSnapshot(
        userApplicationsQuery,
        (snapshot) => {
          if (!canPublish()) return;
          setRecruitmentApplications(
            snapshot.docs.map(
              (applicationDocument) =>
                ({
                  ...applicationDocument.data(),
                  id: applicationDocument.id,
                }) as RecruitmentApplication,
            ),
          );
        },
        onError("Error fetching recruitment apps motorista"),
      );
    }

    return () => {
      generationRef.current += 1;
      unsubscribeRequests();
      unsubscribeApplications();
    };
  }, [activeRole, isActive, suspended, targetCompanyId, userEmail, userId]);

  return {
    driverRequests,
    setDriverRequests,
    recruitmentApplications,
    setRecruitmentApplications,
  };
};

/** Company/recruitment slice exposed to feature screens.
 *
 * This contract is declared in the dedicated module instead of being picked
 * from the former monolithic AppContext. Company screens therefore remain
 * independent from unrelated operational and notification updates.
 */
export interface CompanyStoreType {
  companies: CompanyProfile[];
  companiesLoading: boolean;
  allCompanies: CompanyProfile[];
  companyCatalogLoaded: boolean;
  companyCatalogAttempted: boolean;
  loadCompanyCatalog: (force?: boolean) => Promise<CompanyProfile[]>;
  loadCompanyById: (companyId: string) => Promise<CompanyProfile | null>;
  primeCompanyProfile: (company: CompanyProfile) => CompanyProfile | null;
  activeCompanyId: string | null;
  setActiveCompanyId: (id: string | null) => void;
  memberships: CompanyMember[];
  allCompanyMembers: CompanyMember[];
  allCompanyMembersReady: boolean;
  recruitmentApplications: RecruitmentApplication[];
  driverRequests: DriverRequest[];
  updateRecruitmentSettings: (
    companyId: string,
    settings: RecruitmentSettings,
  ) => Promise<void>;
  submitRecruitmentApplication: (
    data: Omit<RecruitmentApplication, "id" | "status" | "createdAt">,
  ) => Promise<string>;
  approveRecruitmentApplication: (applicationId: string) => Promise<void>;
  rejectRecruitmentApplication: (applicationId: string) => Promise<void>;
  deleteRecruitmentApplication: (applicationId: string) => Promise<void>;
  createCompany: (
    data: Omit<CompanyProfile, "id" | "cnpj">,
  ) => Promise<void>;
  updateCompany: (
    id: string,
    updates: Partial<Omit<CompanyProfile, "id" | "cnpj">>,
  ) => Promise<void>;
  deleteCompany: (id: string) => Promise<void>;
  requestJoinCompany: (companyId: string) => Promise<void>;
  cancelRequestJoinCompany: (requestId: string) => Promise<void>;
  approveDriver: (requestId: string) => Promise<void>;
  rejectDriver: (requestId: string) => Promise<void>;
  promoteDriverToAdmin: (driverId: string) => Promise<void>;
  demoteAdminToDriver: (driverId: string) => Promise<void>;
  removeDriverFromFleet: (
    driverId: string,
    companyIdOverride?: string,
  ) => Promise<void>;
}

const CompanyContext = createContext<CompanyStoreType | undefined>(undefined);

export const CompanyProvider: React.FC<{
  value: CompanyStoreType;
  children: ReactNode;
}> = ({ value, children }) => (
  <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>
);

export const useCompanyStore = (): CompanyStoreType => {
  const context = useContext(CompanyContext);
  if (!context) {
    throw new Error("useCompanyStore must be used within AppProvider");
  }
  return context;
};
