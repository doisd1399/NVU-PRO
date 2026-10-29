import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Firestore Emulator required');
const projectId = 'demo-nvu-v36-4-staging';
const environment = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
try {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users', 'driver-1'), { role: 'driver', companyId: 'company-1' });
    await setDoc(doc(db, 'users', 'manager-1'), { role: 'admin', companyId: 'company-1' });
    await setDoc(doc(db, 'frotas', 'company-1'), { userId: 'manager-1', ownerId: 'manager-1', companyId: 'company-1' });
    await setDoc(doc(db, 'trabalhos', 'job-1'), { driverId: 'driver-1', companyId: 'company-1', contractId: 'contract-1', status: 'active', totalDeliveries: 1, progress: 0 });
    await setDoc(doc(db, 'contratos', 'contract-1'), { companyId: 'company-1', status: 'active' });
    await setDoc(doc(db, 'historico_viagens', 'server-trip-1'), { driverId: 'driver-1', motoristaId: 'driver-1', criadoPor: 'driver-1', companyId: 'company-1', empresaId: 'company-1', contractId: 'contract-1', jobId: 'job-1', status: 'concluida', operationSlot: 1, operationSlotKey: 'server-trip-1', serverValidatedAt: new Date(), deleted: false });
  });
  const anonymous = environment.unauthenticatedContext().firestore();
  const driver = environment.authenticatedContext('driver-1').firestore();
  const manager = environment.authenticatedContext('manager-1').firestore();
  const denyCreate = { driverId: 'driver-1', motoristaId: 'driver-1', criadoPor: 'driver-1', companyId: 'company-1', empresaId: 'company-1', contractId: 'contract-1', jobId: 'job-1', status: 'concluida', operationSlot: 1, operationSlotKey: 'client-trip', serverValidatedAt: new Date() };
  await assertFails(setDoc(doc(anonymous, 'historico_viagens', 'anonymous-trip'), denyCreate));
  await assertFails(setDoc(doc(driver, 'historico_viagens', 'driver-trip'), denyCreate));
  await assertFails(setDoc(doc(driver, 'trip_operation_slots', 'client-slot'), { driverId: 'driver-1', jobId: 'job-1', operationSlot: 1, tripId: 'client-slot', createdAt: new Date() }));
  await assertFails(setDoc(doc(driver, 'trip_request_locks', 'client-lock'), { driverId: 'driver-1', jobId: 'job-1', idempotencyKey: 'client-key', tripId: 'client-trip', createdAt: new Date() }));
  await assertFails(updateDoc(doc(driver, 'trabalhos', 'job-1'), { progress: 1 }));
  await assertFails(updateDoc(doc(driver, 'trabalhos', 'job-1'), { canonicalProgress: 1 }));
  await assertFails(updateDoc(doc(driver, 'trabalhos', 'job-1'), { operationReconciliationVersion: 99 }));
  await assertFails(updateDoc(doc(driver, 'trabalhos', 'job-1'), { operationProjectionSource: 'client' }));
  await assertFails(updateDoc(doc(driver, 'trabalhos', 'job-1'), { status: 'completed' }));
  await assertSucceeds(updateDoc(doc(manager, 'frotas', 'company-1'), { displayName: 'Manager update' }));
  await assertFails(updateDoc(doc(manager, 'trabalhos', 'job-1'), { progress: 1 }));
  assert.equal((await assertSucceeds(getDoc(doc(driver, 'historico_viagens', 'server-trip-1')))).exists(), true);
  for (const field of ['driverId', 'motoristaId', 'userId', 'criadoPor']) {
    await assertSucceeds(getDocs(query(collection(driver, 'historico_viagens'), where(field, '==', 'driver-1'))));
    await assertFails(getDocs(query(collection(driver, 'historico_viagens'), where(field, '==', 'foreign-driver'))));
    await assertFails(getDocs(query(collection(anonymous, 'historico_viagens'), where(field, '==', 'driver-1'))));
  }
  console.log('RULES DRIVER HISTORY ALIASES PASS: four owner queries allowed; foreign and anonymous queries denied');
  await assertFails(getDoc(doc(anonymous, 'historico_viagens', 'server-trip-1')));
  console.log('RULES SECURITY MATRIX PASS: unauthenticated/driver direct writes denied; manager administrative write allowed; server-owned fields denied');
} finally { await environment.cleanup(); }
