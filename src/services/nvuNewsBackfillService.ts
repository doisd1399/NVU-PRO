import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";

export type NvuNewsBackfillResult = {
  success: boolean;
  status: "completed" | "already_completed" | "in_progress";
  created: number;
  updated: number;
  ignored: number;
  migratedCommunications: number;
  sourceTrips: number;
  generationKey: string;
  historyVersion: string;
  removedLegacyClassifications: number;
};

let inFlight: Promise<NvuNewsBackfillResult> | null = null;
let companyApprovalSyncInFlight: Promise<CompanyApprovalNewsSyncResult> | null = null;
const HISTORY_VERSION = "nvu_news_recent_history_individual_v9_utc_consistent";
const COMPANY_APPROVAL_SYNC_VERSION = "nvu_company_approval_v6";
const STORAGE_KEY = `nvu_news_history_checked_${HISTORY_VERSION}`;
const IN_PROGRESS_CHECK_KEY = `nvu_news_history_in_progress_checked_${HISTORY_VERSION}`;
const IN_PROGRESS_RECHECK_MS = 10 * 60 * 1000;
const FAILURE_CHECK_KEY = `nvu_news_history_failure_checked_${HISTORY_VERSION}`;
const FAILURE_RECHECK_MS = 6 * 60 * 60 * 1000;
const COMPANY_APPROVAL_SYNC_KEY = `nvu_news_company_approval_checked_${COMPANY_APPROVAL_SYNC_VERSION}`;
const COMPANY_APPROVAL_SYNC_MAX_AGE_MS = 30 * 60 * 1000;

export type CompanyApprovalNewsSyncResult = {
  success: boolean;
  created: number;
  updated: number;
  ignored: number;
  removed?: number;
  activeCompanies?: number;
  expectedPosts?: number;
  publishedPosts?: number;
  consistent?: boolean;
};


function inProgressResult(): NvuNewsBackfillResult {
  return {
    success: true,
    status: "in_progress",
    created: 0,
    updated: 0,
    ignored: 0,
    migratedCommunications: 0,
    sourceTrips: 0,
    generationKey: HISTORY_VERSION,
    historyVersion: HISTORY_VERSION,
    removedLegacyClassifications: 0,
  };
}

async function invokeBackfill(): Promise<NvuNewsBackfillResult> {
  const callable = httpsCallable<Record<string, never>, NvuNewsBackfillResult>(
    functions,
    "generateNvuNewsBackfill",
  );
  const response = await callable({});
  return response.data;
}

export async function ensureNvuNewsBackfill(): Promise<NvuNewsBackfillResult> {
  if (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY) === "completed") {
    return {
      success: true,
      status: "already_completed",
      created: 0,
      updated: 0,
      ignored: 0,
      migratedCommunications: 0,
      sourceTrips: 0,
      generationKey: HISTORY_VERSION,
      historyVersion: HISTORY_VERSION,
      removedLegacyClassifications: 0,
    };
  }

  if (typeof window !== "undefined") {
    const lastInProgressCheck = Number(
      localStorage.getItem(IN_PROGRESS_CHECK_KEY) || 0,
    );
    if (
      Number.isFinite(lastInProgressCheck) &&
      lastInProgressCheck > 0 &&
      Date.now() - lastInProgressCheck < IN_PROGRESS_RECHECK_MS
    ) {
      return inProgressResult();
    }
  }

  if (typeof window !== "undefined") {
    const lastFailureCheck = Number(localStorage.getItem(FAILURE_CHECK_KEY) || 0);
    if (
      Number.isFinite(lastFailureCheck) &&
      lastFailureCheck > 0 &&
      Date.now() - lastFailureCheck < FAILURE_RECHECK_MS
    ) {
      return inProgressResult();
    }
  }

  if (inFlight) return inFlight;

  inFlight = invokeBackfill()
    .then((result) => {
      if (typeof window !== "undefined") {
        if (
          result.status !== "in_progress" &&
          result.historyVersion === HISTORY_VERSION
        ) {
          localStorage.setItem(STORAGE_KEY, "completed");
          localStorage.removeItem(IN_PROGRESS_CHECK_KEY);
          localStorage.removeItem(FAILURE_CHECK_KEY);
        } else if (result.status === "in_progress") {
          localStorage.setItem(IN_PROGRESS_CHECK_KEY, String(Date.now()));
        }
      }
      return result;
    })
    .catch((error) => {
      if (typeof window !== "undefined") {
        localStorage.setItem(FAILURE_CHECK_KEY, String(Date.now()));
      }
      throw error;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export async function ensureCompanyApprovalNewsSync(
  force = false,
  expectedActiveCompanies?: number,
): Promise<CompanyApprovalNewsSyncResult> {
  let cachedCheck: { checkedAt: number; activeCompanies?: number } | null = null;
  if (typeof window !== "undefined") {
    const raw = localStorage.getItem(COMPANY_APPROVAL_SYNC_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { checkedAt?: unknown; activeCompanies?: unknown };
        cachedCheck = {
          checkedAt: Number(parsed.checkedAt || 0),
          activeCompanies: Number.isFinite(Number(parsed.activeCompanies))
            ? Number(parsed.activeCompanies)
            : undefined,
        };
      } catch {
        const legacyTimestamp = Number(raw || 0);
        cachedCheck = Number.isFinite(legacyTimestamp)
          ? { checkedAt: legacyTimestamp }
          : null;
      }
    }
  }
  if (
    !force &&
    cachedCheck &&
    Date.now() - cachedCheck.checkedAt < COMPANY_APPROVAL_SYNC_MAX_AGE_MS &&
    (expectedActiveCompanies === undefined ||
      cachedCheck.activeCompanies === expectedActiveCompanies)
  ) {
    return { success: true, created: 0, updated: 0, ignored: 0 };
  }

  if (companyApprovalSyncInFlight) return companyApprovalSyncInFlight;

  const callable = httpsCallable<
    {
      companyId?: string;
      registrationId?: string;
      expectedActiveCompanies?: number;
      force?: boolean;
    },
    CompanyApprovalNewsSyncResult
  >(functions, "syncCompanyApprovalNews");

  companyApprovalSyncInFlight = callable({
    expectedActiveCompanies,
    force,
  })
    .then((response) => {
      if (typeof window !== "undefined") {
        if (response.data.consistent !== false) {
          localStorage.setItem(
            COMPANY_APPROVAL_SYNC_KEY,
            JSON.stringify({
              checkedAt: Date.now(),
              activeCompanies: response.data.activeCompanies,
            }),
          );
        } else {
          localStorage.removeItem(COMPANY_APPROVAL_SYNC_KEY);
        }
      }
      return response.data;
    })
    .finally(() => {
      companyApprovalSyncInFlight = null;
    });

  return companyApprovalSyncInFlight;
}
