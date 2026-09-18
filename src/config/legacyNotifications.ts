/**
 * Controles graduais de compatibilidade com a coleção legada `notificacoes`.
 *
 * Todos os controles permanecem ativados por padrão para preservar clientes e
 * regras ainda não migrados. A retirada deve ocorrer uma capacidade por vez,
 * somente após validação em produção.
 */
function readCompatibilityFlag(value: unknown, defaultValue = true) {
  if (typeof value !== "string" || !value.trim()) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["false", "0", "off", "no"].includes(normalized)) return false;
  if (["true", "1", "on", "yes"].includes(normalized)) return true;
  return defaultValue;
}

export const legacyNotificationCompatibility = Object.freeze({
  /** Carrega uma página limitada de avisos legados não lidos ao iniciar. */
  readHistory: readCompatibilityFlag(
    import.meta.env.VITE_LEGACY_NOTIFICATIONS_READ_HISTORY,
  ),
  /** Mantém o listener limitado apenas para avisos legados muito recentes. */
  listenRealtime: readCompatibilityFlag(
    import.meta.env.VITE_LEGACY_NOTIFICATIONS_REALTIME,
  ),
  /** Permite gravar no legado somente quando `notifications` for negada. */
  writeFallback: readCompatibilityFlag(
    import.meta.env.VITE_LEGACY_NOTIFICATIONS_WRITE_FALLBACK,
  ),
  /** Resolve também documentos antigos quando um evento é concluído. */
  resolveLegacy: readCompatibilityFlag(
    import.meta.env.VITE_LEGACY_NOTIFICATIONS_RESOLVE,
  ),
});

export type LegacyNotificationCompatibility =
  typeof legacyNotificationCompatibility;
