const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const u = require('../core/update-check.cjs');
const { createWorld, pkg } = require('./helpers/fake-main.cjs');

const release = (tag, extra = {}) => ({ tag_name: tag, name: tag, draft: false, prerelease: false, published_at: '2026-11-03T10:00:00Z', html_url: 'https://evil.example/x', ...extra });

test('Aviso de nova versão: só releases publicados da NVU Windows, link montado pela tag, falhas sem exceção e consultas limitadas', async () => {
  // versões
  assert.deepEqual(u.parseVersion('0.2.10'), [0, 2, 10]);
  for (const bad of ['0.2', '0.2.0-rc1', 'v0.2.0', '', null, '1.2.3.4', 'x.2.3']) assert.equal(u.parseVersion(bad), null, String(bad));
  assert.equal(u.compareVersions('0.2.10', '0.2.9'), 1); assert.equal(u.compareVersions('0.2.0', '0.2.0'), 0); assert.equal(u.compareVersions('0.1.9', '0.2.0'), -1);
  assert.throws(() => u.compareVersions('x', '0.2.0'), /VERSION_INVALID/);

  // última versão publicada: rascunhos, outras tags e lixo são ignorados
  const list = [release('windows-comunidade-v0.2.0-run7'), release('windows-comunidade-v0.2.1-run9', { prerelease: true }), release('windows-comunidade-v9.9.9-run1', { draft: true }),
    release('v36'), release('apk-debug-1.0.541'), release('windows-comunidade-v0.2.x-run1'), null, 'texto', { tag_name: 42 },
    release('android-v9.9.9-run1'), release('windows-v9.9.9-run1'), release('xwindows-comunidade-v9.9.9'), release('windows-comunidade-v9.9.9x'), release('windows-comunidade-v1.2.3.4')];
  const latest = u.pickLatest(list);
  assert.equal(latest.version, '0.2.1'); assert.equal(latest.prerelease, true);
  assert.equal(latest.url, 'https://github.com/doisd1399/NVU-PRO/releases/tag/windows-comunidade-v0.2.1-run9', 'o link nasce da tag, nunca do html_url da resposta');
  assert(u.isTrustedReleaseUrl(latest.url));
  for (const bad of ['http://github.com/doisd1399/NVU-PRO/releases/tag/windows-comunidade-v0.2.1', 'https://github.com/outro/NVU-PRO/releases/tag/windows-comunidade-v0.2.1',
    'https://github.com/doisd1399/NVU-PRO/releases/tag/v36', 'https://github.com/doisd1399/NVU-PRO/releases/tag/windows-comunidade-v0.2.1?x=1', 'javascript:alert(1)',
    'https://evil.example/', null, 42, 'https://github.com/doisd1399/NVU-PRO/releases/tag/windows-comunidade-v' + 'a'.repeat(300)]) assert.equal(u.isTrustedReleaseUrl(bad), false, String(bad).slice(0, 60));
  assert.equal(u.pickLatest([release('windows-comunidade-v0.2.0-run1', { published_at: '2026-01-01T00:00:00Z' }), release('windows-comunidade-v0.2.0-run2', { published_at: '2026-02-01T00:00:00Z' })]).tag,
    'windows-comunidade-v0.2.0-run2', 'mesma versão: vale o mais recente');
  assert.equal(u.pickLatest([]), null); assert.throws(() => u.pickLatest({}), /RESPONSE_INVALID/);
  assert.equal(u.pickLatest([release('windows-comunidade-v0.2.0-run1', { name: 'a\u0000b'.padEnd(500, 'x') })]).name.length, 120);

  // avaliação
  assert.equal(u.evaluate(list, '0.2.0').available, true); assert.equal(u.evaluate(list, '0.2.1').available, false);
  assert.equal(u.evaluate(list, '0.3.0').status, 'current'); assert.equal(u.evaluate([], '0.2.0').status, 'none');

  // consulta limitada: 12 h entre consultas, erro tenta de novo em 30 min e não apaga um aviso já conhecido
  let calls = 0, clock = 1_000_000;
  const fetchJson = async () => { calls++; return list; };
  const first = await u.checkForUpdate({ currentVersion: '0.2.0', fetchJson, now: () => clock });
  assert.equal(first.info.available, true); assert.equal(calls, 1); assert.equal(first.cached, false);
  clock += 3_600_000;
  const second = await u.checkForUpdate({ currentVersion: '0.2.0', fetchJson, now: () => clock, state: first.state });
  assert.equal(calls, 1, 'dentro de 12 h não consulta de novo'); assert.equal(second.cached, true);
  clock += 12 * 3_600_000;
  const refreshed = await u.checkForUpdate({ currentVersion: '0.2.0', fetchJson, now: () => clock, state: first.state });
  assert.equal(refreshed.cached, false); assert.equal(calls, 2, 'depois de 12 h consulta de novo');
  clock += 13 * 3_600_000;
  const failed = await u.checkForUpdate({ currentVersion: '0.2.0', fetchJson: async () => { calls++; throw Error('RATE_LIMIT'); }, now: () => clock, state: refreshed.state });
  assert.equal(failed.info.available, true, 'um erro não apaga um aviso já conhecido'); assert.equal(failed.info.lastError, 'RATE_LIMIT'); assert.equal(failed.state.failed, true);
  clock += 10 * 60_000;
  const before = calls;
  const early = await u.checkForUpdate({ currentVersion: '0.2.0', fetchJson, now: () => clock, state: failed.state });
  assert.equal(early.cached, true); assert.equal(calls, before, 'dentro de 30 min do erro não tenta de novo');
  clock += 25 * 60_000;
  const retried = await u.checkForUpdate({ currentVersion: '0.2.0', fetchJson, now: () => clock, state: failed.state });
  assert.equal(retried.cached, false); assert.equal(retried.info.available, true); assert.equal(retried.state.failed, false);
  const cold = await u.checkForUpdate({ currentVersion: '0.2.0', fetchJson: async () => { throw Error('qualquer coisa'); }, now: () => clock });
  assert.deepEqual([cold.info.status, cold.info.available, cold.info.reason], ['error', false, 'NETWORK']);
  assert.equal((await u.checkForUpdate({ currentVersion: 'dev', fetchJson, now: () => clock })).info.reason, 'CURRENT_VERSION_INVALID');

  // o resultado guardado foi avaliado para a versão de então: depois de atualizar o aplicativo, o aviso some sem nova consulta
  const callsBefore = calls, fresh = await u.checkForUpdate({ currentVersion: '0.2.0', fetchJson, now: () => clock });
  assert.equal(fresh.info.available, true);
  const updated = await u.checkForUpdate({ currentVersion: '0.2.1', fetchJson, now: () => clock + 60_000, state: fresh.state });
  assert.deepEqual([updated.cached, updated.info.available, updated.info.status, updated.info.current, calls - callsBefore], [true, false, 'current', '0.2.1', 1], 'só a consulta de "fresh" ocorreu');
  const keptAfterUpdate = await u.checkForUpdate({ currentVersion: '0.2.1', fetchJson: async () => { throw Error('HTTP_ERROR'); }, now: () => clock + 13 * 3_600_000, state: fresh.state });
  assert.deepEqual([keptAfterUpdate.info.available, keptAfterUpdate.info.status, keptAfterUpdate.info.current, keptAfterUpdate.info.lastError], [false, 'current', '0.2.1', 'HTTP_ERROR'], 'um erro depois da atualização não ressuscita o aviso velho');

  // arquivo lido do disco: reconstruído campo a campo; o link sempre nasce da tag e o que não encaixa vale como "sem estado"
  const onDisk = JSON.parse(JSON.stringify(fresh.state));
  assert.deepEqual(u.validState(onDisk), fresh.state);
  const tampered = JSON.parse(JSON.stringify(fresh.state)); Object.assign(tampered.info.latest, { url: 'https://evil.example/x', extra: '<script>' }); tampered.info.reason = 'qualquer coisa'; tampered.info.sneaky = true; tampered.failed = 'sim';
  const rebuilt = u.validState(tampered);
  assert.equal(rebuilt.info.latest.url, 'https://github.com/doisd1399/NVU-PRO/releases/tag/windows-comunidade-v0.2.1-run9'); assert.equal('extra' in rebuilt.info.latest, false);
  assert.equal('reason' in rebuilt.info, false); assert.equal('sneaky' in rebuilt.info, false); assert.equal(rebuilt.failed, false);
  const mutate = change => { const copy = JSON.parse(JSON.stringify(fresh.state)); change(copy); return u.validState(copy); };
  for (const [label, change] of [['versão do arquivo', s => { s.version = 2; }], ['checkedAt', s => { s.checkedAt = 'ontem'; }], ['status', s => { s.info.status = 'hacked'; }], ['tag fora do padrão', s => { s.info.latest.tag = 'v36'; }], ['tag não textual', s => { s.info.latest.tag = 7; }], ['info ausente', s => { delete s.info; }]]) assert.equal(mutate(change), null, label);
  for (const bad of [null, undefined, 'texto', 42, [], {}]) assert.equal(u.validState(bad), null, String(bad));
  assert.equal(u.validState({ version: 1, checkedAt: 5, failed: true, info: { status: 'error', available: false, reason: 'RATE_LIMIT', latest: null } }).info.reason, 'RATE_LIMIT');

  // chamada HTTP: um único endereço, sem redirecionamento, tempo e tamanho limitados
  const reply = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, text: async () => body });
  const make = fetchImpl => u.createFetchJson({ fetchImpl, userAgent: 'NVU-PRO-Windows/0.2.0', timeoutMs: 40, maxBytes: 1000 });
  let seen;
  assert.deepEqual(await make(async (url, options) => { seen = { url, options }; return { status: 200, ok: true, text: async () => '[1]' }; })(u.API), [1]);
  assert.equal(seen.options.redirect, 'error'); assert.equal(seen.options.headers['User-Agent'], 'NVU-PRO-Windows/0.2.0'); assert.match(seen.options.headers.Accept, /github/);
  await assert.rejects(make(reply(403, ''))(u.API), /RATE_LIMIT/); await assert.rejects(make(reply(429, ''))(u.API), /RATE_LIMIT/);
  await assert.rejects(make(reply(500, ''))(u.API), /HTTP_ERROR/); await assert.rejects(make(reply(200, 'x'.repeat(1001)))(u.API), /RESPONSE_TOO_LARGE/);
  await assert.rejects(make(reply(200, '{nope'))(u.API), /RESPONSE_INVALID/);
  await assert.rejects(make((url, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error('aborted')))))(u.API), /TIMEOUT/);
  await assert.rejects(make(reply(200, '[]'))('https://evil.example/repos/doisd1399/NVU-PRO/releases'), /URL_NOT_ALLOWED/);
  await assert.rejects(make(reply(200, '[]'))('https://api.github.com/repos/outro/projeto/releases'), /URL_NOT_ALLOWED/);
});

