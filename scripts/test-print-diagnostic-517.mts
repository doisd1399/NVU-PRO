import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withTripJournalLock } from '../src/services/offline/tripJournalLock.ts';
import { buildPrintDiagnostic, localCommitStep } from '../src/lib/localCommitDiagnostic.ts';

const originalSetTimeout = globalThis.setTimeout, originalClearTimeout = globalThis.clearTimeout;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalIndexedDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
let timers: Map<number, () => void>, nextId: number, open: any, transaction: any, request: any, writes: number;
const checks: string[] = [];
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function reset(locks?: any) {
  timers = new Map(); nextId = 0; writes = 0;
  globalThis.setTimeout = ((callback: () => void) => { timers.set(++nextId, callback); return nextId; }) as any;
  globalThis.clearTimeout = ((id: number) => timers.delete(id)) as any;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open() { open = {}; return open; } } });
}
function startTransaction() {
  open.result = { close() {}, transaction() {
    transaction = { objectStore() { return { get() { request = {}; return request; } }; }, abort() {} };
    return transaction;
  } };
  open.onsuccess();
}
function fire(id: number) { const fn = timers.get(id)!; timers.delete(id); fn(); }
async function test(name: string, work: () => Promise<void>) { await work(); checks.push(name); console.log('PASS', name); }
try {
  await test('Opening cancels the open deadline; completion releases the transaction deadline', async () => {
    reset(); const result = withTripJournalLock(() => ++writes); const openTimer = nextId;
    startTransaction(); assert.equal(timers.has(openTimer), false);
    request.onsuccess(); transaction.oncomplete(); assert.equal(await result, 1); assert.equal(timers.size, 0);
  });
  await test('Transaction timeout after durable work returns success exactly once', async () => {
    reset(); const result = withTripJournalLock(() => ++writes); startTransaction(); request.onsuccess();
    fire(nextId); transaction.onabort(); assert.equal(await result, 1); assert.equal(writes, 1); assert.equal(timers.size, 0);
  });
  await test('Transaction timeout before work prevents a late callback from writing', async () => {
    reset(); const result = withTripJournalLock(() => ++writes); const failed = assert.rejects(result, /UNAVAILABLE/);
    startTransaction(); fire(nextId); await failed; request.onsuccess(); assert.equal(writes, 0); assert.equal(timers.size, 0);
  });
  await test('Open timeout prevents late successful open from entering work', async () => {
    reset(); const result = withTripJournalLock(() => ++writes); const failed = assert.rejects(result, /UNAVAILABLE/);
    fire(nextId); await failed; let transactions = 0;
    open.result = { close() {}, transaction() { transactions++; } }; open.onsuccess(); assert.equal(transactions, 0); assert.equal(writes, 0);
  });
  await test('A domain/write error stays an error and never retries the work', async () => {
    reset(); const domain = new Error('WRITE_FAILED'); const result = withTripJournalLock(() => { writes++; throw domain; });
    const failed = assert.rejects(result, error => error === domain);
    startTransaction(); request.onsuccess(); transaction.onabort(); await failed; assert.equal(writes, 1); assert.equal(timers.size, 0);
  });
  await test('Successful Web Locks releases its timer', async () => {
    reset({ request: async (_name: string, work: () => unknown) => work() });
    assert.equal(await withTripJournalLock(() => ++writes), 1); assert.equal(timers.size, 0);
  });
  await test('Web Locks timeout falls back once and rejects a late primary callback', async () => {
    let late!: () => unknown;
    reset({ request: (_name: string, work: () => unknown) => { late = work; return new Promise(() => {}); } });
    const result = withTripJournalLock(() => ++writes); fire(nextId); await flush();
    startTransaction(); request.onsuccess(); transaction.oncomplete(); assert.equal(await result, 1);
    assert.throws(late, /CANCELLED|UNAVAILABLE/); assert.equal(writes, 1); assert.equal(timers.size, 0);
  });
  await test('Diagnostic retains cause and exact phase, excludes trip content and runtime secrets', async () => {
    const cause = new Error('QuotaExceededError token=secretvalue https://example.com/private user@example.com');
    let failure: any;
    try { localCommitStep('journal-write', () => { throw Object.assign(new Error('OFFLINE_STORAGE_WRITE_FAILED'), { cause }); }); } catch (error) { failure = error; }
    failure.localCommitTripId = 'private-trip';
    const report = buildPrintDiagnostic(failure, 'LOCAL_COMMIT', { nativeVersion: '1.0.517', token: 'hidden-secret' }, {
      getItem: () => JSON.stringify({ schemaVersion: 2, records: { 'private-trip': { secret: 'PRIVATE_RECEIPT' } }, outbox: { 'private-trip': {} } }),
    });
    const parsed = JSON.parse(report); assert.equal(parsed.phase, 'journal-write'); assert.equal(parsed.errors.length, 2);
    assert.equal(parsed.journal.attemptRecordExists, true); assert.equal(parsed.journal.attemptCommandExists, true);
    for (const secret of ['private-trip', 'PRIVATE_RECEIPT', 'hidden-secret', 'secretvalue', 'user@example.com', 'https://example.com/private']) assert(!report.includes(secret), secret);
  });
  await test('Diagnostic is available with broken storage, frozen errors and circular causes', async () => {
    const failure: any = new Error('ORIGINAL'); failure.cause = failure; Object.freeze(failure);
    let tagged: unknown; try { localCommitStep('journal-hydrate', () => { throw failure; }); } catch (error) { tagged = error; }
    const report = JSON.parse(buildPrintDiagnostic(tagged, 'LOCAL_COMMIT', {}, { getItem() { throw new Error('read unavailable'); } }));
    assert.equal(report.phase, 'journal-hydrate'); assert.equal(report.journal.state, 'read-failed'); assert.equal(report.errors.length, 2);
    assert.equal(JSON.parse(buildPrintDiagnostic(null, 'unknown')).journal.state, 'unavailable');
  });
} finally {
  globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout;
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete (globalThis as any).navigator;
  if (originalIndexedDB) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDB);
  else delete (globalThis as any).indexedDB;
}
fs.mkdirSync('reports/release-517', { recursive: true });
fs.writeFileSync('reports/release-517/print-diagnostic-tests.json', JSON.stringify({ checks, count: checks.length, method: 'deterministic fault injection, no Android execution or production access' }, null, 2));
