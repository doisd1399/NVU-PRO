export type SimulatorDocument = Record<string, unknown>;

export interface NormalizedSimulator extends SimulatorDocument {
  id: string;
  name: string;
  active: boolean;
}

const readText = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
};

const humanizeSimulatorId = (id: string): string =>
  id
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => {
      if (/^\d+$/.test(part)) return part;
      if (part.length <= 4) return part.toUpperCase();
      return `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`;
    })
    .join(" ");

const readActive = (raw: SimulatorDocument): boolean => {
  const candidates = [raw.active, raw.isActive, raw.ativo];

  for (const value of candidates) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["false", "0", "inactive", "disabled", "inativo"].includes(normalized)) {
        return false;
      }
      if (["true", "1", "active", "enabled", "ativo"].includes(normalized)) {
        return true;
      }
    }
    if (typeof value === "number") return value !== 0;
  }

  if (typeof raw.status === "string") {
    const status = raw.status.trim().toLowerCase();
    if (["inactive", "disabled", "inativo"].includes(status)) return false;
  }

  // Legacy documents without an activity flag remain available.
  return true;
};

/**
 * Converts a Firestore simulator document into the canonical shape consumed by
 * the UI. The Firestore document id remains the official simulatorId.
 * No simulator is created or injected by this function.
 */
export const normalizeSimulatorDocument = (
  documentId: string,
  data: unknown,
): NormalizedSimulator | null => {
  const id = readText(documentId);
  if (!id) return null;

  const raw: SimulatorDocument =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as SimulatorDocument)
      : {};

  const name =
    readText(
      raw.name,
      raw.simulatorName,
      raw.nome,
      raw.label,
      raw.title,
      raw.displayName,
    ) || humanizeSimulatorId(id);

  return {
    ...raw,
    id,
    name,
    active: readActive(raw),
  };
};

export const normalizeSimulatorDocuments = (
  documents: Array<{ id: string; data: unknown }>,
): NormalizedSimulator[] => {
  const byId = new Map<string, NormalizedSimulator>();

  for (const document of documents) {
    const normalized = normalizeSimulatorDocument(document.id, document.data);
    if (normalized) byId.set(normalized.id, normalized);
  }

  return Array.from(byId.values());
};
