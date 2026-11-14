/**
 * Simulators asked for in a company registration. A registration made before several simulators could be chosen has only
 * `simulatorId`/`simulatorName`; a new one also has `simulatorIds`/`simulatorNames` (the first of them is `simulatorId`).
 */
type Row = Record<string, any>;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

/** Catalog ids of every requested simulator, the first one first, without repeats. */
export function registrationSimulatorIds(registration: Row | null | undefined): string[] {
  if (!registration) return [];
  const listed = Array.isArray(registration.simulatorIds) ? registration.simulatorIds.map(text).filter(Boolean) : [];
  return [...new Set([text(registration.simulatorId), ...listed].filter(Boolean))];
}

/** What the review screen shows: every chosen name, or the single legacy name. */
export function registrationSimulatorLabel(registration: Row | null | undefined): string {
  if (!registration) return "N/A";
  const names = Array.isArray(registration.simulatorNames) ? registration.simulatorNames.map(text).filter(Boolean) : [];
  if (names.length > 1) return names.join(", ");
  return text(registration.simulatorName) || names[0] || "N/A";
}

/** The simulators beyond the one the first fleet is created with (those are created by the server after the approval). */
export function extraRegistrationSimulatorIds(registration: Row | null | undefined, primarySimulatorId: string, aliasOf: (id: string) => string = id => id): string[] {
  const primary = aliasOf(primarySimulatorId);
  return registrationSimulatorIds(registration).filter(id => id !== primarySimulatorId && aliasOf(id) !== primary);
}
