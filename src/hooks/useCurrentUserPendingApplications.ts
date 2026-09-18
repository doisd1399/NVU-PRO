import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import type { RecruitmentApplication } from "../context/AppContext";

const MAX_PENDING_PER_IDENTITY = 20;

const resolveApplicationType = (application: RecruitmentApplication) =>
  String(application.type || application.registrationType || "driver_application");

const pendingApplicationsCache = new Map<
  string,
  { applications: RecruitmentApplication[]; loaded: boolean }
>();

type PendingCompanySnapshot = {
  companyName?: string;
  companyLogoURL?: string;
  simulatorName?: string;
};

// Legacy driver applications did not persist the company display snapshot.
// Resolve only the exact referenced company document, once, so old pending
// cards can be repaired without reloading the full company catalog.
const pendingCompanySnapshotCache = new Map<
  string,
  PendingCompanySnapshot | null
>();
const pendingCompanySnapshotPromises = new Map<
  string,
  Promise<PendingCompanySnapshot | null>
>();

const loadPendingCompanySnapshot = (companyId: string) => {
  if (pendingCompanySnapshotCache.has(companyId)) {
    return Promise.resolve(pendingCompanySnapshotCache.get(companyId) ?? null);
  }

  const existingPromise = pendingCompanySnapshotPromises.get(companyId);
  if (existingPromise) return existingPromise;

  const promise = getDoc(doc(db, "frotas", companyId))
    .then((snapshot) => {
      if (!snapshot.exists()) {
        pendingCompanySnapshotCache.set(companyId, null);
        return null;
      }

      const company = snapshot.data() as Record<string, unknown>;
      const resolved: PendingCompanySnapshot = {
        companyName: String(
          company.companyName || company.fleetName || "",
        ).trim(),
        companyLogoURL: String(
          company.logoUrl || company.logoURL || company.companyLogoURL || "",
        ).trim(),
        simulatorName: String(company.simulatorName || "").trim(),
      };
      pendingCompanySnapshotCache.set(companyId, resolved);
      return resolved;
    })
    .catch((error) => {
      console.warn(
        "[NVU Pending Applications] Falha ao resolver empresa de inscrição legada.",
        error,
      );
      pendingCompanySnapshotCache.set(companyId, null);
      return null;
    })
    .finally(() => {
      pendingCompanySnapshotPromises.delete(companyId);
    });

  pendingCompanySnapshotPromises.set(companyId, promise);
  return promise;
};

const applyCachedPendingCompanySnapshot = (
  application: RecruitmentApplication,
): RecruitmentApplication => {
  if (resolveApplicationType(application) === "company_registration") {
    return application;
  }

  const companyId = String(application.companyId || "").trim();
  const snapshot = pendingCompanySnapshotCache.get(companyId);
  if (!snapshot) return application;

  const companyName =
    String(application.companyName || "").trim() || snapshot.companyName || "";
  const companyLogoURL =
    String(application.companyLogoURL || "").trim() ||
    snapshot.companyLogoURL ||
    "";
  const simulatorName =
    String(application.simulatorName || "").trim() ||
    snapshot.simulatorName ||
    "";

  if (
    companyName === String(application.companyName || "").trim() &&
    companyLogoURL === String(application.companyLogoURL || "").trim() &&
    simulatorName === String(application.simulatorName || "").trim()
  ) {
    return application;
  }

  return {
    ...application,
    companyName,
    companyLogoURL,
    simulatorName,
  };
};

