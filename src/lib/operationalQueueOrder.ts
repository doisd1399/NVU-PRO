import {
  compareQueueContracts,
  orderQueueContracts,
  type QueueContract,
  type QueueSettings,
} from "../../functions/src/operationalQueueModel";
export function orderOperationalContracts<
  T extends {
    id: string;
    name: string;
    sequenceId?: string | null;
    sequenceOrder?: number | null;
  },
>(items: T[], settings?: QueueSettings | null): T[] {
  const order =
    settings?.queues
      .filter((q) => q.state !== "archived")
      .flatMap((q) => q.orderIds) || [];
  return orderQueueContracts(
    items as unknown as QueueContract[],
    order,
  ) as unknown as T[];
}
export function orderOperationalFolders<T extends { id: string }>(
  folders: T[],
  settings?: QueueSettings | null,
): T[] {
  const order = new Map(
    (settings?.queues || [])
      .filter((q) => q.state !== "archived")
      .map((q, i) => [q.folderId, i]),
  );
  return [...folders].sort(
    (a, b) =>
      (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}
export { compareQueueContracts };
