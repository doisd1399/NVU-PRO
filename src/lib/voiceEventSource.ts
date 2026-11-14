/** Read-only observations from existing subscriptions/ACKs. Never fetches data. */
export const VOICE_OBSERVATION_EVENT = 'nvu:voice-observation-v2';
export type VoiceObservation = {
  kind: 'jobs' | 'partnerships' | 'payments' | 'candidates' | 'offers' | 'trip-ack' | 'trip-failed';
  userId: string; companyId: string; role?: 'admin' | 'driver';
  channel?: string; rows: Record<string, any>[]; at: number;
};
export function emitVoiceObservation(value: Omit<VoiceObservation, 'at'>): void {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(VOICE_OBSERVATION_EVENT,
      { detail: { ...value, at: Date.now() } }));
  } catch { /* Optional audio cannot affect the transaction or subscription. */ }
}
