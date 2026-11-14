import React from "react";

type Config = { failDriverIds?: string[]; emptyDrivers?: boolean; membersReady?: boolean; hold?: boolean; trailerless?: boolean };
let config: Config = {};
let calls: any[] = [];
let release: (() => void) | undefined;
const drivers = [
  { id: "david", name: "David Canto", status: "active", photoURL: "/fixture-avatar.png" },
  { id: "aline", name: "Aline Santos", status: "active" },
  { id: "other", name: "Outra empresa", status: "active" },
];
const folders = [{ id: "ops", name: "Operação padrão", scope: "operations" }, { id: "buses", name: "Ônibus", scope: "vehicles" }];
const trailers = [{ id: "t1", name: "Baú 3 eixos" }, { id: "t2", name: "Rodotrem Graneleiro 6 eixos" }];
const vehicles = ["Iveco S Way", "Mercedes 1620", "Mercedes Axor", "Scania G", "Scania P 320", "Scania R 440"].map((name, i) => ({ id: "v" + i, name, photoUrl: "/must-not-load-vehicle.png" }));
const baseContracts = [
  { id: "c10", name: "BLS - 10", trailerId: "t1", totalDeliveries: 12, deadlineDays: 4, status: "active", sequenceOrder: 0, sequenceId: "ops", simulator: "gto", companyId: "company" },
  { id: "c20", name: "BLS - 20", trailerId: "t2", totalDeliveries: 10, deadlineDays: 4, status: "active", sequenceOrder: 1, sequenceId: "ops", simulator: "gto", companyId: "company" },
  { id: "c30", name: "BLS - 30", trailerId: "t2", totalDeliveries: 12, deadlineDays: 4, status: "active", sequenceOrder: 2, sequenceId: "ops", simulator: "gto", companyId: "company" },
  { id: "special", name: "Operação especial", trailerId: "t1", totalDeliveries: 8, deadlineDays: 3, status: "active", simulator: "gto", companyId: "company" },
  { id: "done", name: "Já finalizada", totalDeliveries: 12, deadlineDays: 4, status: "completed", simulator: "gto", companyId: "company" },
];
export const fixture493 = {
  reset(next: Config = {}) { config = next; calls = []; release = undefined; },
  calls: () => calls,
  retry() { config.failDriverIds = []; },
  release() { release?.(); },
};
export function useSessionStore() { return { currentUser: drivers[0], activeRole: "admin" }; }
export function useCompanyStore() {
  return {
    activeCompanyId: "company", companies: [{ id: "company", companyName: "DC Transportes" }],
    allCompanyMembersReady: config.membersReady !== false,
    allCompanyMembers: config.emptyDrivers ? [] : drivers.slice(0, 2).map(driver => ({ companyId: "company", userId: driver.id, status: "active", roles: ["driver"] })),
  };
}
export function useOperationalStore() {
  return {
    users: drivers, sequences: folders, vehicles, trailers,
    simulators: [{ id: "gto", name: "GTO" }, { id: "wbds", name: "WBDS" }],
    contracts: config.trailerless ? baseContracts.map(c => ({ ...c, simulator: "wbds" })) : baseContracts,
    jobs: [{ id: "running", companyId: "company", driverId: "david", vehicleId: "v0", contractId: "c10", status: "in_progress", totalDeliveries: 12, delivered: 3, startedAt: "2026-10-21T10:00:00Z" }],
    async assignJob(...args: any[]) {
      calls.push(args);
      if (config.hold) await new Promise<void>(resolve => { release = resolve; });
      if (config.failDriverIds?.includes(args[1])) throw new Error("Falha de teste para " + args[1]);
    },
  };
}
export function useOptionalAutomaticOperations() { return null; }
export function StableImage({ src, alt, wrapperClassName, className, fallback }: any) {
  return <div className={wrapperClassName}>{src ? <img src={src} alt={alt} className={"h-full w-full " + (className || "")} /> : fallback}</div>;
}
