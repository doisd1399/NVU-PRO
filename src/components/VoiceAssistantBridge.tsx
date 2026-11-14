import { useNotificationStore } from '../context/NotificationsContext';
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useSessionStore, useOperationalStore } from '../context/AppContext';
import { useCompanyStore } from '../context/CompanyContext';
import { onAuthTeardown } from '../lib/authLifecycle';
import { OPERATION_OUTBOX_CHANGED, operationOutbox } from '../services/operationOutbox';
import { voiceAssistant, VOICE_CUE_EVENT, type ConfirmedVoiceEvent } from '../lib/voiceAssistant';
import { isWindowsDesktop } from '../lib/windowsAutomation';

export function VoiceAssistantBridge() {
  const { currentUser, activeRole } = useSessionStore();
  const { jobs, jobsReady } = useOperationalStore();
  const { activeCompanyId, companies, recruitmentApplications } = useCompanyStore();
  const { notifications, notificationsHydrated } = useNotificationStore();
  const location = useLocation();
  const uid = currentUser?.id || '';
  const role = activeRole === 'admin' ? 'admin' : 'driver';
  const company = companies.find(row => row.id === activeCompanyId);
  const simulator = String(company?.simulatorId || company?.simulatorName || '');
  const tab = (location.state as { activeTab?: string; profileTab?: string; activeFleetTab?: string; fleetTab?: string } | null)?.activeTab || (location.state as { profileTab?: string } | null)?.profileTab || '';
  const fleetSubtab = (location.state as { activeFleetTab?: string; fleetTab?: string } | null)?.activeFleetTab || (location.state as { fleetTab?: string } | null)?.fleetTab || '';
  // Scopes are already loaded by the provider. No new Firestore subscriptions.
  const scopedJobs = jobs.filter(job => job.companyId === activeCompanyId && (role === 'admin' || job.driverId === uid));
  const running = scopedJobs.some(job => ['active', 'delayed', 'awaiting_completion'].includes(job.status));
  const pending = role === 'driver' && scopedJobs.some(job => job.status === 'pending');
  const news = (recruitmentApplications || []).some(r => r.companyId === activeCompanyId && r.status === 'pending') || notifications.some(n => n.companyId === activeCompanyId && !n.read && !n.lida && ['PARTNERSHIP_OFFER', 'REWARD_PAYROLL_READY', 'PARTNERSHIP_PAYMENT_DUE'].includes(String(n.type || n.tipo || '')));
  const greetingState = role === 'admin' ? (news ? 'news' : running ? 'active' : 'calm') : running ? 'active' : pending ? 'pending' : 'idle';
  const validRoute = location.pathname.startsWith(`/${role}`) || location.pathname === "/ranking";

  useEffect(() => {
    voiceAssistant.setContext(uid ? { userId: uid, role, companyId: activeCompanyId || '',
      simulatorId: simulator, route: `${location.pathname}|${tab}|${fleetSubtab}`, greetingState, greetingReady: jobsReady && (role !== 'admin' || notificationsHydrated) } : null, undefined, validRoute);
  }, [uid, role, activeCompanyId, simulator, validRoute, location.pathname, tab, fleetSubtab, greetingState, jobsReady, notificationsHydrated]);

  useEffect(() => {
    const gesture = () => voiceAssistant.onGesture();
    // The Windows main renderer remains the single audio owner while the game has focus.
    const visibility = () => voiceAssistant.suspend(!isWindowsDesktop() && document.visibilityState === 'hidden');
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
          voiceAssistant.event('event_job_started', String(entry.result.job?.id || entry.jobId), { userId: uid, companyId: activeCompanyId });
        if (entry.kind === 'finish' && entry.result?.completed === true && entry.result?.job?.status === 'completed')
          voiceAssistant.event('event_job_completed', String(entry.result.job?.id || entry.jobId), { userId: uid, companyId: activeCompanyId });
      }
    };
    window.addEventListener(OPERATION_OUTBOX_CHANGED, operation);
    return () => window.removeEventListener(OPERATION_OUTBOX_CHANGED, operation);
  }, [uid, role, activeCompanyId]);
  return null;
}
