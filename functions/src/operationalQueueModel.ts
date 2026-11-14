// Pure shared model: no Firebase, platform, storage, or clock dependency.
export type QueueAudience = "all" | "selected";
export type QueueState = "active" | "paused" | "archived";
export type OperationalQueue = {
  id: string;
  folderId: string;
  state: QueueState;
  audience: QueueAudience;
  driverIds: string[];
  orderIds: string[];
};
export type VehicleOverride = { driverId: string; vehicleIds: string[] };
export type QueueSettings = {
  companyId: string;
  schemaVersion: 1;
  revision: number;
  queues: OperationalQueue[];
  vehicleIds: string[] | null;
  driverVehicles: VehicleOverride[];
};
export type QueueContract = {
  id: string;
  companyId: string;
  name: string;
  sequenceId?: string;
  sequenceOrder?: number;
  simulator?: string;
  totalDeliveries?: number;
  deadlineDays?: number;
  trailerId?: string | null;
  mode?: string;
  deliveries?: { id?: string; origin: string; destination: string }[];
  deleted?: boolean;
  status?: string;
};
export type QueueVehicle = {
  id: string;
  name: string;
  plate?: string;
  status?: string;
  deleted?: boolean;
  companyId?: string;
};
export type QueueItem = QueueContract & {
  queueId: string;
  folderName: string;
  position: number;
  state: "done" | "current" | "pending" | "review" | "unavailable";
  completionSource?: "canonical" | "legacy-ledger" | "manager-review";
  trailerName?: string;
  issue?: string;
};
export type QueueHeader = {
  id: string;
  name: string;
  state: QueueState;
  audience: QueueAudience;
  count: number;
  done: number;
  review: number;
};
export type QueueNext = {
  queueId: string;
  contractId: string;
  configRevision: number;
  previewToken: string;
};
export type DriverQueueView = {
  companyId: string;
  driverId: string;
  simulatorId: string;
  configRevision: number;
  viewToken: string;
  historyToken: string;
  reviewedAt?: string;
  generatedAt: string;
  queues: QueueHeader[];
  items: QueueItem[];
  vehicles: QueueVehicle[];
  next: QueueNext | null;
  currentJob: { id: string; contractId: string; status: string } | null;
  manualPendingIds: string[];
  lastVehicleId?: string;
  reason:
    | "running"
    | "manual_pending"
    | "review"
    | "vehicles_unconfigured"
    | "no_vehicles"
    | "no_queues"
    | "complete"
    | "ready";
};
export type QueueCatalog = {
  companyId: string;
  configRevision: number;
  viewToken: string;
  settings: QueueSettings;
  folders: { id: string; name: string; token: string }[];
  contracts: QueueContract[];
  vehicles: QueueVehicle[];
  drivers: { id: string; name: string }[];
};
export type QueuePage = {
  success: true;
  version: 1;
  companyId: string;
  kind: "driver" | "catalog";
  viewToken: string;
  totalItems: number;
  offset: number;
  nextOffset: number | null;
  view: Omit<DriverQueueView, "items"> | Omit<QueueCatalog, "contracts">;
  items: QueueItem[] | QueueContract[];
};

export const emptyQueueSettings = (companyId: string): QueueSettings => ({
  companyId,
  schemaVersion: 1,
  revision: 0,
  queues: [],
  vehicleIds: null,
  driverVehicles: [],
});
const rank = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : Number.MAX_SAFE_INTEGER;
export function compareQueueContracts(
  a: QueueContract,
  b: QueueContract,
): number {
  return (
    rank(a.sequenceOrder) - rank(b.sequenceOrder) ||
    String(a.name || "").localeCompare(String(b.name || ""), "pt-BR", {
      numeric: true,
      sensitivity: "base",
    }) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
export function orderQueueContracts<T extends QueueContract>(
  items: T[],
  orderIds: string[] = [],
): T[] {
  const positions = new Map(orderIds.map((id, index) => [id, index]));
  return [...items].sort(
    (a, b) =>
      (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
      compareQueueContracts(a, b),
  );
}
export function visibleVehicleIds(
  settings: QueueSettings,
  driverId: string,
): Set<string> {
  const defaults = new Set(settings.vehicleIds || []),
    override = settings.driverVehicles.find((row) => row.driverId === driverId);
  return override
    ? new Set(override.vehicleIds.filter((id) => defaults.has(id)))
    : defaults;
}
export function queueApplies(
  queue: OperationalQueue,
  driverId: string,
): boolean {
  return (
    queue.state !== "archived" &&
    (queue.audience === "all" || queue.driverIds.includes(driverId))
  );
}
