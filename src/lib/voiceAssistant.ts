import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { VoiceAssistantController, type VoicePlay, type VoiceSettings, type VoiceTransport } from './voiceAssistantCore';
import type { VoiceCueId } from './voiceCatalog';

interface NativeVoice {
  configure(options: VoiceSettings & { userId: string }): Promise<{ busy: boolean }>;
  play(options: { cue: string; token: string; priority: number; expiresAt: number }): Promise<{ played: boolean; failed?: boolean }>;
  stop(options: { token?: string }): Promise<void>;
  addListener(name: 'state', listener: (state: { busy: boolean; token?: string; stage?: string }) => void): Promise<PluginListenerHandle>;
}
const Native = registerPlugin<NativeVoice>('NvuVoice');
const native = () => Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('NvuVoice');

class AssistantTransport implements VoiceTransport {
  private player: HTMLAudioElement | null = null;
  private finish: ((result: 'played' | 'blocked' | 'failed' | 'skipped') => void) | null = null;
  private token = '';
  private nativeStarted: (() => void) | null = null;
  private configured = Promise.resolve();
  private listening = false;
  configure(settings: VoiceSettings, userId: string) {
    if (this.player) this.player.volume = settings.volume;
    if (!native()) return;
    if (!this.listening) {
      this.listening = true;
      void Native.addListener('state', state => {
        voiceAssistant.setExternalBusy(state.busy);
        if (state.token === this.token && state.stage === 'started') this.nativeStarted?.();
      }).catch(() => { this.listening = false; });
    }
    this.configured = this.configured.then(async () => {
      const state = await Native.configure({ ...settings, userId });
      voiceAssistant.setExternalBusy(state.busy);
    }).catch(() => undefined);
  }
  play(request: VoicePlay): ReturnType<VoiceTransport['play']> {
    this.token = request.token;
    if (native()) {
      this.nativeStarted = request.onStart;
      return this.configured.then(() => this.token !== request.token || Date.now() >= request.expiresAt ? { played: false, failed: false } : Native.play({ cue: request.cue, token: request.token,
        priority: request.priority, expiresAt: request.expiresAt })).then(result =>
        result.played ? 'played' : result.failed ? 'failed' : 'skipped').catch(() => 'failed');
    }
    if (typeof Audio === 'undefined') return Promise.resolve('failed');
    const player = new Audio(`${import.meta.env.BASE_URL}audio/nvu/${request.voice}/${request.cue}.mp3`);
    this.player = player;
    player.volume = request.volume;
    player.preload = 'auto';
    return new Promise(resolve => {
      let finished = false;
      const timer = setTimeout(() => done('failed'), 15_000);
      const done = (result: 'played' | 'blocked' | 'failed' | 'skipped') => {
        if (finished) return; finished = true; clearTimeout(timer);
        player.onended = player.onerror = null;
        player.pause(); player.removeAttribute('src'); player.load();
        if (this.player === player) { this.player = null; this.finish = null; }
        resolve(result);
      };
      this.finish = done;
      player.onended = () => done('played');
      player.onerror = () => done('failed');
      // Call play synchronously when invoked by a trusted user gesture.
      void player.play().then(() => { if (!finished) request.onStart(); }).catch(error =>
        done(error?.name === 'NotAllowedError' ? 'blocked' : 'failed'));
    });
  }
  stop() {
    if (native() && this.token) void Native.stop({ token: this.token }).catch(() => undefined);
    this.nativeStarted = null; this.token = '';
    this.finish?.('skipped');
  }
}

export const voiceAssistant = new VoiceAssistantController({ transport: new AssistantTransport(),
  storage: () => { try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; } } });

export const VOICE_CUE_EVENT = 'nvu:voice-cue';
export type ConfirmedVoiceEvent = { cue: VoiceCueId; eventId: string; userId: string; companyId: string; at: number };
/** Observational only: never throw into registration or operational commands. */
export function emitVoiceCue(event: Omit<ConfirmedVoiceEvent, 'at'>) {
  try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(VOICE_CUE_EVENT, { detail: { ...event, at: Date.now() } })); } catch { /* silent audio failure */ }
}

export function voiceCueForRoute(pathname: string, state: unknown): VoiceCueId | undefined {
  const value = state as { activeTab?: string; activeFleetTab?: string; fleetTab?: string } | null;
  const tab = value?.activeTab === 'fleet' ? value.activeFleetTab || value.fleetTab || 'vehicles' : value?.activeTab;
  if (pathname === '/admin/assign') return 'page_assign';
  if (pathname.startsWith('/admin/parcerias')) return 'page_partnerships';
  if (pathname.startsWith('/admin/recompensas') || pathname.startsWith('/driver/recompensas')) return 'page_wallet';
  if (pathname === '/admin/trabalhos-ativos') return 'page_active_jobs';
  if (pathname.endsWith('/history')) return 'page_trips';
  if (pathname === '/admin/fleet') return ({ contracts: 'page_operations', drivers: 'page_team', hr: 'page_recruitment',
    fleet: 'page_fleet', vehicles: 'page_fleet', trailers: 'page_fleet', history: 'page_trips' } as Record<string, VoiceCueId>)[tab || ''];
  return undefined;
}
