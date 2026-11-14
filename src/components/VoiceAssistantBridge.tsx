import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useSessionStore } from '../context/AppContext';
import { useCompanyStore } from '../context/CompanyContext';
import { onAuthTeardown } from '../lib/authLifecycle';
import { CANONICAL_TRIP_UPDATED } from '../lib/CanonicalTripUpdateEvent';
import type { CanonicalTrip } from '../domain/trip/CanonicalTrip';
import { OPERATION_OUTBOX_CHANGED, operationOutbox } from '../services/operationOutbox';
import { voiceAssistant, voiceCueForRoute, VOICE_CUE_EVENT, type ConfirmedVoiceEvent } from '../lib/voiceAssistant';

export function VoiceAssistantBridge() {
  const { currentUser, activeRole } = useSessionStore();
  const { activeCompanyId, companies } = useCompanyStore();
  const location = useLocation();
  const uid = currentUser?.id || '';
  const role = activeRole === 'admin' ? 'admin' : 'driver';
  const company = companies.find(row => row.id === activeCompanyId);
  const simulator = String(company?.simulatorId || company?.simulatorName || '');
  const tab = (location.state as { activeTab?: string; profileTab?: string; activeFleetTab?: string; fleetTab?: string } | null)?.activeTab || (location.state as { profileTab?: string } | null)?.profileTab || '';
  const fleetSubtab = (location.state as { activeFleetTab?: string; fleetTab?: string } | null)?.activeFleetTab || (location.state as { fleetTab?: string } | null)?.fleetTab || '';
  const validRoute = location.pathname.startsWith(`/${role}`) || location.pathname === "/ranking";

  useEffect(() => {
    voiceAssistant.setContext(uid ? { userId: uid, role, companyId: activeCompanyId || '',
      simulatorId: simulator, route: `${location.pathname}|${tab}|${fleetSubtab}` } : null, voiceCueForRoute(location.pathname, location.state), validRoute);
  }, [uid, role, activeCompanyId, simulator, validRoute, location.pathname, tab, fleetSubtab]);

  useEffect(() => {
    const gesture = () => voiceAssistant.onGesture();
    const visibility = () => voiceAssistant.suspend(document.visibilityState === 'hidden');
    const cue = (raw: Event) => {
      const event = (raw as CustomEvent<ConfirmedVoiceEvent>).detail;
      if (!event || Date.now() - event.at > 20_000 || event.at > Date.now() + 1000) return;
      voiceAssistant.event(event.cue, event.eventId, event);
    };
    window.addEventListener('pointerup', gesture, true);
    window.addEventListener('keyup', gesture, true);
    window.addEventListener(VOICE_CUE_EVENT, cue);
    document.addEventListener('visibilitychange', visibility);
    const teardown = onAuthTeardown(() => voiceAssistant.setContext(null));
    let active = true;
    const listener = Capacitor.isNativePlatform() ? CapacitorApp.addListener('appStateChange', state => {
      if (active) voiceAssistant.suspend(!state.isActive);
    }) : null;
    visibility();
    return () => {
      active = false; void listener?.then(handle => handle.remove()); teardown();
      window.removeEventListener('pointerup', gesture, true); window.removeEventListener('keyup', gesture, true);
      window.removeEventListener(VOICE_CUE_EVENT, cue); document.removeEventListener('visibilitychange', visibility);
      voiceAssistant.stop();
    };
  }, []);

  useEffect(() => {
    if (!uid || !activeCompanyId || role !== 'driver') return;
    // Optional speech must never turn a damaged/offline outbox into a screen failure.
    const entries = () => { try { return operationOutbox.entries(uid); } catch { return []; } };
    const operationStates = new Map(entries().filter(e => e.companyId === activeCompanyId).map(e => [e.id, e.state]));
    const operation = () => {
      for (const entry of entries()) {
        if (entry.actorId !== uid || entry.companyId !== activeCompanyId) continue;
        const before = operationStates.get(entry.id); operationStates.set(entry.id, entry.state);
        if (!before || before === 'CONFIRMED' || entry.state !== 'CONFIRMED') continue;
        if (entry.kind === 'start' && entry.result && ['active', 'delayed', 'awaiting_completion'].includes(entry.result.job?.status))
          voiceAssistant.event('event_job_started', entry.requestId, { userId: uid, companyId: activeCompanyId });
        if (entry.kind === 'finish' && entry.result?.completed === true && entry.result?.job?.status === 'completed')
          voiceAssistant.event('event_job_completed', entry.requestId, { userId: uid, companyId: activeCompanyId });
      }
    };
    const trip = (raw: Event) => {
      const data = (raw as CustomEvent<CanonicalTrip>).detail;
      if (!data || data.deleted || data.driverId !== uid || data.companyId !== activeCompanyId
          || !['SERVER_CONFIRMED', 'HISTORY_CONFIRMED'].includes(data.status)) return;
      const changed = Date.parse(data.serverUpdatedAt || data.updatedAt || '');
      if (!Number.isFinite(changed) || Date.now() - changed > 20_000 || changed > Date.now() + 1000) return;
      voiceAssistant.event('event_trip_saved', data.canonicalTripId, { userId: uid, companyId: activeCompanyId });
    };
    window.addEventListener(OPERATION_OUTBOX_CHANGED, operation); window.addEventListener(CANONICAL_TRIP_UPDATED, trip);
    return () => { window.removeEventListener(OPERATION_OUTBOX_CHANGED, operation); window.removeEventListener(CANONICAL_TRIP_UPDATED, trip); };
  }, [uid, role, activeCompanyId]);
  return null;
}
