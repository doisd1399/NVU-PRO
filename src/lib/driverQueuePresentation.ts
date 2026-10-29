import type { DriverQueueView, QueueItem } from "../../functions/src/operationalQueueModel";

/** Read-only projection. Eligibility and the start token always come from the server. */
export function driverQueuePresentation(view: DriverQueueView, previewSize = 4) {
  const order = new Map(view.queues.map((queue, index) => [queue.id, index]));
  // Completed entries remain in the snapshot/history and aggregate progress,
  // but never return when the driver expands the operational queue.
  const items = view.items.filter(item => order.has(item.queueId) && item.state !== "done").sort((a, b) =>
    (order.get(a.queueId) ?? Infinity) - (order.get(b.queueId) ?? Infinity) ||
    a.position - b.position || a.id.localeCompare(b.id));
  const isNext = (item: QueueItem) => Boolean(item.state !== "done" && view.next &&
    item.queueId === view.next.queueId && item.id === view.next.contractId);
  const next = items.find(isNext) ?? null;
  const upcoming = items.filter(item => !isNext(item));
  const count = view.queues.reduce((sum, queue) => sum + Math.max(0, queue.count), 0);
  const done = view.queues.reduce((sum, queue) => sum + Math.max(0, Math.min(queue.done, queue.count)), 0);
  return { items, next, upcoming, preview: upcoming.slice(0, Math.max(1, previewSize)),
    count, done, percent: count ? Math.round(done / count * 100) : 0, isNext };
}
