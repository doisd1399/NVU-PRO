import fs from 'node:fs';

const dashboard = fs.readFileSync('src/pages/driver/Dashboard.tsx', 'utf8');
const profile = fs.readFileSync('src/pages/driver/Profile.tsx', 'utf8');
const recordTrip = fs.readFileSync('src/pages/driver/RecordTrip.tsx', 'utf8');
const launcher = fs.readFileSync('src/services/gtoWorkLauncher.ts', 'utf8');
const observer = fs.readFileSync('src/lib/gtoObserver.ts', 'utf8');
const setup = fs.readFileSync('src/components/GtoObserverSetup.tsx', 'utf8');
const backend = fs.readFileSync('functions/src/gtoTrips.ts', 'utf8');
const index = fs.readFileSync('functions/src/index.ts', 'utf8');
const firebase = fs.readFileSync('firebase.json', 'utf8');
const appContext = fs.readFileSync('src/context/AppContext.tsx', 'utf8');
const resolver = fs.readFileSync('src/lib/resolveSimulator.ts', 'utf8');
const tripDistance = fs.readFileSync('src/lib/tripDistance.ts', 'utf8');
const simulatorOptions = fs.readFileSync('src/lib/simulatorOptions.ts', 'utf8');

const checks = [];
function check(name, ok) {
  checks.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
}

check('Dashboard changes label only for GTO', dashboard.includes('isGtoWork ? "Iniciar trabalho" : "Lançar Viagem"'));
check('Profile changes label only for GTO', profile.includes('isGtoWork ? "Iniciar trabalho" : "Lançar Viagem"'));
check('non-GTO still navigates to manual form', dashboard.includes('if (!isGtoWork)') && dashboard.includes('navigate("/driver/trip")'));
check('GTO automatic route is guarded while explicit print mode is allowed', recordTrip.includes('if (resolvedSimulatorCode === "GTO" && !isGtoPrintMode)'));
check('GTO launcher sends current operation context', launcher.includes('GtoObserver.setContext(context)') && launcher.includes('GtoObserver.openGto()'));
check('web bridge exposes FIX18 integrity fields', observer.includes('gtoTripIntegrityStatus') && observer.includes('gtoContractVersion'));
check('web bridge keeps precise-touch compatibility method', observer.includes('openPreciseTouchSettings'));
check('GTO card no longer says Firebase sync is disabled', !setup.includes('Ainda não envia viagens ao Firebase'));
check('GTO card surfaces sync status', setup.includes('Sincronização:'));
check('callable is exported', index.includes('export { registerGtoTrip } from "./gtoTrips"'));
check('callable has explicit us-central1 region', backend.includes('functions.region("us-central1").https.onCall'));
check('callable requires authenticated user', backend.includes('requireAuthenticatedUid'));
check('FIX18 contract version is accepted', backend.includes('contractVersion?: unknown') && backend.includes('clientContractVersion'));
check('FIX18 session format is validated', backend.includes('/^[A-Za-z0-9_-]{8,160}$/'));
check('FIX18 client timestamp is validated', backend.includes('safeClientTimestamp') && backend.includes('completedAtClient inválido para o contrato FIX18'));
check('FIX18 fingerprint is generated', backend.includes('gtoPayloadFingerprint') && backend.includes('createHash("sha256")'));
check('duplicate session validates fingerprint', backend.includes('existingFingerprint') && backend.includes('payloadFingerprint'));
check('FIX18 ACK includes success', backend.includes('success: true'));
check('FIX18 ACK includes contractVersion 18', backend.includes('contractVersion: 18'));
check('FIX18 ACK echoes sessionId', backend.includes('sessionId,\n          tripId') || backend.includes('sessionId,\n      tripId'));
check('callable is GTO-only', backend.includes('O lançamento automático é permitido somente para empresas do simulador GTO.'));
check('callable validates active job ownership', backend.includes('O trabalho ativo não pertence ao motorista autenticado.'));
check('callable rejects vehicle drift', backend.includes('O veículo da operação mudou desde o início da viagem GTO.'));
check('callable rejects trailer drift', backend.includes('O reboque da operação mudou desde o início da viagem GTO.'));
check('automatic trip reuses historico_viagens', backend.includes('collection("historico_viagens")'));
check('automatic trip stores final value as canonical valor', backend.includes('valor: finalValue'));
check('automatic trip preserves GTO cargo metadata', backend.includes('carga: cargo') && backend.includes('gtoCargo: cargo'));
check('automatic trip persists FIX18 fingerprint', backend.includes('gtoPayloadFingerprint: payloadFingerprint'));
check('job progress is recalculated after registration', backend.includes('syncJobProgress(db, jobId, totalDeliveries)'));
check('Firebase builds functions before deploy', firebase.includes('npm --prefix functions run build'));


check('R3.1 bridge exposes observer recovery', observer.includes('recoverObserver()'));
check('R3.1 bridge exposes native logout cleanup', observer.includes('logoutCleanup()'));
check('R3.1 bridge exposes health and stage fields', observer.includes('observerHealthy') && observer.includes('driverStageMessage'));
check('R3.1 bridge carries job lifecycle context', observer.includes('jobStatus?: string') && observer.includes('jobProgress?: number') && observer.includes('jobTotalDeliveries?: number'));
check('launcher recovers an enabled observer', launcher.includes('GtoObserver.recoverObserver()'));
check('launcher rejects unhealthy observer startup', launcher.includes('observer-failed') && launcher.includes('observerHealthy === false'));
check('launcher blocks closed/completed jobs', launcher.includes('job-closed') && launcher.includes('gtoBackendJobClosed'));
check('launcher blocks not-yet-active jobs', launcher.includes('job-not-ready') && launcher.includes('["active", "delayed"]'));
check('Dashboard sends job lifecycle context', dashboard.includes('jobStatus: myJob.status') && dashboard.includes('jobTotalDeliveries: contract.totalDeliveries'));
check('Profile sends job lifecycle context', profile.includes('jobStatus: activeJob.status') && profile.includes('jobTotalDeliveries: activeContract.totalDeliveries'));
check('RecordTrip sends job lifecycle context', recordTrip.includes('jobStatus: activeJob.status') && recordTrip.includes('jobTotalDeliveries: activeContract.totalDeliveries'));
check('logout cleans native GTO session before native auth signout', appContext.includes('await GtoObserver.logoutCleanup()') && appContext.indexOf('await GtoObserver.logoutCleanup()') < appContext.indexOf('await FirebaseAuthentication.signOut()'));
check('canonical resolver includes Global Truck alias', resolver.includes('["gto", "global-truck-online", "global-truck"]'));
check('trip simulator code recognizes Global Truck alias', tripDistance.includes('compact === "GLOBALTRUCK"'));
check('simulator labels recognize Global Truck alias', simulatorOptions.includes('globaltruck: "GTO"'));
check('backend recognizes Global Truck alias', backend.includes('normalized === "global-truck"'));
check('GTO page explains automatic completion', recordTrip.includes('Ao chegar ao destino, a NVU identificará a conclusão e registrará a viagem automaticamente.'));

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
if (failed.length) process.exit(1);
