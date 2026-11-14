import { GREETING_IDS, VOICE_CATALOG, type VoiceCueId } from './voiceCatalog';

export type AssistantVoice = 'male' | 'female';
export type AssistantRole = 'driver' | 'admin';
export type VoiceSettings = { enabled: boolean; voice: AssistantVoice; volume: number; mode: 'complete' | 'quiet' };
export type VoiceScope = { userId: string; role: AssistantRole; companyId: string; simulatorId: string; route: string };
export type VoicePlay = { cue: VoiceCueId; voice: AssistantVoice; volume: number; token: string; expiresAt: number; priority: number; onStart: () => void };
export interface VoiceTransport {
  play(request: VoicePlay): Promise<'played' | 'blocked' | 'failed' | 'skipped'>;
  stop(): void;
  configure?(settings: VoiceSettings, userId: string): void;
}
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
type Timer = ReturnType<typeof setTimeout> | number;
type Session = { lastActivity: number; lastFinished: number; lastNavigation: number; navigationTimes: number[]; greeted: string[]; pages: string[]; events: string[] };
type Intent = { cue: VoiceCueId; key: string; scope: string; route?: string; expiresAt: number; priority: number; preview?: boolean };
export type VoiceSnapshot = { settings: VoiceSettings; busy: boolean; waiting: boolean; needsInteraction: boolean; failed: boolean };
export const VOICE_DEFAULTS: VoiceSettings = { enabled: true, voice: 'male', volume: 0.75, mode: 'complete' };
const SESSION_MS = 30 * 60_000;
const GAP_MS = 8_000;
const keyFor = (uid: string, suffix: string) => `nvu.voice.v1.${encodeURIComponent(uid)}.${suffix}`;
const strings = (v: unknown, max = 200): string[] => Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(-max) : [];
export function normalizeVoiceSettings(value: Partial<VoiceSettings> = {}): VoiceSettings {
  return { enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    voice: value.voice === 'female' ? 'female' : 'male',
    volume: Number.isFinite(value.volume) ? Math.max(0, Math.min(1, Number(value.volume))) : 0.75,
    mode: value.mode === 'quiet' ? 'quiet' : 'complete' };
}

