// stub:lifecycle
var isAuthTeardownActive = () => false;

// src/lib/pageReadCache.ts
var PREFIX = "nvu.session.page.v1:";
var PAGE_READ_FRESH_MS = 2 * 6e4;
function pageCacheKey(viewerId, kind, scope) {
  return viewerId && kind && scope ? `${PREFIX}${[viewerId, kind, scope].map(encodeURIComponent).join(":")}` : "";
}
function readPageSnapshot(key) {
  if (!key) return null;
  try {
    const entry = JSON.parse(localStorage.getItem(key) || "null");
    return entry && Number.isFinite(entry.savedAt) && entry.savedAt > 0 && "value" in entry ? entry : null;
  } catch {
    return null;
  }
}
function writePageSnapshot(key, value, savedAt = Date.now()) {
  if (!key) return;
  try {
    const serialized = JSON.stringify({ savedAt, value });
    if (serialized.length > 256 * 1024) return;
    const ownerPrefix = key.slice(0, key.indexOf(":", PREFIX.length) + 1);
    const entries = Object.keys(localStorage).filter((item) => item.startsWith(ownerPrefix) && item !== key).sort((a, b) => (readPageSnapshot(a)?.savedAt || 0) - (readPageSnapshot(b)?.savedAt || 0));
    while (entries.length >= 12) localStorage.removeItem(entries.shift());
    localStorage.setItem(key, serialized);
  } catch {
  }
}
function removePageSnapshot(key) {
  try {
    localStorage.removeItem(key);
  } catch {
  }
}
function isPermissionFailure(error) {
  return /(?:permission-denied|unauthenticated)$/.test(String(error?.code || ""));
}

// src/lib/companyProfileDescription.ts
var COMPANY_DESCRIPTION_LIMIT = 160;
function normalizeCompanyDescription(value) {
  return typeof value === "string" ? Array.from(value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()).slice(0, COMPANY_DESCRIPTION_LIMIT).join("").trim() : "";
}

// src/lib/publicCompanyIdentity.ts
var FIELDS = [
  "id",
  "companyName",
  "fleetName",
  "name",
  "nome",
  "logoUrl",
  "logoURL",
  "logo",
  "companyLogoURL",
  "profileCoverURL",
  "profileCoverRevision",
  "profileCoverUpdatedAt",
  "profileDescription",
  "profileDescriptionRevision",
  "profileDescriptionUpdatedAt",
  "simulatorId",
  "simuladorId",
  "simulatorName",
  "simuladorNome",
  "simulator",
  "simulador",
  "simulatorCode",
  "simulatorKey",
  "simuladorKey",
  "simuladorCodigo",
  "gameCode",
  "packageId",
  "status",
  "situacao",
  "state",
  "deleted",
  "isDeleted",
  "softDeleted",
  "excluida",
  "excluido",
  "isActive",
  "active",
  "isVerified",
  "verified",
  "createdAt",
  "approvedAt",
  "rankingEligible",
  "eligibleForRanking",
  "rankingEnabled",
  "excludeFromRanking",
  "currency",
  "moeda"
];
function publicCompanyIdentity(company) {
  const projected = Object.fromEntries(FIELDS.filter((key) => company[key] !== void 0).map((key) => [key, company[key]]));
  if (company.profileDescription !== void 0) projected.profileDescription = normalizeCompanyDescription(company.profileDescription);
  if (typeof projected.profileDescriptionRevision !== "string") delete projected.profileDescriptionRevision;
  const settings = company.recruitmentSettings;
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const publicSettings = Object.fromEntries(["about", "rules", "howItWorks", "benefits", "isActive"].filter((key) => typeof settings[key] === (key === "isActive" ? "boolean" : "string")).map((key) => [key, settings[key]]));
    if (Object.keys(publicSettings).length) projected.recruitmentSettings = publicSettings;
  }
  return projected;
}

// src/context/CompanyContext.tsx
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";

