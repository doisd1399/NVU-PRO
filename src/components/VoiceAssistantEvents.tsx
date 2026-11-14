import { useEffect, useRef } from 'react';
import { useSessionStore, useOperationalStore } from '../context/AppContext';
import { useCompanyStore } from '../context/CompanyContext';
import { useNotificationStore } from '../context/NotificationsContext';
import { voiceAssistant } from '../lib/voiceAssistant';
import { VoiceEventObserver } from '../lib/voiceEventPolicy';
import { VOICE_OBSERVATION_EVENT, type VoiceObservation } from '../lib/voiceEventSource';
import { SyncManager } from '../services/syncManager';

/** Shares loaded sources; this component never opens a Firebase subscription. */
export function VoiceAssistantEvents() {
  const { currentUser, activeRole } = useSessionStore();
  const { activeCompanyId, companies } = useCompanyStore();
  const { jobs } = useOperationalStore();
  const { notifications, notificationsHydrated } = useNotificationStore();
  const uid = currentUser?.id || '', companyId = activeCompanyId || '';
  const simulatorId = String(companies.find(c => c.id === companyId)?.simulatorId || '');
  const scopeRef = useRef({ jobs, notifications, notificationsHydrated });
  scopeRef.current = { jobs, notifications, notificationsHydrated };
  const observer = useRef<VoiceEventObserver | null>(null);
  const notified = useRef(new Set<string>());
  const baseline = useRef(false);
  useEffect(() => {
    notified.current.clear(); baseline.current = false;
    if (!uid || !companyId || !activeRole) { observer.current = null; return; }
    const scope = { userId: uid, companyId, role: activeRole, simulatorId };
    const current = new VoiceEventObserver(scope, e => {
      // Quiet mode keeps the essential trip confirmation while complete mode rotates its variants.
      const cue = voiceAssistant.getSnapshot().settings.mode === 'quiet' && ['event_trip_saved_b', 'event_trip_saved_c'].includes(e.cue)
        ? 'event_trip_saved' : e.cue;
      voiceAssistant.event(cue, e.eventId, scope);
    }, Date.now, voiceAssistant.getSessionId());
    observer.current = current;
    const pendingIds = () => {
      try { return [...new Set(scopeRef.current.jobs.filter(j => j.companyId === companyId && j.driverId === uid)
        .flatMap(j => SyncManager.getPendingRegistrationIds(j.id)))]; } catch { return null; }
    };
    const connection = () => {
      const pending = pendingIds();
      if (activeRole === 'driver' && pending) current.connection(navigator.onLine !== false, pending,
        scopeRef.current.jobs.some(j => j.companyId === companyId && j.driverId === uid && ['active', 'delayed', 'awaiting_completion'].includes(j.status)));
    };
    const observation = (event: Event) => { const detail = (event as CustomEvent<VoiceObservation>).detail; if (detail?.rows) { current.observe(detail); if (detail.kind === 'trip-ack' && navigator.onLine !== false) { const pending = pendingIds(); if (pending) current.synced(1, pending.length, pending); } } };
    const sync = (event: Event) => {
      const data = (event as CustomEvent).detail, pending = pendingIds();
      if (activeRole === 'driver' && pending && data) current.synced(Number(data.synced || 0), Number(data.remaining || 0), pending);
    };
    window.addEventListener(VOICE_OBSERVATION_EVENT, observation);
    window.addEventListener('offline', connection); window.addEventListener('online', connection);
    window.addEventListener('nvu-canonical-trip-queued', connection); window.addEventListener('nvu-offline-trip-queued', connection);
    window.addEventListener('nvu-offline-sync-finish', sync);
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') current.tick(); }, 1000);
    connection();
    return () => {
      observer.current = null; clearInterval(timer);
      window.removeEventListener(VOICE_OBSERVATION_EVENT, observation);
      window.removeEventListener('offline', connection); window.removeEventListener('online', connection);
      window.removeEventListener('nvu-canonical-trip-queued', connection); window.removeEventListener('nvu-offline-trip-queued', connection);
      window.removeEventListener('nvu-offline-sync-finish', sync);
    };
  }, [uid, companyId, activeRole, simulatorId]);
  useEffect(() => {
    if (!notificationsHydrated || !observer.current) return;
    if (!baseline.current) { notifications.forEach(n => notified.current.add(n.id)); baseline.current = true; return; }
    for (const row of notifications) if (!notified.current.has(row.id)) { notified.current.add(row.id); observer.current.notification(row); }
  }, [notifications, notificationsHydrated, uid, companyId, activeRole, simulatorId]);
  return null;
}
