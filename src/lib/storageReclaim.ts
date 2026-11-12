/**
 * Quando o armazenamento local (≈5 MB no WebView) enche, uma gravação importante — o início/fim de uma operação, a fila de
 * viagens — não pode falhar por causa de caches que o app refaz sozinho. `setItemReclaiming` tenta gravar; se o aparelho
 * recusar por falta de espaço, apaga cache refazível (os maiores primeiro, só o necessário) e tenta de novo.
 *
 * Só entram aqui caches de leitura. Nada que exista apenas no aparelho (fila de viagens, início/fim pendente, capa ou foto
 * ainda não enviada) é apagado: registros marcados como pendentes são sempre preservados.
 */
export type ReclaimStorage = Pick<Storage, "getItem" | "setItem"> & Partial<Pick<Storage, "removeItem" | "key" | "length">>;

/** Prefixos de chaves que são apenas cache e podem ser baixados/calculados de novo. */
export const REBUILDABLE_PREFIXES = [
  "nvu.instant.v1.", "nvu.persisted.v2.driver-trips.", "nvu.persisted.v2.active-operation.", "nvu.trips.v2:",
  "nvu.session.page.v1:", "nvu.ranking.snapshot.v4.", "nvu-ranking-image:v1:", "nvu-ranking-premium-v1:",
  "nvu:pro-cities:v1:", "nvu-vehicle-photo-poster:", "nvu-management-v1:", "nvu-senior-monthly-v1:", "nvu-senior-catalog-v1:",
  "nvu.public.simulators.", "nvu.public.companies.",
] as const;

export function isQuotaError(error: unknown): boolean {
  const e = error as { name?: string; code?: number; message?: string } | null;
  return Boolean(e) && (e!.name === "QuotaExceededError" || e!.name === "NS_ERROR_DOM_QUOTA_REACHED" || e!.code === 22 || e!.code === 1014 ||
    /quota/i.test(String(e!.message || "")));
}

function pending(raw: string): boolean {
  try {
    const value = JSON.parse(raw);
    return value?.status === "pending" || value?.pending === true || value?.value?.pending === true || value?.value?.status === "pending";
  } catch { return false; }
}

/** Chaves de cache que podem ser apagadas agora, da maior para a menor. */
export function reclaimableKeys(storage: ReclaimStorage): { key: string; size: number }[] {
  if (typeof storage.key !== "function" || typeof storage.length !== "number" || typeof storage.removeItem !== "function") return [];
  const found: { key: string; size: number }[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !REBUILDABLE_PREFIXES.some(prefix => key.startsWith(prefix))) continue;
    const raw = storage.getItem(key) || "";
    if (pending(raw)) continue;
    found.push({ key, size: raw.length });
  }
  return found.sort((a, b) => b.size - a.size);
}

/** Grava; se faltar espaço, libera cache refazível (o maior primeiro) até caber. Repassa o erro original se nada resolver. */
export function setItemReclaiming(storage: ReclaimStorage, key: string, value: string, maxRemovals = 60): { reclaimed: number } {
  try { storage.setItem(key, value); return { reclaimed: 0 }; }
  catch (first) {
    if (!isQuotaError(first)) throw first;
    let reclaimed = 0;
    for (const candidate of reclaimableKeys(storage).slice(0, maxRemovals)) {
      if (candidate.key === key) continue;
      try { storage.removeItem!(candidate.key); reclaimed += 1; } catch { continue; }
      try { storage.setItem(key, value); return { reclaimed }; } catch (error) { if (!isQuotaError(error)) throw error; }
    }
    throw first;
  }
}
