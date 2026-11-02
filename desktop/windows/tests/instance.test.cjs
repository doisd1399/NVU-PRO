const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createInstance } = require('../core/instance.cjs');
const { compareVersions, identifyNvu, isMainProcess } = require('../core/process-list.cjs');

const SELF = { pid: 100, exe: 'C:\\Downloads\\NVU-PRO-Windows-0.2.0\\NVU PRO.exe', version: '0.2.0' };
const OLD = { pid: 200, exe: 'C:\\Downloads\\NVU-PRO-Windows-0.1.3\\NVU PRO.exe', version: '0.1.3' };
const quietLogger = () => { const events = []; return { events, info: (e, d) => events.push(['info', e, d]), warn: (e, d) => events.push(['warn', e, d]), error: (e, d) => events.push(['error', e, d]) }; };
// Controlled world: processes, packages, dialogs and the Electron lock are all fakes.
function world({ owners = [OLD], packages = {}, answers = [], cli = {}, releaseOnTakeover = true, closeWorks = false, lockFreeAfter = 0 } = {}) {
  const log = quietLogger(), calls = { dialogs: [], close: [], force: [], locks: [] };
  const alive = new Set(owners.map(o => o.pid));
  let lockCalls = 0, time = 0;
  const app = { requestSingleInstanceLock: data => {
      calls.locks.push(data); lockCalls++;
      if (data?.takeover && releaseOnTakeover) alive.clear(); // a new version closes itself when asked
      return alive.size === 0 && lockCalls > lockFreeAfter; } };
  const instance = createInstance({ app, cli, self: SELF, logger: log, now: () => time, sleep: async ms => { time += ms; },
    find: async () => owners.map(o => ({ pid: o.pid, exe: o.exe, commandLine: `"${o.exe}"` })),
    readPackage: dir => Object.entries(packages).find(([key]) => dir.toLowerCase().startsWith(key.toLowerCase()))?.[1] ?? null,
    dialogs: { show: async options => { calls.dialogs.push(options); return { response: answers.shift() ?? 0 }; } },
    killer: { close: async pid => { calls.close.push(pid); if (closeWorks) alive.delete(pid); }, force: async pid => { calls.force.push(pid); alive.delete(pid); } },
    alive: pid => alive.has(pid) });
  return { instance, calls, log, alive, app };
}
const nvuPackage = version => ({ name: 'nvu-windows', version });
const OLD_PACKAGES = { 'C:\\Downloads\\NVU-PRO-Windows-0.1.3': nvuPackage('0.1.3') };