/** Single channel. UI, page changes and confirmed events never own their own players. */
export class VoiceAssistantController {
  private context: VoiceScope | null = null;
  private settings = { ...VOICE_DEFAULTS };
  private session: Session;
  private pending: Intent | null = null;
  private active: { token: string; intent: Intent; started: boolean } | null = null;
  private deferredGreeting: Intent | null = null;
  private routeTimer: Timer | null = null;
  private pumpTimer: Timer | null = null;
  private suspended = false;
  private externalBusy = false;
  private pageCue: VoiceCueId | undefined;
  private automaticAllowed = true;
  private serial = 0;
  private listeners = new Set<() => void>();
  private snapshot: VoiceSnapshot = { settings: this.settings, busy: false, waiting: false, needsInteraction: false, failed: false };
  constructor(private readonly options: {
    transport: VoiceTransport; storage: () => StoragePort | null; now?: () => number; random?: () => number;
    setTimer?: (fn: () => void, ms: number) => Timer; clearTimer?: (id: Timer) => void;
  }) { this.session = this.newSession(); }
  private now = () => this.options.now?.() ?? Date.now();
  private later = (fn: () => void, ms: number) => (this.options.setTimer ?? setTimeout)(fn, Math.max(0, ms));
  private cancel = (id: Timer | null) => { if (id !== null) (this.options.clearTimer ?? clearTimeout)(id); };
  private newSession(): Session { return { lastActivity: this.now(), lastFinished: 0, lastNavigation: 0, navigationTimes: [], greeted: [], pages: [], events: [] }; }
  private read(key: string): any { try { return JSON.parse(this.options.storage()?.getItem(key) || 'null'); } catch { return null; } }
  private write(key: string, value: unknown) { try { this.options.storage()?.setItem(key, JSON.stringify(value)); } catch { /* Voice cannot block the app when storage is unavailable. */ } }
  private persist() { if (this.context) this.write(keyFor(this.context.userId, 'session'), this.session); }
  private scope() { const c = this.context; return c ? JSON.stringify([c.userId, c.role, c.companyId, c.simulatorId]) : ''; }
  private publish(extra: Partial<VoiceSnapshot> = {}) {
    this.snapshot = { ...this.snapshot, settings: this.settings, busy: Boolean(this.active) || this.externalBusy, waiting: Boolean(this.pending), ...extra };
    this.listeners.forEach(fn => fn());
  }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snapshot;
  setContext(context: VoiceScope | null, page?: VoiceCueId, automaticAllowed = true) {
    this.cancel(this.routeTimer); this.routeTimer = null;
    const hadContext = Boolean(this.context);
    const changedAccount = context?.userId !== this.context?.userId;
    if (changedAccount || !context) this.stop();
    this.context = context; this.pageCue = page; this.automaticAllowed = automaticAllowed;
    if (!context) { if (hadContext) this.options.transport.configure?.({ ...this.settings, enabled: false }, ''); this.publish(); return; }
    if (changedAccount) {
      this.settings = normalizeVoiceSettings(this.read(keyFor(context.userId, 'settings')) || {});
      const saved = this.read(keyFor(context.userId, 'session'));
      this.session = saved && this.now() - Number(saved.lastActivity) < SESSION_MS && this.now() >= Number(saved.lastActivity)
        ? { lastActivity: Number(saved.lastActivity), lastFinished: Number(saved.lastFinished) || 0,
            lastNavigation: Number(saved.lastNavigation) || 0, navigationTimes: Array.isArray(saved.navigationTimes) ? saved.navigationTimes.filter((x: unknown) => typeof x === 'number').slice(-3) : [],
            greeted: strings(saved.greeted, 2), pages: strings(saved.pages), events: strings(saved.events) }
        : this.newSession();
    }
    this.touch();
    if (this.active && !this.active.started && !this.valid(this.active.intent)) this.stop();
    if (this.pending && !this.valid(this.pending)) this.pending = null;
    this.options.transport.configure?.(this.settings, context.userId);
    this.publish();
    if (this.suspended || !this.settings.enabled || !this.automaticAllowed) return;
    this.routeTimer = this.later(() => {
      this.routeTimer = null;
      if (this.context !== context || this.suspended) return;
      if (!this.session.greeted.includes(context.role)) {
        this.request(this.greeting(context.role), `greeting:${context.role}`, 1, 15_000);
      } else if (page) {
        this.request(page, `page:${this.scope()}:${page}`, 0, 4_000, context.route);
      }
    }, 900);
  }
  touch() {
    if (this.now() - this.session.lastActivity >= SESSION_MS || this.now() < this.session.lastActivity) this.session = this.newSession();
    if (this.now() - this.session.lastActivity > 10_000) { this.session.lastActivity = this.now(); this.persist(); }
  }
  private greeting(role: AssistantRole): VoiceCueId {
    const key = keyFor(this.context!.userId, `bag.${role}`);
    const saved = this.read(key) || {};
    const allowed = GREETING_IDS[role] as readonly string[];
    let bag = strings(saved.remaining, 5).filter(id => allowed.includes(id));
    if (!bag.length) {
      bag = [...allowed];
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor((this.options.random?.() ?? Math.random()) * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      if (bag[0] === saved.last) [bag[0], bag[1]] = [bag[1], bag[0]];
    }
    // Consume only after actual playback starts (autoplay blocking does not consume a greeting).
    this.write(key, { remaining: bag, last: saved.last || '' });
    return bag[0] as VoiceCueId;
  }
  updateSettings(change: Partial<VoiceSettings>) {
    this.settings = normalizeVoiceSettings({ ...this.settings, ...change });
    if (this.context) this.write(keyFor(this.context.userId, 'settings'), this.settings);
    this.options.transport.configure?.(this.settings, this.context?.userId || '');
    if (!this.settings.enabled) this.stop();
    this.publish();
  }
  setExternalBusy(value: boolean) { this.externalBusy = value; this.publish(); if (!value) this.pump(); }
  suspend(value: boolean) {
    const wasSuspended = this.suspended; this.suspended = value;
    if (value) this.stop();
    else { this.touch(); if (wasSuspended && this.context) this.setContext({ ...this.context }, this.pageCue, this.automaticAllowed); }
  }
  onGesture() {
    this.touch();
    const greeting = this.deferredGreeting;
    this.deferredGreeting = null;
    if (greeting && this.valid(greeting) && !this.session.greeted.includes(this.context!.role)) this.offer(greeting);
  }
  preview(): boolean {
    if (!this.context || !this.settings.enabled || this.active || this.externalBusy || this.pending || this.suspended) return false;
    this.cancel(this.routeTimer); this.routeTimer = null;
    this.start({ cue: this.context.role === 'admin' ? 'admin_greeting_1' : 'driver_greeting_1', key: 'preview',
      scope: this.scope(), expiresAt: this.now() + 20_000, priority: 3, preview: true });
    return true;
  }
  event(cue: VoiceCueId, eventId: string, scope: Pick<VoiceScope, 'userId' | 'companyId'>): boolean {
    if (!this.context || this.context.userId !== scope.userId || this.context.companyId !== scope.companyId || this.context.role !== 'driver' || !eventId) return false;
    if (VOICE_CATALOG[cue]?.kind !== 'event') return false;
    return this.request(cue, `event:${cue}:${eventId}`, cue === 'event_trip_failed' ? 4 : cue === 'event_new_job' ? 2 : 3, 20_000);
  }
  private request(cue: VoiceCueId, key: string, priority: number, ttl: number, route?: string) {
    if (!this.context || !this.settings.enabled || this.suspended || !this.automaticAllowed || !VOICE_CATALOG[cue]) return false;
    const kind = VOICE_CATALOG[cue].kind;
    if (kind === 'event' && this.session.events.includes(key)) return false;
    if (kind === 'navigation') {
      const times = this.session.navigationTimes.filter(t => this.now() - t < 600_000);
      if (this.settings.mode === 'quiet' || this.session.pages.includes(key) || this.active || this.externalBusy || this.pending
          || (this.session.lastNavigation > 0 && this.now() - this.session.lastNavigation < 60_000) || times.length >= 3) return false;
    }
    return this.offer({ cue, key, priority, route, scope: this.scope(), expiresAt: this.now() + ttl });
  }
  private valid(intent: Intent) { return Boolean(this.context && !this.suspended && this.settings.enabled && (this.automaticAllowed || intent.preview) && intent.scope === this.scope()
    && (!intent.route || intent.route === this.context.route) && this.now() < intent.expiresAt); }
  private offer(intent: Intent): boolean {
    if (!this.valid(intent) || this.pending?.key === intent.key || this.active?.intent.key === intent.key) return false;
    const blocked = Boolean(this.active) || this.externalBusy || (this.session.lastFinished > 0 && this.now() - this.session.lastFinished < GAP_MS);
    if (blocked || this.pending) {
      if (VOICE_CATALOG[intent.cue].kind === 'navigation' || (this.active && VOICE_CATALOG[intent.cue].kind === 'greeting')) return false;
      if (!this.pending || intent.priority >= this.pending.priority) this.pending = intent;
      this.publish(); this.pump(); return true;
    }
    this.start(intent); return true;
  }
  private markStarted(intent: Intent) {
    if (!this.context || intent.preview) return;
    const kind = VOICE_CATALOG[intent.cue].kind;
    if (kind === 'greeting') {
      this.session.greeted = [...new Set([...this.session.greeted, this.context.role])];
      const key = keyFor(this.context.userId, `bag.${this.context.role}`), saved = this.read(key) || {};
      this.write(key, { remaining: strings(saved.remaining, 5).filter(id => id !== intent.cue), last: intent.cue });
    } else if (kind === 'navigation') {
      this.session.pages = [...this.session.pages, intent.key].slice(-200);
      this.session.lastNavigation = this.now();
      this.session.navigationTimes = [...this.session.navigationTimes.filter(t => this.now() - t < 600_000), this.now()].slice(-3);
    } else this.session.events = [...this.session.events, intent.key].slice(-200);
    this.session.lastActivity = this.now(); this.persist();
  }
  private start(intent: Intent) {
    if (!this.valid(intent) || this.active) return;
    const token = `nvu-${this.now()}-${++this.serial}`;
    this.active = { token, intent, started: false }; this.publish({ needsInteraction: false, failed: false });
    let playback: ReturnType<VoiceTransport['play']>;
    try {
      playback = this.options.transport.play({ cue: intent.cue, voice: this.settings.voice, volume: this.settings.volume,
        token, expiresAt: intent.expiresAt, priority: intent.priority, onStart: () => {
          if (this.active?.token !== token) return;
          this.active.started = true; this.markStarted(intent);
        } });
    } catch { playback = Promise.resolve('failed'); }
    void playback.then(result => {
      if (this.active?.token !== token) return;
      if (result === 'blocked') {
        if (VOICE_CATALOG[intent.cue].kind === 'greeting') this.deferredGreeting = intent;
        this.publish({ needsInteraction: true });
      } else if (result === 'failed') this.publish({ failed: true });
    }).catch(() => { if (this.active?.token === token) this.publish({ failed: true }); }).finally(() => {
      if (this.active?.token !== token) return;
      if (this.active.started) { this.session.lastFinished = this.now(); this.persist(); }
      this.active = null; this.publish(); this.pump();
    });
  }
  private pump() {
    this.cancel(this.pumpTimer); this.pumpTimer = null;
    if (!this.pending) return;
    if (!this.valid(this.pending)) { this.pending = null; this.publish(); return; }
    if (this.active || this.externalBusy) return;
    const delay = Math.max(0, this.session.lastFinished ? GAP_MS - (this.now() - this.session.lastFinished) : 0);
    if (delay > 0) { this.pumpTimer = this.later(() => this.pump(), Math.min(delay, Math.max(1, this.pending.expiresAt - this.now()))); return; }
    const next = this.pending; this.pending = null; this.publish(); this.start(next);
  }
  stop() {
    this.cancel(this.routeTimer); this.cancel(this.pumpTimer); this.routeTimer = this.pumpTimer = null;
    if (this.active?.started) { this.session.lastFinished = this.now(); this.persist(); }
    this.active = null; this.pending = null; this.deferredGreeting = null; ++this.serial;
    this.options.transport.stop(); this.publish();
  }
}
