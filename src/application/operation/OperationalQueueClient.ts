import type {
  QueueSettings,
  DriverQueueView,
  QueueCatalog,
  QueuePage,
} from "../../../functions/src/operationalQueueModel";
export type QueueMutation = {
  companyId: string;
  expectedRevision: number;
  action:
    | "saveQueue"
    | "setState"
    | "reorderQueues"
    | "saveVehicles"
    | "reviewHistory"
    | "normalizeLegacyJobs"
    | "resolveLegacyConflict";
  [key: string]: unknown;
};
export type QueueMutationResult = {
  success: true;
  version: 1;
  companyId: string;
  requestId: string;
  action: string;
  settings: QueueSettings;
  replayed?: boolean;
};
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const stable = (v: any): any =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .filter((k) => v[k] !== undefined)
            .map((k) => [k, stable(v[k])]),
        )
      : v;

/** Mutation requests stay recoverable after reload or a lost callable reply. */
export class OperationalQueueClient {
  private readonly inFlight = new Map<string, Promise<QueueMutationResult>>();
  constructor(
    private readonly ports: {
      getUid: () => string | null | undefined;
      storage: () => StoragePort;
      randomId: () => string;
      transport: (
        data: QueueMutation & { requestId: string },
      ) => Promise<QueueMutationResult>;
    },
  ) {}
  execute(input: QueueMutation): Promise<QueueMutationResult> {
    const uid = this.ports.getUid();
    if (!uid)
      return Promise.reject(
        new Error("Faça login para salvar a configuração."),
      );
    const args = JSON.stringify(stable(input)),
      key = `nvu.queue.command.v1.${encodeURIComponent(uid)}.${encodeURIComponent(args)}`;
    if (this.inFlight.has(key)) return this.inFlight.get(key)!;
    const task = this.send(input, uid, key, args);
    this.inFlight.set(key, task);
    void task.then(
      () => this.inFlight.delete(key),
      () => this.inFlight.delete(key),
    );
    return task;
  }
  private async send(
    input: QueueMutation,
    uid: string,
    key: string,
    args: string,
  ): Promise<QueueMutationResult> {
    let storage: StoragePort, requestId: string;
    try {
      storage = this.ports.storage();
      const raw = storage.getItem(key),
        pending = raw ? JSON.parse(raw) : null;
      if (
        pending &&
        (pending.uid !== uid ||
          pending.args !== args ||
          typeof pending.requestId !== "string" ||
          !pending.requestId)
      )
        throw new Error("INVALID_QUEUE_JOURNAL");
      requestId = pending?.requestId || this.ports.randomId();
      storage.setItem(key, JSON.stringify({ uid, args, requestId }));
    } catch {
      throw new Error(
        "Não foi possível preservar esta confirmação no aparelho. Tente novamente.",
      );
    }
    const result = await this.ports.transport({ ...input, requestId });
    if (this.ports.getUid() !== uid) throw new Error("QUEUE_SESSION_CHANGED");
    if (
      !result?.success ||
      result.version !== 1 ||
      result.companyId !== input.companyId ||
      result.requestId !== requestId ||
      result.action !== input.action ||
      result.settings?.companyId !== input.companyId ||
      result.settings.schemaVersion !== 1 ||
      result.settings.revision !== input.expectedRevision + 1
    )
      throw new Error(
        "O servidor ainda não confirmou a configuração. Tente novamente para recuperar o resultado.",
      );
    try {
      storage.removeItem(key);
    } catch {
      /* Keep original request identity. */
    }
    return result;
  }
}

/** Publish only a whole, consistent revision. Never merge pages from two
 * versions or silently replace the last complete offline snapshot by a cut. */
export async function collectOperationalQueuePages(
  fetchPage: (input: Record<string, unknown>) => Promise<QueuePage>,
  input: { companyId: string; kind: "driver" | "catalog"; driverId?: string },
  isCurrent = () => true,
): Promise<DriverQueueView | QueueCatalog> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let first: QueuePage | null = null,
      offset = 0;
    const all: any[] = [];
    const identities = new Set<string>();
    try {
      while (true) {
        if (!isCurrent()) throw new Error("QUEUE_SESSION_CHANGED");
        const page = await fetchPage({
          ...input,
          offset,
          ...(first ? { viewToken: first.viewToken } : {}),
        });
        if (!isCurrent()) throw new Error("QUEUE_SESSION_CHANGED");
        if (
          !page?.success ||
          page.version !== 1 ||
          page.companyId !== input.companyId ||
          page.kind !== input.kind ||
          page.view?.companyId !== input.companyId ||
          !page.viewToken ||
          !Number.isSafeInteger(page.totalItems) ||
          page.totalItems < 0 ||
          page.offset !== offset ||
          !Array.isArray(page.items) ||
          (input.kind === "driver" &&
            input.driverId &&
            (page.view as any).driverId !== input.driverId)
        )
          throw new Error("QUEUE_PAGE_INVALID");
        if (
          first &&
          (first.viewToken !== page.viewToken ||
            first.totalItems !== page.totalItems)
        )
          throw Object.assign(new Error("QUEUE_PAGE_REVISION_CHANGED"), {
            code: "aborted",
          });
        first ||= page;
        for (const item of page.items) {
          const identity =
            input.kind === "driver"
              ? `${(item as any).queueId}\u0000${item.id}`
              : item.id;
          if (
            !item.id ||
            item.companyId !== input.companyId ||
            identities.has(identity)
          )
            throw new Error("QUEUE_PAGE_DUPLICATE_OR_FOREIGN");
          identities.add(identity);
          all.push(item);
        }
        if (page.nextOffset === null) {
          if (all.length !== page.totalItems)
            throw new Error("QUEUE_PAGE_INCOMPLETE");
          break;
        }
        if (
          !page.items.length ||
          page.nextOffset !== offset + page.items.length ||
          page.nextOffset >= page.totalItems
        )
          throw new Error("QUEUE_PAGE_CURSOR_INVALID");
        offset = page.nextOffset;
      }
      return input.kind === "driver"
        ? ({ ...first!.view, items: all } as DriverQueueView)
        : ({ ...first!.view, contracts: all } as QueueCatalog);
    } catch (error: any) {
      if (attempt < 2 && String(error?.code || "").includes("aborted"))
        continue;
      throw error;
    }
  }
  throw new Error("A fila mudou durante a leitura. Atualize novamente.");
}