test('Comparação de versões e identificação: só o processo principal de uma NVU autêntica é reconhecido', () => {
  assert.equal(compareVersions('0.2.0', '0.1.9'), 1); assert.equal(compareVersions('0.1.4', '0.1.4'), 0); assert.equal(compareVersions('0.1.3', '0.2.0'), -1); assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
  assert.equal(isMainProcess({ commandLine: '"NVU PRO.exe" --type=renderer' }), false); assert.equal(isMainProcess({ commandLine: '"NVU PRO.exe"' }), true);
  const read = dir => dir.includes('Other') ? { name: 'someone-elses-app', version: '9.9.9' } : nvuPackage('0.1.3');
  assert.equal(identifyNvu({ pid: 1, exe: 'C:\\NVU\\NVU PRO.exe', commandLine: '' }, read).verified, true);
  assert.equal(identifyNvu({ pid: 2, exe: 'C:\\Other\\NVU PRO.exe', commandLine: '' }, read).verified, false, 'mesmo nome de arquivo, outro pacote');
  assert.equal(identifyNvu({ pid: 3, exe: 'C:\\NVU\\NVU PRO.exe', commandLine: '--type=gpu-process' }, read), null);
  assert.equal(identifyNvu({ pid: 4, exe: 'C:\\Other Apps\\electron.exe', commandLine: '' }, () => ({ name: 'nvu-windows', version: '1' })).verified, false, 'nome de imagem diferente de NVU PRO.exe');
});
test('Primeira instância: pede o bloqueio com a identidade real (versão, pasta, pid)', () => {
  const w = world(); w.alive.clear();
  assert.equal(w.instance.requestLock(), true);
  assert.deepEqual(w.calls.locks[0], { product: 'nvu-pro', pid: 100, version: '0.2.0', exe: SELF.exe });
});
test('Mesma versão já aberta: sai em silêncio sem caixas de diálogo e sem encerrar nada', async () => {
  const w = world({ owners: [{ ...OLD, version: '0.2.0', exe: 'C:\\Apps\\NVU PRO\\NVU PRO.exe' }], packages: { 'C:\\Apps\\NVU PRO': nvuPackage('0.2.0') } });
  const result = await w.instance.handleLostLock();
  assert.equal(result.kind, 'same-instance'); assert.equal(result.exitCode, 0); assert.equal(result.primary, false);
  assert.deepEqual(w.calls.dialogs, []); assert.deepEqual(w.calls.force, []); assert.deepEqual(w.calls.close, []);
});
test('Versão anterior aberta: explica versões e pastas e, se a pessoa mantém a anterior, nada é encerrado', async () => {
  const w = world({ packages: OLD_PACKAGES, answers: [1] });
  const result = await w.instance.handleLostLock();
  assert.equal(result.kind, 'other-version-kept'); assert.equal(result.primary, false);
  const box = w.calls.dialogs[0];
  assert.match(box.message, /versão anterior/i); assert.match(box.detail, /0\.1\.3/); assert.match(box.detail, /0\.2\.0/); assert.match(box.detail, /NVU-PRO-Windows-0\.1\.3/);
  assert.deepEqual(w.calls.force, []); assert.deepEqual(w.calls.close, []);
  assert.equal(w.calls.locks.filter(d => d?.takeover).length, 0, 'sem pedido de troca');
});
test('Troca para a versão nova: a anterior (versão atual) fecha sozinha ao receber o pedido e a nova assume', async () => {
  const w = world({ packages: OLD_PACKAGES, answers: [0] });
  const result = await w.instance.handleLostLock();
  assert.equal(result.kind, 'took-over'); assert.equal(result.primary, true);
  assert(w.calls.locks.some(d => d?.takeover === true && d.version === '0.2.0'));
  assert.deepEqual(w.calls.force, []);
});
test('Versão antiga que ignora o pedido: tenta fechar com o Windows e só encerra o processo NVU verificado após confirmação explícita', async () => {
  const w = world({ packages: OLD_PACKAGES, answers: [0, 0], releaseOnTakeover: false });
  const result = await w.instance.handleLostLock();
  assert.equal(result.kind, 'took-over'); assert.deepEqual(w.calls.close, [200]); assert.deepEqual(w.calls.force, [200]);
  assert.match(w.calls.dialogs[1].detail, /Encerrar somente esse processo da NVU/); assert.match(w.calls.dialogs[1].detail, /pro-journal\.json/);
});
test('Recusar o encerramento forçado deixa a versão anterior intacta', async () => {
  const w = world({ packages: OLD_PACKAGES, answers: [0, 1], releaseOnTakeover: false });
  const result = await w.instance.handleLostLock();
  assert.equal(result.kind, 'takeover-failed'); assert.equal(result.reason, 'force-declined'); assert.deepEqual(w.calls.force, []); assert(w.alive.has(200));
  assert.match(w.calls.dialogs.at(-1).detail, /NVU-I040/);
});
test('Programa com o mesmo nome de arquivo mas pacote diferente nunca é encerrado nem tratado como NVU', async () => {
  const w = world({ owners: [{ pid: 300, exe: 'C:\\Other\\NVU PRO.exe', version: null }], packages: { 'C:\\Other': { name: 'another-electron-app', version: '1.0.0' } }, answers: [0] });
  const result = await w.instance.handleLostLock();
  assert.equal(result.kind, 'unknown-owner'); assert.equal(result.exitCode, 3);
  assert.deepEqual(w.calls.force, []); assert.deepEqual(w.calls.close, []); assert.match(w.calls.dialogs[0].detail, /NVU-I030/); assert.match(w.calls.dialogs[0].detail, /não é uma NVU reconhecida/);
});
test('Sem conseguir listar processos: orienta a fechar pela bandeja e não mexe em nada', async () => {
  const w = world({ answers: [0] }); const failing = createInstance({ app: w.app, cli: {}, self: SELF, logger: w.log, find: async () => { throw Error('PowerShell bloqueado'); }, readPackage: () => null,
    dialogs: { show: async o => { w.calls.dialogs.push(o); return { response: 0 }; } }, killer: { close: async () => { throw Error('never'); }, force: async () => { throw Error('never'); } }, alive: () => true });
  const result = await failing.handleLostLock();
  assert.equal(result.kind, 'unknown-owner'); assert.match(w.calls.dialogs[0].detail, /bandeja do Windows/); assert(w.log.events.some(e => e[1] === 'instance.process_list_failed'));
});
test('Modo sem diálogos (suporte/automação): nunca abre caixa, nunca troca de versão, registra e devolve código de saída', async () => {
  const different = world({ packages: OLD_PACKAGES, answers: [0], cli: { noDialogs: true } });
  const r1 = await different.instance.handleLostLock();
  assert.equal(r1.kind, 'other-version-kept'); assert.equal(r1.exitCode, 4); assert.deepEqual(different.calls.dialogs, []); assert.deepEqual(different.calls.force, []);
  const unknown = world({ owners: [], cli: { noDialogs: true } });
  const r2 = await unknown.instance.handleLostLock();
  assert.equal(r2.exitCode, 3); assert.deepEqual(unknown.calls.dialogs, []);
});
test('Instância principal: sempre traz a janela para frente e só aceita troca vinda de uma NVU verificada', async () => {
  const w = world({ packages: OLD_PACKAGES }); let shown = 0, quit = 0;
  const handler = w.instance.primaryHandler({ show: () => { shown++; }, quit: () => { quit++; } });
  await handler({}, [], '', undefined); assert.equal(shown, 1); assert.equal(quit, 0);
  await handler({}, [], '', { product: 'outro', takeover: true, pid: 200 }); assert.equal(quit, 0, 'produto desconhecido');
  await handler({}, [], '', { product: 'nvu-pro', takeover: true, pid: 999, version: '9.9.9' }); assert.equal(quit, 0, 'pid que não é uma NVU em execução');
  await handler({}, [], '', { product: 'nvu-pro', takeover: false, pid: 200, version: '0.1.3' }); assert.equal(quit, 0, 'sem pedido de troca');
  await handler({}, [], '', { product: 'nvu-pro', takeover: true, pid: 200, version: '0.1.3' }); assert.equal(quit, 1, 'NVU verificada pediu a troca');
  assert.equal(shown, 5);
});