// ---- o mesmo recurso dentro do main.cjs REAL (Electron simulado, aplicativo "empacotado") ----
const [major, minor, patch] = pkg.version.split('.').map(Number), newer = `${major}.${minor}.${patch + 1}`, newerTag = `windows-comunidade-v${newer}-run3`;
const pageOf = tag => `https://github.com/doisd1399/NVU-PRO/releases/tag/${tag}`;
const published = [{ tag_name: newerTag, name: `NVU PRO Windows ${newer}`, draft: false, prerelease: false, published_at: '2026-11-03T10:00:00Z', html_url: 'https://evil.example/phish' }];
const sandbox = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvu-update-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
function packagedWorld(dir, { env = {}, answer = async () => { throw Error('NETWORK'); } } = {}) {
  const resources = path.join(dir, 'resources');
  fs.mkdirSync(path.join(resources, 'web'), { recursive: true }); fs.mkdirSync(path.join(resources, 'plugin'), { recursive: true });
  fs.writeFileSync(path.join(resources, 'web/index.html'), '<html></html>'); fs.copyFileSync(path.join(__dirname, '../plugin/bin/nvu_scs_telemetry.dll'), path.join(resources, 'plugin/nvu_scs_telemetry.dll'));
  const w = createWorld(dir, { env, process: { resourcesPath: resources } });
  Object.assign(w, { requests: [], menus: [], once: [] });
  w.app.isPackaged = true;
  w.electron.net.fetch = async (url, options) => { w.requests.push({ url, options }); return answer(); };
  w.electron.Tray = class { setToolTip() {} setContextMenu(menu) { w.menus.push(menu); } on() {} destroy() {} };
  w.context.setTimeout = (fn, ms) => { w.once.push({ fn, ms }); return { unref() {} }; };
  return w;
}
const reply = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });
const ipcOf = w => { const main = w.windows[0], event = { sender: main.webContents, senderFrame: main.webContents.mainFrame }; return (method, input) => w.handlers.get('nvu:windows')(event, { method, input }); };
const logOf = w => fs.readFileSync(path.join(w.user, 'logs/nvu.log'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const noticeItems = menu => [...menu].map(item => item.label).filter(label => /^Nova versão/.test(label));   // [...] : o menu nasce no contexto isolado do main
async function fire(w) { const timer = w.once.find(item => item.ms === 30000); assert(timer, 'a consulta é agendada para 30 s depois da abertura'); await timer.fn(); await w.settle(); }

test('Aviso de nova versão no main real: consulta 30 s depois de abrir, grava o resultado, avisa a interface e a bandeja, abre só a página da tag, respeita o intervalo e o desligamento', async t => {
  const dir = sandbox(t), w1 = packagedWorld(dir, { answer: reply(200, published) });
  w1.start(); await w1.settle(); assert.deepEqual(w1.errors, []);
  const call1 = ipcOf(w1);
  assert.equal((await call1('status')).update, null, 'antes da primeira consulta não há aviso');
  assert.deepEqual(w1.once.map(item => item.ms), [30000]); assert(w1.timers.some(item => item.ms === 6 * 3600e3), 'reavalia a cada 6 h; o intervalo de 12 h decide se consulta');
  assert.equal(w1.requests.length, 0, 'abrir o aplicativo não consulta');
  assert.deepEqual(noticeItems(w1.menus[0]), [], 'a bandeja nasce sem o item de versão nova');
  await fire(w1);
  assert.equal(w1.requests.length, 1); assert.equal(w1.requests[0].url, u.API); assert.equal(w1.requests[0].options.redirect, 'error'); assert.equal(w1.requests[0].options.headers['User-Agent'], `NVU-PRO-Windows/${pkg.version}`);
  const status = await call1('status');
  assert.deepEqual([status.update.available, status.update.latest.version, status.update.latest.url], [true, newer, pageOf(newerTag)], 'o link nasce da tag validada, nunca do html_url da resposta');
  const saved = JSON.parse(fs.readFileSync(path.join(w1.user, 'update-check.json'), 'utf8'));
  assert.deepEqual([saved.version, saved.failed, saved.info.latest.version], [1, false, newer]);
  const entry = logOf(w1).find(line => line.event === 'update.check'); assert.deepEqual([entry.status, entry.available, entry.latest], ['available', true, newer]);
  assert.equal(w1.windows[0].messages.filter(m => m.name === 'nvu:windows:update').at(-1).value.update.available, true, 'a interface recebe o aviso sem pedir');
  const item = w1.menus.at(-1).find(x => /^Nova versão/.test(x.label)); assert.equal(item.label, `Nova versão ${newer} disponível — abrir página`);
  assert.equal(await call1('openUpdatePage'), true); assert.equal(w1.opened.at(-1), pageOf(newerTag));
  item.click(); await w1.settle(); assert.equal(w1.opened.filter(url => url === pageOf(newerTag)).length, 2, 'a bandeja abre a mesma página');
  assert.equal(w1.opened.some(url => url.includes('evil.example')), false);
  assert.equal(w1.exits.length, 0);

  // reiniciado dentro do intervalo: usa o resultado gravado, sem nova consulta
  const w2 = packagedWorld(dir, { answer: async () => { throw Error('não deveria consultar'); } });
  w2.start(); await w2.settle(); const call2 = ipcOf(w2);
  await fire(w2); assert.equal(w2.requests.length, 0, 'dentro de 12 h não consulta'); assert.equal((await call2('status')).update.latest.version, newer);
  assert.equal(noticeItems(w2.menus.at(-1)).length, 1);

  // arquivo gravado ilegível: ignorado, consulta de novo; limite de consultas do GitHub: sem aviso, sem página, tenta de novo só em 30 min
  const broken = sandbox(t); fs.mkdirSync(path.join(broken, 'user'), { recursive: true }); fs.writeFileSync(path.join(broken, 'user/update-check.json'), '{ not json');
  const w3 = packagedWorld(broken, { answer: reply(403, {}) });
  w3.start(); await w3.settle(); const call3 = ipcOf(w3); await fire(w3);
  assert.equal(w3.requests.length, 1); const failed = (await call3('status')).update;
  assert.deepEqual([failed.status, failed.available, failed.reason], ['error', false, 'RATE_LIMIT']);
  await assert.rejects(call3('openUpdatePage'), /UPDATE_PAGE_UNAVAILABLE/); assert.equal(w3.opened.length, 0);
  assert.deepEqual(noticeItems(w3.menus.at(-1)), []); assert.equal(JSON.parse(fs.readFileSync(path.join(w3.user, 'update-check.json'), 'utf8')).failed, true);
  assert.equal(logOf(w3).find(line => line.event === 'update.check').reason, 'RATE_LIMIT');

  // arquivo guardado por uma versão anterior e com link adulterado: o aviso vale para a versão que roda agora e o link volta a nascer da tag
  const seed = (name, latest) => { const home = sandbox(t); fs.mkdirSync(path.join(home, 'user'), { recursive: true });
    fs.writeFileSync(path.join(home, 'user/update-check.json'), JSON.stringify({ version: 1, checkedAt: Date.now(), failed: false, info: { status: 'available', available: true, current: '0.0.1', checkedAt: Date.now(), latest } })); return home; };
  const w6 = packagedWorld(seed('adulterado', { version: newer, tag: newerTag, url: 'https://evil.example/phish', name: 'x' }), { answer: async () => { throw Error('não deveria consultar'); } });
  w6.start(); await w6.settle(); await fire(w6); const call6 = ipcOf(w6), notice = (await call6('status')).update;
  assert.deepEqual([w6.requests.length, notice.available, notice.current, notice.latest.url], [0, true, pkg.version, pageOf(newerTag)]);
  assert.equal(await call6('openUpdatePage'), true); assert.deepEqual(w6.opened, [pageOf(newerTag)]);
  // o aplicativo já é a versão anunciada (o usuário acabou de instalar): sem banner, sem item na bandeja, sem página
  const w7 = packagedWorld(seed('atualizado', { version: pkg.version, tag: `windows-comunidade-v${pkg.version}-run3`, url: pageOf(`windows-comunidade-v${pkg.version}-run3`) }), { answer: async () => { throw Error('não deveria consultar'); } });
  w7.start(); await w7.settle(); await fire(w7); const call7 = ipcOf(w7), done = (await call7('status')).update;
  assert.deepEqual([w7.requests.length, done.available, done.status, done.current], [0, false, 'current', pkg.version]);
  assert.deepEqual(noticeItems(w7.menus.at(-1)), []); await assert.rejects(call7('openUpdatePage'), /UPDATE_PAGE_UNAVAILABLE/); assert.equal(w7.opened.length, 0);

  // desligado por NVU_NO_UPDATE_CHECK=1 e em desenvolvimento (não empacotado): nada é agendado
  const w4 = packagedWorld(sandbox(t), { env: { NVU_NO_UPDATE_CHECK: '1' }, answer: reply(200, published) });
  w4.start(); await w4.settle();
  assert.equal(w4.once.length, 0); assert.equal(w4.timers.some(item => item.ms === 6 * 3600e3), false); assert.equal(logOf(w4).find(line => line.event === 'update.disabled').reason, 'env');
  await assert.rejects(ipcOf(w4)('openUpdatePage'), /UPDATE_PAGE_UNAVAILABLE/);
  const w5 = createWorld(sandbox(t)); w5.start(); await w5.settle();
  assert.equal(logOf(w5).find(line => line.event === 'update.disabled').reason, 'not_packaged'); assert.equal(w5.errors.length, 0);
});
