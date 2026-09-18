import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const javaRoot = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'nvu', 'operacional');
const service = fs.readFileSync(path.join(javaRoot, 'GtoObserverService.java'), 'utf8');
const coordinator = fs.readFileSync(path.join(javaRoot, 'GtoTripSubmissionCoordinator.java'), 'utf8');
const policy = fs.readFileSync(path.join(javaRoot, 'GtoTripSubmissionPolicy.java'), 'utf8');
const sync = fs.readFileSync(path.join(javaRoot, 'GtoAutoTripSync.java'), 'utf8');
const test = path.join(root, 'scripts', 'java-tests', 'com', 'nvu', 'operacional', 'GtoTripSubmissionPolicyTest.java');
const out = fs.mkdtempSync('/tmp/hf177-trip-policy-');

function check(name, condition) {
  if (!condition) throw new Error(`FAIL ${name}`);
  console.log(`PASS ${name}`);
}

const taskRemoved = service.slice(service.indexOf('public void onTaskRemoved'));
const taskRemovedEnd = taskRemoved.indexOf('public void onDestroy');
const taskRemovedBody = taskRemovedEnd >= 0 ? taskRemoved.slice(0, taskRemovedEnd) : taskRemoved;
check('task removal does not flush queue', !taskRemovedBody.includes('flushAutomaticTripQueue'));
check('task removal records deferred retry', taskRemovedBody.includes('fila preservada'));
check('coordinator calls terminal policy', coordinator.includes('GtoTripSubmissionPolicy.maySubmit'));
check('coordinator blocks non-terminal state', coordinator.includes('Viagem ainda em andamento; envio bloqueado'));
check('queue entry also calls terminal policy', sync.includes('GtoTripSubmissionPolicy.maySubmit'));
check('queue entry blocks non-terminal state', sync.includes('Envio bloqueado: a viagem ainda não foi confirmada como Concluído.'));
check('sending stage uses the registering message and spinner contract', service.includes('"TRIP_SENDING"')
  && service.includes('"Registrando viagem..."')
  && service.includes('stageKey.endsWith("|TRIP_SENDING")'));
check('terminal failsafe is short and bounded', /CERTIFIED_TERMINAL_FAILSAFE_DELAY_MS\s*=\s*1_200L/.test(service));
check('four-second terminal debounce removed', !/CERTIFIED_TERMINAL_FAILSAFE_DELAY_MS\s*=\s*4_000L/.test(service));
check('policy requires result confirmed', policy.includes('RESULT_CONFIRMED'));
check('policy requires normal completion', policy.includes('CONFIRMED_NORMAL'));
check('policy requires certified result', policy.includes('certifiedResult'));
check('selection sensor is armed on first list frame', service.includes('mainHandler.post(this::updateFreightTouchPulseSensor);'));

execFileSync('javac', ['-d', out, path.join(javaRoot, 'GtoTripSubmissionPolicy.java'), test], { stdio: 'inherit' });
execFileSync('java', ['-cp', out, 'com.nvu.operacional.GtoTripSubmissionPolicyTest'], { stdio: 'inherit' });
console.log('HF177 trip flow gate passed.');
