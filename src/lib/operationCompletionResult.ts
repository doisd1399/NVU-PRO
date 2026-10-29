import type { OperationResultData } from "../components/OperationResultModal";

export const OPERATION_RESULT_READY_EVENT = "nvu-operation-result-ready";
const STORAGE_KEY = "nvu.operation-result-ready.v1";
const MAX_AGE_MS = 10 * 60 * 1000;

type OperationResultHandoff = {
  userId: string;
  companyId: string;
  jobId: string;
  data: OperationResultData;
  createdAt: number;
};

let latestHandoff: OperationResultHandoff | null = null;

function isValidHandoff(
  value: unknown,
  userId: string,
  companyId?: string | null,
): value is OperationResultHandoff {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OperationResultHandoff>;
  return Boolean(
    candidate.userId === userId
      && (!companyId || candidate.companyId === companyId)
      && candidate.jobId
      && candidate.data
      && typeof candidate.createdAt === "number"
      && Date.now() - candidate.createdAt <= MAX_AGE_MS,
  );
}

function readStoredHandoff(userId: string, companyId?: string | null): OperationResultHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidHandoff(parsed, userId, companyId) ? parsed : null;
  } catch {
    return null;
  }
}

export function publishOperationCompletionResult(input: {
  userId: string;
  companyId: string;
  jobId: string;
  data: OperationResultData;
}): void {
  const handoff: OperationResultHandoff = {
    ...input,
    createdAt: Date.now(),
  };
  latestHandoff = handoff;
  if (typeof window === "undefined") return;
  persistOperationCompletionResult(handoff);
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(handoff));
  } catch {
    // The in-memory event remains sufficient while the Dashboard is mounted.
  }
  window.dispatchEvent(
    new CustomEvent<OperationResultHandoff>(OPERATION_RESULT_READY_EVENT, {
      detail: handoff,
    }),
  );
}

export function consumeOperationCompletionResult(
  userId: string,
  companyId?: string | null,
): OperationResultHandoff | null {
  const candidate = isValidHandoff(latestHandoff, userId, companyId)
    ? latestHandoff
    : readStoredHandoff(userId, companyId);
  if (!candidate) return null;
  latestHandoff = null;
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage cleanup failures; the in-memory value was consumed.
    }
  }
  return candidate;
}

const archiveKey = (userId: string, companyId: string) =>
  `nvu.operation-results.v1.${encodeURIComponent(userId)}.${encodeURIComponent(companyId)}`;

function persistOperationCompletionResult(handoff: OperationResultHandoff): void {
  try {
    const key = archiveKey(handoff.userId, handoff.companyId);
    const raw = window.localStorage.getItem(key);
    const previous = raw ? JSON.parse(raw) : [];
    const entries = Array.isArray(previous) ? previous.filter(value => value?.jobId !== handoff.jobId) : [];
    window.localStorage.setItem(key, JSON.stringify([handoff, ...entries].slice(0, 25)));
  } catch { /* The confirmed job/history can reconstruct the result if storage is full. */ }
}

/** Durable details are displayed only alongside a completed job in this scope. */
export function readOperationCompletionResult(userId: string, companyId: string, jobId: string): OperationResultData | null {
  if (!userId || !companyId || !jobId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(archiveKey(userId, companyId));
    const entries: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(entries)) return null;
    const result = entries.find(value => value?.userId === userId && value?.companyId === companyId && value?.jobId === jobId);
    return result?.data && typeof result.data.contractName === "string" && Number.isFinite(result.data.totalViagens)
      ? result.data : null;
  } catch { return null; }
}
