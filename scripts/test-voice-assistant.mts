import assert from 'node:assert/strict';
import test from 'node:test';
import { VoiceAssistantController, normalizeVoiceSettings, type VoicePlay, type VoiceScope, type VoiceTransport } from '../src/lib/voiceAssistantCore';
import { VOICE_CATALOG, GREETING_IDS } from '../src/lib/voiceCatalog';

class Clock {
  now = 1_000_000;
  next = 0;
  timers = new Map<number, { at: number; fn: () => void }>();
  set = (fn: () => void, ms: number) => { const id = ++this.next; this.timers.set(id, { at: this.now + ms, fn }); return id; };
  clear = (id: any) => { this.timers.delete(Number(id)); };
  async tick(ms: number) {
    const target = this.now + ms;
    for (;;) {
      const entry = [...this.timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      this.now = entry[1].at; this.timers.delete(entry[0]); entry[1].fn();
      await flush();
    }
    this.now = target; await flush();
  }
}
const flush = async () => { for (let n = 0; n < 6; n++) await Promise.resolve(); };
class Transport implements VoiceTransport {
  plays: VoicePlay[] = [];
  active: { request: VoicePlay; done: (result: 'played' | 'skipped') => void } | null = null;
  blocked = false; stops = 0; configs: any[] = [];
  play(request: VoicePlay): ReturnType<VoiceTransport['play']> {
    assert.equal(this.active, null, 'another clip cannot start while speech is playing');
    this.plays.push(request);
    if (this.blocked) return Promise.resolve('blocked');
    request.onStart();
    return new Promise(done => { this.active = { request, done }; });
  }
  finish() { const old = this.active; this.active = null; old?.done('played'); }
  stop() { this.stops++; const old = this.active; this.active = null; old?.done('skipped'); }
  configure(settings: any, uid: string) { this.configs.push({ ...settings, uid }); }
}
const scope = (role: 'driver' | 'admin' = 'driver', companyId = 'company-a'): VoiceScope => ({ userId: 'driver-a', role, companyId, simulatorId: 'gto', route: `/${role}` });
function harness() {
  const clock = new Clock(), transport = new Transport(), store = new Map<string, string>();
  const create = () => new VoiceAssistantController({ transport, storage: () => ({ getItem: key => store.get(key) ?? null, setItem: (key, value) => { store.set(key, value); } }),
    now: () => clock.now, random: () => .31, setTimer: clock.set, clearTimer: clock.clear });
  const controller = create();
  const ready = async (role: 'driver' | 'admin' = 'driver') => { controller.setContext(scope(role)); await clock.tick(900); transport.finish(); await flush(); };
  return { clock, transport, store, create, controller, ready };
}

test('opens with one role-specific greeting after a stable 900ms, not on render', async () => {
  const h = harness(); h.controller.setContext(scope('admin')); await h.clock.tick(899); assert.equal(h.transport.plays.length, 0);
  await h.clock.tick(1); assert(h.transport.plays[0].cue.startsWith('admin_greet_'));
  assert.equal(h.controller.getSnapshot().busy, true);
});
test('new v2 catalog is selected by period, role and confirmed work state', async () => {
  for (const [role, state, hour, expected] of [
    ['driver', 'active', 8, 'driver_greet_morning_active'],
    ['driver', 'pending', 16, 'driver_greet_afternoon_job'],
    ['driver', 'idle', 22, 'driver_greet_night_idle'],
    ['admin', 'active', 8, 'admin_greet_morning_active'],
    ['admin', 'news', 16, 'admin_greet_afternoon_news'],
    ['admin', 'calm', 22, 'admin_greet_night_calm'],
  ] as const) {
    const h = harness(); h.clock.now = new Date(2026, 10, 13, hour, 0, 0).getTime();
    h.controller.setContext({ ...scope(role), greetingState: state, greetingReady: true });
    await h.clock.tick(900); assert.equal(h.transport.plays[0].cue, expected);
  }
});
test('pending work snapshot defers greeting until jobs become ready', async () => {
  const h = harness(); h.controller.setContext({ ...scope(), greetingReady: false });
  await h.clock.tick(900); assert.equal(h.transport.plays.length, 0);
  h.controller.setContext({ ...scope(), greetingReady: true, greetingState: 'pending' });
  await h.clock.tick(900); assert.equal(h.transport.plays.length, 1);
});
test('remount and quick return keep the session greeting history', async () => {
  const h = harness(); await h.ready(); const count = h.transport.plays.length;
  h.controller.stop(); const restored = h.create(); restored.setContext(scope()); await h.clock.tick(900);
  assert.equal(h.transport.plays.length, count);
});
test('resuming after 30 minutes starts a new greeting session', async () => {
  const h = harness(); await h.ready(); h.controller.suspend(true); await h.clock.tick(30 * 60_000 + 1);
  h.controller.suspend(false); await h.clock.tick(900); assert.equal(h.transport.plays.length, 2);
});
test('admin and driver greeting pools are independent, never simultaneous', async () => {
  const h = harness(); await h.ready(); await h.clock.tick(8000);
  h.controller.setContext(scope('admin')); await h.clock.tick(900);
  assert(h.transport.plays.at(-1)!.cue.startsWith('admin_greet_')); assert.equal(h.transport.plays.length, 2);
});
test('page navigation no longer produces speech or queues behind a clip', async () => {
  const h = harness(); await h.ready('admin'); await h.clock.tick(61_000);
  h.controller.setContext({ ...scope('admin'), route: '/admin/assign' }, undefined);
  await h.clock.tick(900); assert.equal(h.transport.plays.length, 1);
});
test('a confirmed event waits for completion and the 8-second silence gap', async () => {
  const h = harness(); await h.ready(); await h.clock.tick(8000); h.controller.preview();
  h.controller.event('event_trip_saved', 'trip-a', { userId: 'driver-a', companyId: 'company-a' });
  assert.equal(h.transport.plays.length, 2); h.transport.finish(); await flush(); await h.clock.tick(7999);
  assert.equal(h.transport.plays.length, 2); await h.clock.tick(1); assert.equal(h.transport.plays.at(-1)!.cue, 'event_trip_saved');
});
test('same confirmed event is deduplicated across calls and remount', async () => {
  const h = harness(); await h.ready(); await h.clock.tick(8000);
  const event = () => h.controller.event('event_trip_saved', 'trip-a', { userId: 'driver-a', companyId: 'company-a' });
  assert.equal(event(), true); assert.equal(event(), false); h.transport.finish(); await flush(); await h.clock.tick(8000);
  assert.equal(event(), false); h.controller.stop(); const c = h.create(); c.setContext(scope()); await h.clock.tick(900);
  assert.equal(c.event('event_trip_saved', 'trip-a', { userId: 'driver-a', companyId: 'company-a' }), false);
});
test('only one pending event is kept and higher priority replaces it without interrupting', async () => {
  const h = harness(); await h.ready(); await h.clock.tick(8000); h.controller.preview();
  const current = h.transport.active;
  h.controller.event('event_new_job', 'job-a', scope()); h.controller.event('event_trip_failed', 'trip-a', scope());
  assert.equal(h.transport.active, current); h.transport.finish(); await flush(); await h.clock.tick(8000);
  assert.equal(h.transport.plays.at(-1)!.cue, 'event_trip_failed'); assert.equal(h.transport.plays.length, 3);
});
test('expired pending confirmations are discarded instead of replayed later', async () => {
  const h = harness(); await h.ready(); await h.clock.tick(8000); h.controller.preview();
  h.controller.event('event_trip_saved', 'old-trip', scope()); await h.clock.tick(21_000);
  h.transport.finish(); await flush(); await h.clock.tick(8000); assert.equal(h.transport.plays.length, 2);
});
test('changing company discards stale pending speech and keeps the current clip', async () => {
  const h = harness(); await h.ready(); await h.clock.tick(8000); h.controller.preview(); const current = h.transport.active;
  h.controller.event('event_trip_saved', 'trip-a', scope()); h.controller.setContext(scope('driver', 'company-b'));
  assert.equal(h.transport.active, current); h.transport.finish(); await flush(); await h.clock.tick(10_000);
  assert.equal(h.transport.plays.length, 2);
});
test('voice changes affect the next clip and leave the current voice playing', async () => {
  const h = harness(); await h.ready(); await h.clock.tick(8000); h.controller.preview(); const current = h.transport.active;
  h.controller.updateSettings({ voice: 'female' }); assert.equal(h.transport.active, current); assert.equal(current!.request.voice, 'male');
  h.transport.finish(); await flush(); h.controller.preview(); assert.equal(h.transport.plays.at(-1)!.voice, 'female');
});
test('mute stops playback, clears pending speech and prevents automatic and preview audio', async () => {
  const h = harness(); h.controller.setContext(scope()); await h.clock.tick(900);
  h.controller.event('event_trip_saved', 'trip-a', scope()); h.controller.updateSettings({ enabled: false });
  assert.equal(h.transport.active, null); await h.clock.tick(25_000); assert.equal(h.transport.plays.length, 1);
  assert.equal(h.controller.preview(), false); assert.equal(h.controller.event('event_trip_saved', 'trip-b', scope()), false);
});
test('logout and account switching stop and isolate preferences', async () => {
  const h = harness(); await h.ready(); h.controller.updateSettings({ voice: 'female', volume: .35 });
  h.controller.preview(); h.controller.setContext(null); assert.equal(h.transport.active, null);
  h.controller.setContext({ ...scope(), userId: 'driver-b' }); assert.equal(h.controller.getSnapshot().settings.voice, 'male');
  h.controller.setContext(scope()); assert.equal(h.controller.getSnapshot().settings.voice, 'female'); assert.equal(h.controller.getSnapshot().settings.volume, .35);
});
test('a browser autoplay block consumes no greeting and a gesture can retry it', async () => {
  const h = harness(); h.transport.blocked = true; h.controller.setContext(scope()); await h.clock.tick(900);
  assert.equal(h.controller.getSnapshot().needsInteraction, true); const cue = h.transport.plays[0].cue;
  h.transport.blocked = false; h.controller.onGesture(); await flush(); assert.equal(h.transport.plays[1].cue, cue);
});
test('quiet mode skips optional clips but keeps essential confirmed events', async () => {
  const h = harness(); await h.ready(); h.controller.updateSettings({ mode: 'quiet' }); await h.clock.tick(61_000);
  assert.equal(h.controller.event('event_trip_saved_b', 'trip-a', scope()), false);
  assert.equal(h.transport.plays.length, 1);
  assert.equal(h.controller.event('event_trip_saved', 'trip-a', scope()), true);
  assert.equal(h.transport.plays.length, 2);
});
test('route changes never cause narration in the v2 catalog', async () => {
  const h = harness(); await h.ready('admin'); await h.clock.tick(61_000);
  for (const [i, route] of ['/admin/assign', '/admin/fleet', '/driver/history', '/admin/parcerias'].entries()) {
    h.controller.setContext({ ...scope('admin'), route }, undefined); await h.clock.tick(900);
  }
  assert.equal(h.transport.plays.length, 1);
});
test('an external native clip occupies the same logical voice channel', async () => {
  const h = harness(); await h.ready(); await h.clock.tick(8000); h.controller.setExternalBusy(true);
  assert.equal(h.controller.preview(), false); h.controller.event('event_trip_saved', 'trip-a', scope());
  assert.equal(h.transport.plays.length, 1); h.controller.setExternalBusy(false); assert.equal(h.transport.plays.length, 2);
});
test('another user/company event cannot speak in the current session', async () => {
  const h = harness(); await h.ready(); await h.clock.tick(8000);
  assert.equal(h.controller.event('event_trip_saved', 'trip-a', { userId: 'driver-b', companyId: 'company-a' }), false);
  assert.equal(h.controller.event('event_trip_saved', 'trip-a', { userId: 'driver-a', companyId: 'company-b' }), false);
});
test('unavailable storage does not block startup or the operational interface', async () => {
  const clock = new Clock(), transport = new Transport();
  const c = new VoiceAssistantController({ transport, storage: () => { throw Error('quota'); }, now: () => clock.now, setTimer: clock.set, clearTimer: clock.clear });
  c.setContext(scope()); await clock.tick(900); assert.equal(transport.plays.length, 1); c.updateSettings({ volume: .4 });
});
test('settings validation and the full male/female greeting catalog are explicit', () => {
  assert.deepEqual(normalizeVoiceSettings({ enabled: false, voice: 'unknown' as any, volume: 10, mode: 'bad' as any }), { enabled: false, voice: 'male', volume: 1, mode: 'complete' });
  assert.equal(GREETING_IDS.admin.length, 9); assert.equal(GREETING_IDS.driver.length, 9); assert.equal(Object.keys(VOICE_CATALOG).length, 49);
});
test('public screens stay silent without disabling the persisted Pro voice preference', async () => {
  const h = harness(); h.controller.setContext(null);
  assert.equal(h.transport.configs.length, 0, 'initial unauthenticated render must not overwrite the Pro preference');
  h.controller.setContext({ ...scope(), route: '/help' }, undefined, false); await h.clock.tick(900);
  assert.equal(h.transport.plays.length, 0); assert.equal(h.transport.configs.at(-1).enabled, true);
  assert.equal(h.controller.event('event_trip_saved', 'trip-a', scope()), false);
  assert.equal(h.controller.preview(), true, 'an explicit preview remains possible for a signed-in user');
});
