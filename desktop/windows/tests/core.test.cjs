const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomUUID, createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { Session, validateEvent } = require('../core/session.cjs');
const { discover, pluginAction, clampBounds } = require('../core/games.cjs');
const { GoogleAuth } = require('../core/google-auth.cjs');
const { verifyNsisInstaller } = require('../tools/nsis-integrity.cjs');

test('Scripts de empacotamento passam pela análise sintática do Node', () => {
  const { Script } = require('node:vm');
  for (const name of ['build-installer.cjs', 'build-portable.cjs'])
    assert.doesNotThrow(() => new Script(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), { filename: name }));
});

test('NSIS real compilado passa na verificação nativa de CRC', () => {
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/nsis-crc.exe'));
  const result = verifyNsisInstaller(bytes);
  assert.equal(result.crcEnabled, true); assert.equal(result.bytes, bytes.length);
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
});
test('Alterar stub, conteúdo ou CRC do instalador bloqueia a entrega', () => {
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/nsis-crc.exe'));
  const meta = verifyNsisInstaller(bytes);
  for (const position of [1024, meta.firstHeaderOffset + 32, bytes.length - 1]) {
    const damaged = Buffer.from(bytes); damaged[position] ^= 1;
    assert.throws(() => verifyNsisInstaller(damaged), /INSTALLER_CRC_MISMATCH/);
  }
});
test('Instalador truncado, com bytes extras ou CRC desligado é rejeitado', () => {
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/nsis-crc.exe'));
  const meta = verifyNsisInstaller(bytes);
  assert.throws(() => verifyNsisInstaller(bytes.subarray(0, -1)), /INSTALLER_LENGTH_MISMATCH/);
  assert.throws(() => verifyNsisInstaller(Buffer.concat([bytes, Buffer.from([0])])), /INSTALLER_LENGTH_MISMATCH/);
  const disabled = Buffer.from(bytes); disabled.writeUInt32LE(disabled.readUInt32LE(meta.firstHeaderOffset) | 4, meta.firstHeaderOffset);
  assert.throws(() => verifyNsisInstaller(disabled), /INSTALLER_CRC_DISABLED/);
});
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvu-win-')); const file = path.join(dir, 'journal.json');
  let at = Date.now(); const s = new Session(file, () => at);
  const scope = { driverId: 'qa-driver', companyId: 'qa-company', jobId: 'qa-operation', contractId: 'qa-contract', simulatorKey: 'ets2' };
  const id = randomUUID(), boot = randomUUID();
  const heartbeat = (jobId = id, sequence = 1) => s.heartbeat({ version: 1, simulatorKey: 'ets2', bootId: boot, sequence, at, jobId, paused: false });
  const event = (eventId = id) => ({ version: 1, type: 'job.delivered', simulatorKey: 'ets2', eventId,
    capturedAt: at + 1, origin: 'Berlin', destination: 'Paris', amountCents: 150000, currency: 'EUR', distanceKm: 512.5 });
  return { s, scope, id, heartbeat, event, file, tick: delta => at += delta };
}
test('Vínculo prévio, entrega durável e replay exato usam uma identidade', () => {
  const f = fixture(); f.s.start(f.scope); f.heartbeat();
  const e = f.event(); const first = f.s.ingest(e); assert.equal(first.state, 'PENDING');
  assert.equal(f.s.ingest(e), first); assert.equal(f.s.pending('qa-driver').length, 1);
  assert.throws(() => f.s.ingest({ ...e, amountCents: e.amountCents + 1 }), /CONFLICT/);
  const restored = new Session(f.file); assert.equal(restored.pending('qa-driver').length, 1); assert.equal(restored.live, null);
});
test('Entrega atrasada após reinício continua na operação original', () => {
  const f = fixture(); f.s.start(f.scope); f.heartbeat(); const e = f.event();
  const restored = new Session(f.file); assert.equal(restored.ingest(e).state, 'PENDING');
  assert.equal(restored.pending('qa-driver')[0].scope.jobId, 'qa-operation');
});
test('Frete anterior sem vínculo não é importado para a operação atual', () => {
  const f = fixture(); f.s.start(f.scope); assert.equal(f.s.ingest(f.event()), null);
});
test('Troca de empresa/conta preserva pendência e impede migração do frete', () => {
  const f = fixture(); f.s.start(f.scope); f.heartbeat();
  f.s.syncScope({ ...f.scope, companyId: 'other' }); assert.equal(f.s.live, null);
  f.tick(100); f.s.start({ ...f.scope, companyId: 'other' }); f.heartbeat(f.id, 2);
  assert.match(f.s.live.blocked, /outra operação/); assert.equal(f.s.pending('other-user').length, 0);
});
test('Pausa fecha intervalo; entrega durante pausa exige conferência', () => {
  const f = fixture(); f.s.start(f.scope); f.heartbeat(); f.tick(20); f.s.pause(); f.tick(20);
  assert.equal(f.s.ingest(f.event()).state, 'REVIEW');
});
test('Entrega anterior à pausa pode chegar atrasada sem perder autorização', () => {
  const f = fixture(); f.s.start(f.scope); f.heartbeat(); const e = f.event(); f.tick(20); f.s.pause();
  assert.equal(f.s.ingest(e).state, 'PENDING');
});
test('Heartbeat expirado e sequência repetida removem conexão válida', () => {
  const f = fixture(); f.s.start(f.scope); assert.equal(f.heartbeat(), true); assert.equal(f.s.connected('ets2'), true);
  assert.equal(f.heartbeat(), false); f.tick(5100); assert.equal(f.s.connected('ets2'), false);
});
test('Entregas consecutivas de mesmo valor/rota são eventos independentes', () => {
  const f = fixture(); f.s.start(f.scope); f.heartbeat(); f.s.ingest(f.event());
  const id2 = randomUUID(); f.tick(100); f.heartbeat(id2, 2); f.s.ingest(f.event(id2));
  assert.equal(f.s.pending('qa-driver').length, 2);
});
test('ACK perdido é repetível; confirmação exige prova e usuário correto', () => {
  const f = fixture(); f.s.start(f.scope); f.heartbeat(); const row = f.s.ingest(f.event());
  assert.throws(() => f.s.acknowledge('other', row.id, { state: 'CONFIRMED' }), /SCOPE/);
  assert.throws(() => f.s.acknowledge('qa-driver', row.id, { state: 'CONFIRMED', tripId: 'trip' }), /INVALID/);
  f.s.acknowledge('qa-driver', row.id, { state: 'QUEUED', tripId: 'trip' }); assert.equal(f.s.pending('qa-driver').length, 1);
  f.s.acknowledge('qa-driver', row.id, { state: 'CONFIRMED', tripId: 'trip', serverValidated: true });
  assert.equal(new Session(f.file).pending('qa-driver').length, 0);
});
test('Dados incompletos são preservados para OCR e moeda inválida não é aceita', () => {
  const f = fixture(); f.s.start(f.scope); f.heartbeat();
  assert.equal(validateEvent({ ...f.event(), currency: 'USD' }), false);
  assert.equal(f.s.ingest({ ...f.event(), distanceKm: null }).state, 'REVIEW');
});
test('Steam adicional e instalação/remoção preservam DLL de terceiros', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvu-steam-')), lib = path.join(dir, 'second');
  fs.mkdirSync(path.join(dir, 'steamapps'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'steamapps/libraryfolders.vdf'), `"libraryfolders" { "1" { "path" "${lib}" } }`);
  const root = path.join(lib, 'steamapps/common/Euro Truck Simulator 2');
  fs.mkdirSync(path.join(root, 'bin/win_x64/plugins'), { recursive: true }); fs.writeFileSync(path.join(root, 'bin/win_x64/eurotrucks2.exe'), 'MZ');
  const other = path.join(root, 'bin/win_x64/plugins/other.dll'); fs.writeFileSync(other, 'third-party');
  assert.equal(discover([dir])[0].root, root);
  const dll = path.join(dir, 'test.dll'); fs.writeFileSync(dll, 'MZ synthetic DLL fixture');
  pluginAction(root, 'ets2', dll); assert.equal(fs.readFileSync(other, 'utf8'), 'third-party');
  pluginAction(root, 'ets2', dll, true); assert(fs.existsSync(other));
  fs.writeFileSync(path.join(root, 'bin/win_x64/plugins/nvu_scs_telemetry.dll'), 'unknown');
  assert.throws(() => pluginAction(root, 'ets2', dll), /identificação/);
});
test('Monitor removido recupera posição visível, inclusive coordenadas negativas', () => {
  const b = clampBounds({ x: -2000, y: 9000, width: 300, height: 210 }, [{ x: 0, y: 0, width: 1920, height: 1080 }]);
  assert(b.x >= 0 && b.y >= 0 && b.x + b.width <= 1920 && b.y + b.height <= 1080);
});
test('OAuth valida assinatura, audience, issuer e nonce usando chaves controladas', async () => {
  const jose = await import(pathToFileURL(require.resolve('jose')).toString());
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256'); const jwk = await jose.exportJWK(publicKey); jwk.kid = 'qa';
  const auth = new GoogleAuth({ config: { clientId: 'qa.apps.googleusercontent.com' } }); auth.jwks = jose.createLocalJWKSet({ keys: [jwk] });
  const token = await new jose.SignJWT({ nonce: 'qa-nonce' }).setProtectedHeader({ alg: 'RS256', kid: 'qa' })
    .setIssuer('https://accounts.google.com').setAudience('qa.apps.googleusercontent.com').setExpirationTime('1m').sign(privateKey);
  await auth.verify(token, 'qa-nonce'); await assert.rejects(auth.verify(token, 'wrong'), /NONCE/);
  auth.config.clientId = 'different.apps.googleusercontent.com'; await assert.rejects(auth.verify(token));
});
test('OAuth usa browser externo, loopback, state e PKCE; estado errado não conclui login', async () => {
  let auth, requestUrl, body;
  auth = new GoogleAuth({ config: { clientId: 'qa.apps.googleusercontent.com' }, openExternal: async url => {
    requestUrl = new URL(url); const callback = new URL(requestUrl.searchParams.get('redirect_uri'));
    assert.equal(callback.hostname, '127.0.0.1');
    const get = url => new Promise(resolve => http.get(url, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }));
    callback.search = new URLSearchParams({ code: 'qa-code', state: 'wrong' }); assert.equal(await get(callback), 400);
    callback.searchParams.set('state', requestUrl.searchParams.get('state')); assert.equal(await get(callback), 200);
  } });
  auth.exchange = async (value, nonce) => { body = value; assert(nonce); return { idToken: 'controlled-token' }; };
  assert.equal((await auth.signIn()).idToken, 'controlled-token');
  assert.equal(requestUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'), requestUrl.searchParams.get('code_challenge'));
});