// stub:firestore
var collection = (...a) => a;
var doc = (...a) => a;
var getDoc = () => Promise.resolve({ exists: () => false });
var getDocFromServer = getDoc;
var getDocs = () => Promise.resolve({ docs: [] });
var getDocsFromServer = getDocs;
var limit = (...a) => a;
var or = (...a) => a;
var query = (...a) => a;
var where = (...a) => a;
var onSnapshot = (q, ...args) => {
  if (typeof args[0] !== "function") args.shift();
  return globalThis.__auditListen(q, ...args);
};

// stub:firebase
var db = {};
var auth = globalThis.__auditAuth;

// src/lib/offlineSessionSnapshot.ts
var SNAPSHOT_VERSION = 1;
var SNAPSHOT_KEY_PREFIX = "nvu.session.v5.snapshot.";
var keyForUid = (uid) => `${SNAPSHOT_KEY_PREFIX}${encodeURIComponent(uid)}`;
var isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
var normalizeUid = (uid) => String(uid || "").trim();
var readOfflineSessionSnapshot = (uid) => {
  const normalizedUid = normalizeUid(uid);
  if (typeof window === "undefined" || !normalizedUid) return null;
  try {
    const raw = window.localStorage.getItem(keyForUid(normalizedUid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.version !== SNAPSHOT_VERSION || parsed.uid !== normalizedUid || !Number.isFinite(parsed.cachedAt) || !isRecord(parsed.user) || parsed.user.id !== normalizedUid || !Array.isArray(parsed.memberships) || !Array.isArray(parsed.companies) || !Array.isArray(parsed.simulators) || parsed.activeRole !== null && parsed.activeRole !== "admin" && parsed.activeRole !== "driver") {
      return null;
    }
    return {
      version: SNAPSHOT_VERSION,
      uid: normalizedUid,
      cachedAt: Number(parsed.cachedAt),
      user: parsed.user,
      memberships: parsed.memberships.filter(isRecord),
      companies: parsed.companies.filter(isRecord),
      simulators: parsed.simulators.filter(isRecord),
      activeCompanyId: parsed.activeCompanyId ? String(parsed.activeCompanyId).trim() : null,
      activeRole: parsed.activeRole ?? null,
      profileContext: isRecord(parsed.profileContext) ? parsed.profileContext : null
    };
  } catch {
    return null;
  }
};

// src/lib/membershipRoles.ts
var isOperationalRole = (value) => value === "admin" || value === "driver";
var collectRoles = (value, target) => {
  if (!Array.isArray(value)) return;
  value.forEach((role) => {
    if (isOperationalRole(role)) target.add(role);
  });
};
function resolveMembershipRoles(membership, _user) {
  const resolved = /* @__PURE__ */ new Set();
  collectRoles(membership?.roles, resolved);
  if (isOperationalRole(membership?.role)) resolved.add(membership.role);
  if (resolved.has("admin")) resolved.add("driver");
  if (resolved.size === 0 && membership) resolved.add("driver");
  return Array.from(resolved);
}

// src/context/CompanyContext.tsx
import { jsx } from "react/jsx-runtime";
var COMPANIES_CACHE_KEY = "nvu.public.companies.v6";
var PUBLIC_COMPANIES_CACHE_SCHEMA_VERSION = 2;
var scopedCompaniesCacheKey = (uid) => `nvu.session.v5.scoped-companies.${uid}`;
var isValidCacheTimestamp = (cachedAt) => typeof cachedAt === "number" && Number.isFinite(cachedAt) && cachedAt > 0;
var readCachedCompanies = () => {
  try {
    localStorage.removeItem("nvu.public.companies.v5");
    const raw = localStorage.getItem(COMPANIES_CACHE_KEY);
    if (!raw) return { companies: [], serverConfirmed: false };
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.companies) || !isValidCacheTimestamp(parsed.cachedAt)) {
      return { companies: [], serverConfirmed: false };
    }
    const serverConfirmed = parsed.cacheSchemaVersion === PUBLIC_COMPANIES_CACHE_SCHEMA_VERSION && parsed.complete === true && parsed.serverConfirmed === true && Number.isInteger(parsed.documentCount) && parsed.documentCount === parsed.companies.length;
    return { companies: parsed.companies, serverConfirmed };
  } catch {
    return { companies: [], serverConfirmed: false };
  }
};
var writeCachedCompanies = (companies, options = {}) => {
  try {
    localStorage.setItem(
      COMPANIES_CACHE_KEY,
      JSON.stringify({
        companies: companies.map(publicCompanyIdentity),
        cachedAt: Date.now(),
        complete: options.serverConfirmed !== false,
        serverConfirmed: options.serverConfirmed !== false,
        cacheSchemaVersion: PUBLIC_COMPANIES_CACHE_SCHEMA_VERSION,
        documentCount: companies.length
      })
    );
  } catch {
  }
};
var readCachedScopedCompanies = (uid) => {
  if (!uid) return [];
  try {
    const raw = localStorage.getItem(scopedCompaniesCacheKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return parsed.uid === uid && Array.isArray(parsed.companies) && isValidCacheTimestamp(parsed.cachedAt) ? parsed.companies : [];
  } catch {
    return [];
  }
};
var writeCachedScopedCompanies = (uid, companies) => {
  if (!uid || companies.length === 0) return;
  try {
    localStorage.setItem(
      scopedCompaniesCacheKey(uid),
      JSON.stringify({ uid, companies, cachedAt: Date.now() })
    );
  } catch {
  }
};
var mergeCompanyCatalogs = (base, incoming) => incoming.reduce(
  (catalog, company) => mergeCompanyProfile(catalog, company),
  base
);
var normalizeCompanyProfile = (id, raw) => ({
  ...raw,
  id,
  companyName: String(raw.companyName || raw.fleetName || "Sem Nome")
});
var mergeCompanyProfile = (current, incoming) => {
  const index = current.findIndex((company) => company.id === incoming.id);
  if (index < 0) return [...current, incoming];
  const next = [...current];
  next[index] = { ...current[index], ...incoming };
  return next;
};
var useCompanyDataController = ({
  authInitialized,
  currentUser,
  memberships,
  activeCompanyId,
  suspendedRealtime = false
}) => {
  const initialCompanyState = useMemo(() => {
    const publicCatalogCache = readCachedCompanies();
    const scopedCatalog = readCachedScopedCompanies(currentUser?.id);
    const offlineSnapshot = readOfflineSessionSnapshot(currentUser?.id);
    const snapshotCompanies = (offlineSnapshot?.companies || []).map(
      (company) => normalizeCompanyProfile(
        String(company.id || ""),
        company
      )
    ).filter((company) => Boolean(company.id));
    return {
      // The atomic snapshot is the strongest local visual source because it was
      // written only after the UID, memberships, companies and ProfileIndex
      // were structurally consistent. Server confirmation remains separate.
      companies: mergeCompanyCatalogs(
        mergeCompanyCatalogs(publicCatalogCache.companies, scopedCatalog),
        snapshotCompanies
      ),
      publicCatalogLoaded: false
    };
  }, [currentUser?.id]);
  const [companies, setCompanies] = useState(
    initialCompanyState.companies
  );
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [companyCatalogLoaded, setCompanyCatalogLoaded] = useState(
    initialCompanyState.publicCatalogLoaded
  );
  const [companyCatalogAttempted, setCompanyCatalogAttempted] = useState(
    initialCompanyState.publicCatalogLoaded
  );
  const companiesRef = useRef(initialCompanyState.companies);
  const companyCatalogLoadedRef = useRef(initialCompanyState.publicCatalogLoaded);
  const companyCatalogPromiseRef = useRef(
    null
  );
  const companyDocumentLoadsRef = useRef(/* @__PURE__ */ new Map());
  const companyDocumentRetryTimerRef = useRef(null);
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
  useLayoutEffect(() => {
    const cachedScopedCompanies = readCachedScopedCompanies(currentUser?.id);
    const offlineSnapshot = readOfflineSessionSnapshot(currentUser?.id);
    const snapshotCompanies = (offlineSnapshot?.companies || []).map(
      (company) => normalizeCompanyProfile(String(company.id || ""), company)
    ).filter((company) => Boolean(company.id));
    if (cachedScopedCompanies.length === 0 && snapshotCompanies.length === 0) return;
    setCompanies((current) => {
      const next = mergeCompanyCatalogs(
        mergeCompanyCatalogs(current, cachedScopedCompanies),
        snapshotCompanies
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
      companiesLoadingCountRef.current - 1
    );
    if (companiesLoadingCountRef.current === 0) {
      setCompaniesLoading(false);
    }
  };
  const primeCompanyProfile = (company) => {
    const companyId = String(company?.id || "").trim();
    if (!companyId) return null;
    const normalized = normalizeCompanyProfile(
      companyId,
      company
    );
    setCompanies((current) => {
      const next = mergeCompanyProfile(current, normalized);
      companiesRef.current = next;
      return next;
    });
    return normalized;
  };
  const loadCompanyById = (rawCompanyId) => {
    const companyId = String(rawCompanyId || "").trim();
    if (!companyId) return Promise.resolve(null);
    const existing = companiesRef.current.find(
      (company) => String(company.id) === companyId
    );
    if (existing) return Promise.resolve(existing);
    const inFlight = companyDocumentLoadsRef.current.get(companyId);
    if (inFlight) return inFlight;
    beginCompaniesLoad();
    const companyRef = doc(db, "frotas", companyId);
    const request = getDocFromServer(companyRef).catch(async (serverError) => {
      if (!isAuthTeardownActive() && import.meta.env.DEV) {
        console.warn(
          "[CompanyContext] Leitura direta da empresa no servidor falhou; tentando cache padr\xE3o:",
          companyId,
          serverError
        );
      }
      return getDoc(doc(db, "public_companies", companyId));
    }).then((snapshot) => {
      if (isAuthTeardownActive() || !snapshot.exists()) return null;
      const company = normalizeCompanyProfile(
        snapshot.id,
        snapshot.data()
      );
      setCompanies((current) => {
        const next = mergeCompanyProfile(current, company);
        companiesRef.current = next;
        if (companyCatalogLoadedRef.current) writeCachedCompanies(next);
        const liveUid = auth.currentUser?.uid;
        if (liveUid && liveUid === currentUser?.id) {
          const scopedIds = new Set(
            [
              ...memberships.filter((membership) => membership.status === "active").map((membership) => membership.companyId),
              activeCompanyId,
              companyId
            ].filter((value) => Boolean(value))
          );
          writeCachedScopedCompanies(
            liveUid,
            next.filter((item) => scopedIds.has(item.id))
          );
        }
        return next;
      });
      return company;
    }).catch((error) => {
      if (!isAuthTeardownActive()) {
        console.warn(
          "[CompanyContext] Falha ao resolver empresa por id:",
          companyId,
          error
        );
      }
      return null;
    }).finally(() => {
      companyDocumentLoadsRef.current.delete(companyId);
      endCompaniesLoad();
    });
    companyDocumentLoadsRef.current.set(companyId, request);
    return request;
  };
  const loadCompanyCatalog = async (force = false) => {
    if (!force && companyCatalogLoadedRef.current) {
      return companiesRef.current;
    }
    if (companyCatalogPromiseRef.current) {
      return companyCatalogPromiseRef.current;
    }
    setCompanyCatalogAttempted(false);
    beginCompaniesLoad();
    const request = getDocsFromServer(collection(db, "public_companies")).then((snapshot) => {
      const nextCompanies = snapshot.docs.map(
        (companyDocument) => normalizeCompanyProfile(companyDocument.id, companyDocument.data())
      );
      const scopedIds = new Set(memberships.filter((member) => member.status === "active").map((member) => member.companyId));
      if (activeCompanyId) scopedIds.add(activeCompanyId);
      const scoped = companiesRef.current.filter((company) => scopedIds.has(company.id));
      const merged = mergeCompanyCatalogs(nextCompanies, scoped);
      companiesRef.current = merged;
      companyCatalogLoadedRef.current = true;
      setCompanies(merged);
      setCompanyCatalogLoaded(true);
      setCompanyCatalogAttempted(true);
      writeCachedCompanies(nextCompanies);
      return merged;
    }).catch((error) => {
      if (!isAuthTeardownActive()) {
        console.error("Error loading public frotas catalog on demand:", error);
      }
      setCompanyCatalogAttempted(true);
      return companiesRef.current;
    }).finally(() => {
      companyCatalogPromiseRef.current = null;
      endCompaniesLoad();
    });
    companyCatalogPromiseRef.current = request;
    return request;
  };
  useEffect(() => {
    if (!authInitialized || !currentUser?.id) return;
    const companyIds = Array.from(
      new Set(
        [
          ...memberships.filter((membership) => membership.status === "active").map((membership) => membership.companyId),
          activeCompanyId
        ].map((value) => String(value || "").trim()).filter(Boolean)
      )
    );
    const knownIds = new Set(
      companiesRef.current.map((company) => String(company.id))
    );
    const missingIds = companyIds.filter((companyId) => !knownIds.has(companyId));
    if (missingIds.length === 0) return;
    void Promise.all(missingIds.map((companyId) => loadCompanyById(companyId))).then(
      (resolvedCompanies) => {
        if (isAuthTeardownActive() || auth.currentUser?.uid !== currentUser.id) {
          return;
        }
        const failedIds = missingIds.filter(
          (_companyId, index) => !resolvedCompanies[index]
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
            3e4,
            1e3 * 2 ** companyDocumentRetryAttemptRef.current
          );
          companyDocumentRetryAttemptRef.current += 1;
          companyDocumentRetryTimerRef.current = setTimeout(() => {
            companyDocumentRetryTimerRef.current = null;
            if (isAuthTeardownActive()) return;
            setCompanyDocumentRetryTick((value) => value + 1);
          }, delay);
        }
      }
    );
  }, [
    activeCompanyId,
    authInitialized,
    currentUser?.id,
    memberships,
    companyDocumentRetryTick
  ]);
  useEffect(() => {
    if (suspendedRealtime) return;
    const companyId = String(activeCompanyId || "").trim();
    if (!companyId) return;
    const unsubscribeActiveCompany = onSnapshot(
      doc(db, "frotas", companyId),
      (companySnapshot) => {
        if (isAuthTeardownActive()) return;
        if (companySnapshot.metadata.fromCache && !companySnapshot.exists()) return;
        setCompanies((current) => {
          const activeCompany = companySnapshot.exists() ? normalizeCompanyProfile(
            companySnapshot.id,
            companySnapshot.data()
          ) : null;
          const next = companySnapshot.exists() ? mergeCompanyProfile(
            current,
            activeCompany
          ) : current.filter((company) => company.id !== companyId);
          companiesRef.current = next;
          if (companyCatalogLoadedRef.current) writeCachedCompanies(next);
          if (activeCompany) {
            const scopedIds = new Set(
              [
                ...memberships.filter((membership) => membership.status === "active").map((membership) => membership.companyId),
                activeCompanyId
              ].filter((value) => Boolean(value))
            );
            writeCachedScopedCompanies(
              currentUser?.id,
              next.filter((company) => scopedIds.has(company.id))
            );
          }
          return next;
        });
      },
      (error) => {
        if (isAuthTeardownActive()) return;
        console.warn("Error observing active company:", error);
      }
    );
    return () => unsubscribeActiveCompany();
  }, [
    activeCompanyId,
    currentUser?.id,
    memberships,
    suspendedRealtime
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
    companyCatalogLoadedRef
  };
};
var MAX_PENDING_REQUESTS = 100;
var useCompanyMembersController = ({
  userId,
  targetCompanyId,
  isActive,
  suspended = false
}) => {
  const [allCompanyMembers, setAllCompanyMembers] = useState([]);
  const [allCompanyMembersReady, setAllCompanyMembersReady] = useState(false);
  const [membersScope, setMembersScope] = useState("");
  const [membersError, setMembersError] = useState(null);
  const scope = JSON.stringify([userId, targetCompanyId]);
  const generationRef = useRef(0);
  useEffect(() => {
    const generation = ++generationRef.current;
    const canPublish = () => generationRef.current === generation && !isAuthTeardownActive() && Boolean(userId) && auth.currentUser?.uid === userId;
    if (suspended) return;
    if (!userId || !targetCompanyId || !isActive) {
      setAllCompanyMembers([]);
      setAllCompanyMembersReady(true);
      return;
    }
    if (membersScope !== scope) setAllCompanyMembers([]);
    setMembersScope(scope);
    setMembersError(null);
    setAllCompanyMembersReady(false);
    const unsubscribe = onSnapshot(
      query(
        collection(db, "companyMembers"),
        where("companyId", "==", targetCompanyId)
      ),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (!canPublish()) return;
        setAllCompanyMembers(
          snapshot.docs.map((membershipDocument) => {
            const raw = membershipDocument.data();
            const companyId = String(raw.companyId || targetCompanyId);
            const roles = resolveMembershipRoles({
              ...raw,
              companyId
            });
            return {
              ...raw,
              id: membershipDocument.id,
              companyId,
              userId: String(raw.userId || ""),
              roles,
              role: raw.role || roles[0] || "driver",
              permissions: Array.isArray(raw.permissions) ? raw.permissions.filter(
                (permission) => typeof permission === "string"
              ) : [],
              status: !raw.status || raw.status === "active" ? "active" : raw.status === "pending" || raw.status === "rejected" ? raw.status : "inactive"
            };
          })
        );
        setMembersError(null);
        setAllCompanyMembersReady(!snapshot.metadata.fromCache);
      },
      (error) => {
        if (!canPublish()) return;
        setMembersError(error);
        setAllCompanyMembersReady(false);
        console.warn("Error fetching all company members", error);
      }
    );
    return () => {
      generationRef.current += 1;
      unsubscribe();
    };
  }, [isActive, suspended, targetCompanyId, userId]);
  return {
    allCompanyMembers: membersScope === scope ? allCompanyMembers : [],
    allCompanyMembersReady: membersScope === scope && allCompanyMembersReady,
    allCompanyMembersError: membersScope === scope ? membersError : null,
    setAllCompanyMembers
  };
};
var useCompanyRecruitmentController = ({
  userId,
  userEmail,
  activeRole,
  targetCompanyId,
  isActive,
  suspended = false
}) => {
  const [driverRequests, setDriverRequests] = useState([]);
  const [recruitmentApplications, setRecruitmentApplications] = useState([]);
  const generationRef = useRef(0);
  useLayoutEffect(() => {
    const generation = ++generationRef.current;
    const canPublish = () => generationRef.current === generation && !isAuthTeardownActive() && Boolean(userId) && auth.currentUser?.uid === userId;
    if (suspended) return;
    if (!userId) {
      setDriverRequests([]);
      setRecruitmentApplications([]);
      return;
    }
    setDriverRequests([]);
    const applicationCacheKey = pageCacheKey(userId, "recruitment-pending", isActive && activeRole === "admin" && targetCompanyId ? `company:${targetCompanyId}` : "own");
    const cachedApplications = readPageSnapshot(applicationCacheKey);
    setRecruitmentApplications(Array.isArray(cachedApplications?.value) ? cachedApplications.value : []);
    const publishApplications = (snapshot) => {
      if (!canPublish()) return;
      const rows = snapshot.docs.map((applicationDocument) => ({ ...applicationDocument.data(), id: applicationDocument.id }));
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
        if (!readPageSnapshot(applicationCacheKey) && rows.length) setRecruitmentApplications(rows);
        return;
      }
      writePageSnapshot(applicationCacheKey, rows);
      setRecruitmentApplications(rows);
    };
    const applicationsError = (error) => {
      if (!canPublish()) return;
      if (isPermissionFailure(error)) {
        removePageSnapshot(applicationCacheKey);
        setRecruitmentApplications([]);
      }
      console.warn("[Recruitment] \xDAltima consulta preservada quando o servidor est\xE1 indispon\xEDvel.", error);
    };
    const normalizedEmail = String(userEmail || "").trim().toLowerCase();
    const userApplicationsQuery = normalizedEmail ? query(
      collection(db, "recruitment_applications"),
      or(
        where("userId", "==", userId),
        where("email", "==", normalizedEmail)
      ),
      limit(100)
    ) : query(
      collection(db, "recruitment_applications"),
      where("userId", "==", userId),
      limit(100)
    );
    let unsubscribeRequests = () => {
    };
    let unsubscribeApplications = () => {
    };
    const onError = (label) => (error) => {
      if (!canPublish()) return;
      console.warn(label, error);
    };
    if (isActive && activeRole === "admin" && targetCompanyId) {
      unsubscribeRequests = onSnapshot(
        query(
          collection(db, "solicitacoes_motoristas"),
          where("empresaId", "==", targetCompanyId),
          where("status", "==", "pending"),
          limit(MAX_PENDING_REQUESTS)
        ),
        (snapshot) => {
          if (!canPublish()) return;
          setDriverRequests(
            snapshot.docs.map(
              (requestDocument) => ({
                ...requestDocument.data(),
                id: requestDocument.id
              })
            )
          );
        },
        onError("Error fetching driver requests admin")
      );
      unsubscribeApplications = onSnapshot(
        query(
          collection(db, "recruitment_applications"),
          where("companyId", "==", targetCompanyId),
          where("status", "==", "pending"),
          limit(MAX_PENDING_REQUESTS)
        ),
        { includeMetadataChanges: true },
        publishApplications,
        applicationsError
      );
    } else {
      if (isActive && activeRole !== "admin") {
        unsubscribeRequests = onSnapshot(
          query(
            collection(db, "solicitacoes_motoristas"),
            where("motoristaId", "==", userId),
            where("status", "==", "pending"),
            limit(20)
          ),
          (snapshot) => {
            if (!canPublish()) return;
            setDriverRequests(
              snapshot.docs.map(
                (requestDocument) => ({
                  ...requestDocument.data(),
                  id: requestDocument.id
                })
              )
            );
          },
          onError("Error fetching driver requests motorista")
        );
      }
      unsubscribeApplications = onSnapshot(
        userApplicationsQuery,
        { includeMetadataChanges: true },
        publishApplications,
        applicationsError
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
    setRecruitmentApplications
  };
};
var CompanyContext = createContext(void 0);
var CompanyProvider = ({ value, children }) => /* @__PURE__ */ jsx(CompanyContext.Provider, { value, children });
var useCompanyStore = () => {
  const context = useContext(CompanyContext);
  if (!context) {
    throw new Error("useCompanyStore must be used within AppProvider");
  }
  return context;
};
export {
  CompanyProvider,
  mergeCompanyProfile,
  normalizeCompanyProfile,
  useCompanyDataController,
  useCompanyMembersController,
  useCompanyRecruitmentController,
  useCompanyStore,
  writeCachedCompanies
};
