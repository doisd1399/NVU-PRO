export const isDefinitelyOffline = () =>
  typeof navigator !== "undefined" && navigator.onLine === false;

export const isConnectivityError = (error: unknown): boolean => {
  const value = error as any;
  const code = String(value?.code || "").toLowerCase();
  const message = String(value?.message || value || "").toLowerCase();
  return isDefinitelyOffline() ||
    ["unavailable", "deadline-exceeded", "network-request-failed", "failed-precondition", "storage/retry-limit-exceeded"].some((token) => code.includes(token)) ||
    ["network", "offline", "internet", "connection", "conexão", "conexao", "rede", "failed to fetch"].some((token) => message.includes(token));
};
