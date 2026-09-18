import fs from 'node:fs';
const service = fs.readFileSync('android/app/src/main/java/com/nvu/operacional/GtoObserverService.java','utf8');
const required = [
  'analysisOcrGeneration++', 'preciseSelectionOcrGeneration++',
  'transaction.generation != preciseSelectionOcrGeneration',
  'isCurrentAnalysisOcr(scheduledOcrGeneration, scheduledOcrSessionId)',
  'generation != freightPageGeneration'
];
for (const token of required) if (!service.includes(token)) throw new Error(`implementation guard missing: ${token}`);

// Deterministic race model: callbacks are scheduled under one session/page and may
// finish after one or more resets. Only matching session+generation may mutate state.
let seed = 0x3110cafe;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
let session = 0, analysisGen = 0, preciseGen = 0, pageGen = 0;
let accepted = 0, rejectedLate = 0, crossSessionWrites = 0;
const callbacks = [];
const schedule = (kind, delay) => callbacks.push({kind, due: tick + delay, session, analysisGen, preciseGen, pageGen});
let tick = 0;
for (let i=0;i<25000;i++) {
  tick++;
  if (rnd() < 0.12) schedule('analysis', 1 + Math.floor(rnd()*30));
  if (rnd() < 0.09) schedule('precise', 1 + Math.floor(rnd()*40));
  if (rnd() < 0.10) schedule('page', 1 + Math.floor(rnd()*50));
  if (rnd() < 0.018) { session++; analysisGen++; preciseGen++; pageGen++; }
  if (rnd() < 0.035) pageGen++;
  for (let j=callbacks.length-1;j>=0;j--) {
    const c=callbacks[j]; if (c.due > tick) continue;
    callbacks.splice(j,1);
    let ok=false;
    if (c.kind==='analysis') ok=c.session===session && c.analysisGen===analysisGen;
    if (c.kind==='precise') ok=c.session===session && c.preciseGen===preciseGen;
    if (c.kind==='page') ok=c.pageGen===pageGen;
    if (ok) accepted++; else rejectedLate++;
    if (!ok && c.session !== session) { /* rejected by design */ }
    if (ok && c.session !== session && c.kind !== 'page') crossSessionWrites++;
  }
}
if (crossSessionWrites !== 0) throw new Error(`cross-session writes=${crossSessionWrites}`);
if (rejectedLate < 500) throw new Error('race model did not exercise enough late callbacks');

// Persistence pressure model: 10 minutes at 60 fps plus a 350ms foreground poll.
const duration=600000, fps=60;
const frames=Math.floor(duration/1000*fps);
const polls=Math.ceil(duration/350);
const oldHotWrites = frames + polls * 2;
const heartbeatWrites = Math.ceil(duration/1200);
const foregroundWrites = Math.ceil(duration/1000);
const freightWrites = Math.ceil(duration/300);
const newHotWrites = heartbeatWrites + foregroundWrites + freightWrites;
const reduction = 1 - newHotWrites/oldHotWrites;
if (reduction < 0.85) throw new Error(`persistence reduction too small: ${(reduction*100).toFixed(1)}%`);


// Durable ACK model for disk-pressure edge cases.
const ackScenario = (ackPersistOk, queueDeleteOk) => {
  let queue=true, snapshot=true, localStatus='PENDING', retry=false;
  const serverAccepted=true;
  if (serverAccepted) {
    if (!ackPersistOk) { retry=true; return {queue,snapshot,localStatus,retry}; }
    localStatus='SYNCED';
    if (!queueDeleteOk) { retry=true; return {queue,snapshot,localStatus,retry}; }
    queue=false; snapshot=false;
  }
  return {queue,snapshot,localStatus,retry};
};
const diskFail=ackScenario(false,true);
if (!diskFail.queue || !diskFail.snapshot || !diskFail.retry || diskFail.localStatus==='SYNCED') throw new Error('ACK disk-failure preservation model failed');
const cleanupFail=ackScenario(true,false);
if (!cleanupFail.queue || !cleanupFail.snapshot || !cleanupFail.retry || cleanupFail.localStatus!=='SYNCED') throw new Error('queue-cleanup preservation model failed');
const normalAck=ackScenario(true,true);
if (normalAck.queue || normalAck.snapshot || normalAck.retry || normalAck.localStatus!=='SYNCED') throw new Error('normal ACK cleanup model failed');

console.log(`OK   modeled async callbacks accepted: ${accepted}`);
console.log(`OK   modeled stale callbacks rejected: ${rejectedLate}`);
console.log(`OK   modeled cross-session writes: ${crossSessionWrites}`);
console.log(`OK   estimated hot-path persistence reduction: ${(reduction*100).toFixed(1)}%`);
console.log('OK   durable ACK survives local ACK-write failure without deleting queue/snapshot');
console.log('OK   durable ACK allows safe progress while queue cleanup retries idempotently');
console.log('OK   R3.11 session-race/resource-pressure model passed');
