const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { verifyNsisInstaller } = require('../tools/nsis-integrity.cjs');
const { readAuthenticode, securityDirectory } = require('../tools/authenticode.cjs');

const fixture = path.join(__dirname, 'fixtures/nsis-crc.exe');
const has = command => !spawnSync(command, ['--version'], { stdio: 'ignore' }).error;
const toolsAvailable = () => has('openssl') && has('osslsigncode');
// A throwaway certificate created for this test only. It proves the container layout; it proves nothing about public trust.
function signedFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvu-sign-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = (cmd, args) => { const r = spawnSync(cmd, args, { cwd: dir, encoding: 'utf8' }); assert.equal(r.status, 0, `${cmd}: ${r.stderr || r.stdout}`); };
  run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', '2', '-nodes', '-keyout', 'key.pem', '-out', 'cert.pem', '-subj', '/CN=NVU QA descartavel/O=NVU QA',
    '-addext', 'keyUsage=digitalSignature', '-addext', 'extendedKeyUsage=codeSigning']);
  run('osslsigncode', ['sign', '-certs', 'cert.pem', '-key', 'key.pem', '-h', 'sha256', '-n', 'NVU QA fixture', '-in', fixture, '-out', 'signed.exe']);
  return { dir, file: path.join(dir, 'signed.exe'), bytes: fs.readFileSync(path.join(dir, 'signed.exe')) };
}

test('Instalador NSIS assinado (Authenticode real) é aceito: CRC do NSIS e contêiner do certificado conferem', t => {
  if (!toolsAvailable()) return t.skip('openssl/osslsigncode indisponíveis neste ambiente: execute no CI Windows com signtool');
  const { bytes } = signedFixture(t), original = fs.readFileSync(fixture), result = verifyNsisInstaller(bytes);
  assert.equal(result.signed, true); assert.equal(result.authenticode.certificates[0].type, 'PKCS_SIGNED_DATA');
  assert.equal(result.crcEnabled, true); assert(bytes.length > original.length);
  assert.equal(result.authenticode.offset + result.authenticode.bytes, bytes.length, 'o bloco de certificado é o último trecho do arquivo');
  // The unsigned original keeps its previous result.
  assert.equal(verifyNsisInstaller(original).signed, false);
});
test('Assinatura removida/adulterada, bytes extras ou truncamento do bloco de certificado são rejeitados', t => {
  if (!toolsAvailable()) return t.skip('openssl/osslsigncode indisponíveis neste ambiente');
  const { bytes } = signedFixture(t), meta = verifyNsisInstaller(bytes), dir = securityDirectory(bytes);
  assert.throws(() => verifyNsisInstaller(bytes.subarray(0, -1)), /INSTALLER_SIGNATURE_TRUNCATED/);
  assert.throws(() => verifyNsisInstaller(Buffer.concat([bytes, Buffer.from([0])])), /INSTALLER_SIGNATURE_FOLLOWED_BY_EXTRA_DATA/);
  const stripped = Buffer.from(bytes); stripped.writeUInt32LE(0, dir.entryAt); stripped.writeUInt32LE(0, dir.entryAt + 4);
  assert.throws(() => verifyNsisInstaller(stripped), /INSTALLER_LENGTH_MISMATCH/, 'diretório zerado com certificado ainda anexado');
  const shifted = Buffer.from(bytes); shifted.writeUInt32LE(dir.offset + 8, dir.entryAt); shifted.writeUInt32LE(dir.size - 8, dir.entryAt + 4);
  assert.throws(() => verifyNsisInstaller(shifted), /INSTALLER_SIGNATURE_PRECEDED_BY_UNKNOWN_DATA|INSTALLER_SIGNATURE_ENTRY/);
  const dirty = Buffer.from(bytes); dirty[meta.firstHeaderOffset + meta.dataLength] = 1;
  if (dir.offset > meta.firstHeaderOffset + meta.dataLength) assert.throws(() => verifyNsisInstaller(dirty), /INSTALLER_SIGNATURE_PADDING_NOT_ZERO/);
  const pkcs = Buffer.from(bytes); pkcs.writeUInt16LE(0x0001, dir.offset + 6);
  assert.throws(() => verifyNsisInstaller(pkcs), /INSTALLER_SIGNATURE_PKCS7_MISSING/);
});
test('Dados do NSIS adulterados dentro de um instalador assinado continuam rejeitados pelo CRC', t => {
  if (!toolsAvailable()) return t.skip('openssl/osslsigncode indisponíveis neste ambiente');
  const { bytes } = signedFixture(t), meta = verifyNsisInstaller(bytes);
  for (const position of [1024, meta.firstHeaderOffset + 32, meta.firstHeaderOffset + meta.dataLength - 1]) {
    const damaged = Buffer.from(bytes); damaged[position] ^= 1;
    assert.throws(() => verifyNsisInstaller(damaged), /INSTALLER_CRC_MISMATCH/);
  }
});
test('Contêiner Authenticode de executáveis comuns: ausente é explícito; presença exige alinhamento e fim de arquivo', t => {
  assert.deepEqual(readAuthenticode(fs.readFileSync(fixture), fs.readFileSync(fixture).length), { present: false, certificates: [] });
  if (!toolsAvailable()) return t.skip('openssl/osslsigncode indisponíveis neste ambiente');
  const { bytes } = signedFixture(t), info = readAuthenticode(bytes);
  assert.equal(info.present, true); assert.equal(info.offset % 8, 0);
});
test('Pronto para produção exige assinatura aceita pelo sistema, carimbo de tempo e certificado que NÃO seja autoassinado', () => {
  const { productionVerdict, verifySignature } = require('../tools/sign.cjs');
  const good = { valid: true, timestamped: true, selfSigned: false };
  assert.deepEqual(productionVerdict({ status: 'signed', os: good }), { ready: true, reason: null });
  assert.equal(productionVerdict({ status: 'unsigned', os: good }).reason, 'NOT_SIGNED');
  assert.equal(productionVerdict({ status: 'signed', os: null }).reason, 'OPERATING_SYSTEM_DID_NOT_ACCEPT_THE_SIGNATURE');
  assert.equal(productionVerdict({ status: 'signed', os: { ...good, valid: false } }).reason, 'OPERATING_SYSTEM_DID_NOT_ACCEPT_THE_SIGNATURE');
  assert.equal(productionVerdict({ status: 'signed', os: { ...good, timestamped: false } }).reason, 'NO_TIMESTAMP');
  // The throwaway certificate of the CI dry-run is trusted on that runner (the OS says Valid), but it is self-signed: plumbing only.
  const selfSigned = productionVerdict({ status: 'signed', os: { ...good, selfSigned: true } });
  assert.equal(selfSigned.ready, false); assert.equal(selfSigned.reason, 'SELF_SIGNED_CERTIFICATE');
  // The Windows verdict carries the new fields through, and a failing check is never "valid".
  const fake = stdout => () => ({ status: 0, stdout, stderr: '' });
  const json = JSON.stringify({ status: 'Valid', signer: 'CN=NVU PRO TESTE', issuer: 'CN=NVU PRO TESTE', selfSigned: true, timestamped: true });
  const parsed = verifySignature('x.exe', { platform: 'win32', run: fake(json) });
  assert.equal(parsed.valid, true); assert.equal(parsed.selfSigned, true); assert.equal(parsed.checked, 'windows');
  assert.equal(verifySignature('x.exe', { platform: 'win32', run: () => ({ status: 1, stdout: '', stderr: 'erro' }) }).valid, false);
});
