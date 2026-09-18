import {
  collection,
  getDocsFromServer,
  onSnapshot,
  query,
  where,
  type Firestore,
} from "firebase/firestore";

export type MembershipRepositoryRecord = {
  id: string;
  userId: string;
  companyId: string;
  status: string;
};

type FirebaseUserLike = {
  getIdToken?: (forceRefresh?: boolean) => Promise<string>;
};

type MembershipSnapshotHandler<T> = (
  records: T[],
  fromCache: boolean,
) => void;

type MembershipErrorHandler = (error: unknown) => void;

export type MembershipRepository<T extends MembershipRepositoryRecord> = {
  readCache: () => T[];
  hasCachedSnapshot: () => boolean;
  subscribe: (handlers: {
    onSnapshot: MembershipSnapshotHandler<T>;
    onError: MembershipErrorHandler;
  }) => () => void;
  recoverFromServer: () => Promise<T[]>;
};

type MembershipRepositoryOptions<T extends MembershipRepositoryRecord> = {
  db: Firestore;
  uid: string;
  normalize: (raw: Record<string, unknown>, id: string) => T;
  readCache: () => T[];
  hasCachedSnapshot: () => boolean;
  writeCache: (records: T[]) => void;
  getCurrentUser: () => FirebaseUserLike | null;
  timeoutMs?: number;
  attempts?: number;
};

const wait = (delayMs: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));

const withTimeout = <T,>(
  operation: () => Promise<T>,
  timeoutMs: number,
): Promise<T> => {
  let timeoutId: number | undefined;
  const timedOut = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(
      () => reject(new Error("membership-server-read-timeout")),
      timeoutMs,
    );
  });

  return Promise.race([Promise.resolve().then(operation), timedOut]).finally(() => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  });
};

const isRecoverableError = (error: unknown) => {
  const code = String((error as { code?: unknown })?.code || "").toLowerCase();
  const message = String((error as { message?: unknown })?.message || "").toLowerCase();
  return (
    !code ||
    code.includes("unavailable") ||
    code.includes("deadline-exceeded") ||
    code.includes("network-request-failed") ||
    code.includes("cancelled") ||
    message.includes("timeout")
  );
};

export function createMembershipRepository<
  T extends MembershipRepositoryRecord,
>({
  db,
  uid,
  normalize,
  readCache,
  hasCachedSnapshot,
  writeCache,
  getCurrentUser,
  timeoutMs = 9_000,
  attempts = 3,
}: MembershipRepositoryOptions<T>): MembershipRepository<T> {
  const membershipQuery = query(
    collection(db, "companyMembers"),
    where("userId", "==", uid),
  );

  const mapSnapshot = (snapshot: {
    docs: Array<{ id: string; data: () => Record<string, unknown> }>;
  }) =>
    snapshot.docs.map((membershipDocument) =>
      normalize(membershipDocument.data(), membershipDocument.id),
    );

  const recoverFromServer = async (): Promise<T[]> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const snapshot = await withTimeout(
          () => getDocsFromServer(membershipQuery),
          timeoutMs,
        );
        const records = mapSnapshot(snapshot);
        writeCache(records);
        return records;
      } catch (error) {
        lastError = error;
        if (!isRecoverableError(error) || attempt === attempts - 1) {
          throw error;
        }
        try {
          await getCurrentUser()?.getIdToken?.(attempt > 0);
        } catch {
          // The next server attempt can still refresh the Firestore transport.
        }
        await wait(300 * 2 ** attempt);
      }
    }
    throw lastError;
  };

  return {
    readCache,
    hasCachedSnapshot,
    subscribe: ({ onSnapshot: handleSnapshot, onError }) =>
      onSnapshot(
        membershipQuery,
        (snapshot) => {
          handleSnapshot(mapSnapshot(snapshot), snapshot.metadata.fromCache);
        },
        onError,
      ),
    recoverFromServer,
  };
}
