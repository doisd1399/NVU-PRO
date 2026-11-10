/** "Visto por último" das Parcerias B2P, por usuário e empresa (só no aparelho): zera o indicador de novidades da Central. */
const key = (uid: string, companyId: string) => `nvu-b2p-seen:${encodeURIComponent(uid)}:${encodeURIComponent(companyId)}`;
export const PARTNERSHIP_SEEN_EVENT = "nvu-b2p-seen";

export function readPartnershipSeen(uid: string, companyId: string): number {
  try { const value = Number(window.localStorage.getItem(key(uid, companyId))); return Number.isFinite(value) ? value : 0; } catch { return 0; }
}
export function markPartnershipsSeen(uid: string, companyId: string, at = Date.now()): void {
  if (!uid || !companyId) return;
  try { window.localStorage.setItem(key(uid, companyId), String(at)); } catch { /* sem armazenamento: o indicador só reaparece */ }
  try { window.dispatchEvent(new Event(PARTNERSHIP_SEEN_EVENT)); } catch { /* ambiente sem eventos */ }
}
