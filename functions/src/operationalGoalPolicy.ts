type Data = Record<string, any>;
export type GoalRequest = { action: "read" | "save"; companyId: string; simulatorId: string; documentId: string; periodKey: string; targetAmount?: number };
export function parseFinancialGoalRequest(raw: unknown): GoalRequest {
  const data = raw && typeof raw === "object" ? raw as Data : {};
  const validId = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 180 && !/[\/\0]/.test(value) && !value.includes("__") && ![".", ".."].includes(value);
  if (!["read", "save"].includes(data.action) || !validId(data.companyId) || !validId(data.simulatorId) || typeof data.documentId !== "string") throw new Error("INVALID_GOAL_SCOPE");
  const prefix = `${data.companyId}__${data.simulatorId}__`;
  const match = data.documentId.startsWith(prefix) && /^(\d{4})(\d{2})(\d{2})_(\d{4})(\d{2})(\d{2})$/.exec(data.documentId.slice(prefix.length));
  if (!match) throw new Error("INVALID_GOAL_PERIOD");
  const start = `${match[1]}-${match[2]}-${match[3]}`, end = `${match[4]}-${match[5]}-${match[6]}`;
  const validDate = (value: string) => { const date = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; };
  if (!validDate(start) || !validDate(end) || start > end) throw new Error("INVALID_GOAL_PERIOD");
  if (data.action === "save" && (typeof data.targetAmount !== "number" || !Number.isFinite(data.targetAmount) || data.targetAmount <= 0 || data.targetAmount > 1e15)) throw new Error("INVALID_GOAL_AMOUNT");
  return { action: data.action, companyId: data.companyId, simulatorId: data.simulatorId, documentId: data.documentId, periodKey: `range:${start}:${end}`, ...(data.action === "save" ? { targetAmount: data.targetAmount } : {}) };
}
