import * as functions from "firebase-functions/v1";

type CallableContext = functions.https.CallableContext;

function normalizedRoles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((role): role is string => typeof role === "string")
    .filter(Boolean);
}

export function hasSeniorClaim(context: CallableContext): boolean {
  const token = context.auth?.token as Record<string, unknown> | undefined;
  if (!token) return false;

  return (
    token.senior === true ||
    token.isSenior === true ||
    token.role === "senior" ||
    normalizedRoles(token.roles).includes("senior")
  );
}

export function requireSenior(
  context: CallableContext,
  message = "Permissão Sênior obrigatória.",
): void {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Autenticação obrigatória.");
  }
  if (!hasSeniorClaim(context)) {
    throw new functions.https.HttpsError("permission-denied", message);
  }
}