const buildPendingApplicationsCacheKey = (
  userId?: string | null,
  email?: string | null,
) => {
  const normalizedUserId = String(userId || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  return `${normalizedUserId}::${normalizedEmail}`;
};

const normalizePendingApplications = (
  applications: RecruitmentApplication[],
) =>
  Array.from(
    new Map(
      applications
        .filter((application) => {
          if (application.status !== "pending") return false;
          const applicationType = resolveApplicationType(application);
          if (applicationType === "company_registration") return true;
          return application.isCurrent !== false;
        })
        .map((application) => [application.id, application]),
    ).values(),
  )
    .map(applyCachedPendingCompanySnapshot)
    .sort((a, b) => {
    const timeA = Date.parse(String(a.createdAt || "")) || 0;
    const timeB = Date.parse(String(b.createdAt || "")) || 0;
    return timeB - timeA;
  });

export function useCurrentUserPendingApplications(
  userId?: string | null,
  email?: string | null,
) {
  const cacheKey = useMemo(
    () => buildPendingApplicationsCacheKey(userId, email),
    [email, userId],
  );
  const initialCache = pendingApplicationsCache.get(cacheKey);
  const [applications, setApplications] = useState<RecruitmentApplication[]>(
    () => initialCache?.applications || [],
  );
  const [loading, setLoading] = useState(() => Boolean(userId || email));
  const [queryError, setQueryError] = useState(false);

  useEffect(() => {
    const normalizedUserId = String(userId || "").trim();
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!normalizedUserId && !normalizedEmail) {
      setApplications([]);
      setLoading(false);
      setQueryError(false);
      return;
    }

    const cached = pendingApplicationsCache.get(cacheKey);
    if (cached?.applications?.length) {
      setApplications(cached.applications);
    } else {
      setApplications([]);
    }
    // Keep the access button disabled until the two small, server-filtered
    // initial snapshots have settled. This prevents an initial Firestore
    // callback from racing the very first tap on SelectProfile.
    setLoading(true);
    setQueryError(false);

    let active = true;
    let userReady = !normalizedUserId;
    let emailReady = !normalizedEmail;
    let userSucceeded = !normalizedUserId;
    let emailSucceeded = !normalizedEmail;
    const userApplications = new Map<string, RecruitmentApplication>();
    const emailApplications = new Map<string, RecruitmentApplication>();

    const publish = () => {
      const allSettled = userReady && emailReady;
      const nextApplications = normalizePendingApplications([
        ...userApplications.values(),
        ...emailApplications.values(),
      ]);
      const anyQueryFailed =
        (Boolean(normalizedUserId) && userReady && !userSucceeded) ||
        (Boolean(normalizedEmail) && emailReady && !emailSucceeded);

      // A non-empty result is always safe to publish immediately. An empty
      // result is authoritative only after every requested identity query has
      // settled successfully; otherwise retain the last known cache instead
      // of making the pending UI disappear because one listener failed.
      const canPublishEmpty = allSettled && !anyQueryFailed;
      const nextVisibleApplications =
        nextApplications.length > 0 || canPublishEmpty
          ? nextApplications
          : cached?.applications || [];

      if (nextApplications.length > 0 || canPublishEmpty) {
        pendingApplicationsCache.set(cacheKey, {
          applications: nextApplications,
          loaded: allSettled,
        });
      }

      if (!active) return;
      setApplications(nextVisibleApplications);
      if (allSettled) {
        setLoading(false);
        setQueryError(anyQueryFailed);
      }
    };

    const unsubscribers: Array<() => void> = [];

    if (normalizedUserId) {
      const userPendingQuery = query(
        collection(db, "recruitment_applications"),
        where("userId", "==", normalizedUserId),
        where("status", "==", "pending"),
        limit(MAX_PENDING_PER_IDENTITY),
      );
      unsubscribers.push(
        onSnapshot(
          userPendingQuery,
          (snapshot) => {
            userApplications.clear();
            snapshot.docs.forEach((applicationDocument) => {
              userApplications.set(applicationDocument.id, {
                ...applicationDocument.data(),
                id: applicationDocument.id,
              } as RecruitmentApplication);
            });
            userSucceeded = true;
            userReady = true;
            publish();
          },
          (error) => {
            console.warn(
              "[NVU Pending Applications] Falha na consulta pendente por usuário.",
              error,
            );
            userReady = true;
            publish();
          },
        ),
      );
    }

    if (normalizedEmail) {
      const emailPendingQuery = query(
        collection(db, "recruitment_applications"),
        where("email", "==", normalizedEmail),
        where("status", "==", "pending"),
        limit(MAX_PENDING_PER_IDENTITY),
      );
      unsubscribers.push(
        onSnapshot(
          emailPendingQuery,
          (snapshot) => {
            emailApplications.clear();
            snapshot.docs.forEach((applicationDocument) => {
              emailApplications.set(applicationDocument.id, {
                ...applicationDocument.data(),
                id: applicationDocument.id,
              } as RecruitmentApplication);
            });
            emailSucceeded = true;
            emailReady = true;
            publish();
          },
          (error) => {
            console.warn(
              "[NVU Pending Applications] Falha na consulta pendente por e-mail.",
              error,
            );
            emailReady = true;
            publish();
          },
        ),
      );
    }

    if (userReady && emailReady) publish();

    return () => {
      active = false;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [cacheKey, email, userId]);

  useEffect(() => {
    const legacyCompanyIds = Array.from(
      new Set(
        applications
          .filter((application) => {
            const applicationType = resolveApplicationType(application);
            if (applicationType === "company_registration") return false;
            if (!String(application.companyId || "").trim()) return false;
            return (
              !String(application.companyName || "").trim() ||
              !String(application.companyLogoURL || "").trim() ||
              !String(application.simulatorName || "").trim()
            );
          })
          .map((application) => String(application.companyId).trim()),
      ),
    );

    if (legacyCompanyIds.length === 0) return;

    let active = true;
    void Promise.all(legacyCompanyIds.map(loadPendingCompanySnapshot)).then(() => {
      if (!active) return;

      setApplications((current) => {
        let changed = false;
        const enriched = current.map((application) => {
          const nextApplication = applyCachedPendingCompanySnapshot(application);
          if (nextApplication !== application) changed = true;
          return nextApplication;
        });

        if (!changed) return current;

        const cachedState = pendingApplicationsCache.get(cacheKey);
        pendingApplicationsCache.set(cacheKey, {
          applications: enriched,
          loaded: cachedState?.loaded ?? !loading,
        });
        return enriched;
      });
    });

    return () => {
      active = false;
    };
  }, [applications, cacheKey, loading]);

  return { applications, loading, queryError };
}
