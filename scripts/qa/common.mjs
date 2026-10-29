import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
export const root = path.resolve(import.meta.dirname, '../..');
export const config = JSON.parse(fs.readFileSync(path.join(root, 'qa/config.json'), 'utf8'));
export function isolatedEnv(input = process.env) {
  const env = { ...input };
  for (const key of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','FIREBASE_CONFIG','GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','GOOGLE_CLOUD_QUOTA_PROJECT','CLOUDSDK_AUTH_ACCESS_TOKEN','RELEASE_STORE_FILE','RELEASE_STORE_PASSWORD','RELEASE_KEY_ALIAS','RELEASE_KEY_PASSWORD','FIREBASE_AUTH_EMULATOR_HOST','FIRESTORE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy']) delete env[key];
  return { ...env, GCLOUD_PROJECT: config.projectId, GOOGLE_CLOUD_PROJECT: config.projectId, FIREBASE_CLI_DISABLE_TELEMETRY: '1', NO_PROXY: 'localhost,127.0.0.1,::1', no_proxy: 'localhost,127.0.0.1,::1' };
}
export function sourceFingerprint(baseRoot = root) {
  const files = [];
  const walk = name => {
    const p = path.join(baseRoot, name); if (!fs.existsSync(p)) return;
    if (fs.statSync(p).isFile()) { files.push(name); return; }
    for (const e of fs.readdirSync(p, { withFileTypes: true })) if (!['node_modules','build','.gradle','results'].includes(e.name)) walk(path.posix.join(name, e.name));
  };
  ['AGENTS.md','index.html','tsconfig.json','firebase.json','canonical-runtime-contract.mjs','tests','src','public','functions/tsconfig.json','functions/scripts','functions/src','android/app/src/main/java','android/app/src/test','android/app/src/androidTest','android/app/src/androidTestQa','android/app/src/qa','android/app/src/main/AndroidManifest.xml','android/app/src/main/res','android/gradlew','android/gradlew.bat','android/gradle.properties','android/capacitor.settings.gradle','android/app/capacitor.build.gradle','android/build.gradle','android/variables.gradle','android/settings.gradle','android/gradle/wrapper/gradle-wrapper.properties','android/app/build.gradle','.github/workflows','NVU_RELEASE_METADATA.json','scripts','qa','firestore.rules','storage.rules','firestore.indexes.json','firebase.qa.json','package.json','package-lock.json','functions/package.json','functions/package-lock.json','capacitor.config.ts','vite.config.ts'].forEach(walk);
  const h = crypto.createHash('sha256');
  for (const name of files.sort()) h.update(name).update('\0').update(fs.readFileSync(path.join(baseRoot,name))).update('\0');
  return h.digest('hex');
}
export function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.new', JSON.stringify(value, null, 2) + '\n'); fs.renameSync(file + '.new', file);
}
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function run(command, args, { log, env = isolatedEnv(), timeoutMs = 120000 } = {}) {
  return new Promise(resolve => {
    const fd = fs.openSync(log, 'w'); let timedOut = false, error, settled = false;
    const child = spawn(command === 'npm' && process.platform === 'win32' ? 'npm.cmd' : command, args, { cwd: root, env, detached: process.platform !== 'win32', stdio: ['ignore', fd, fd] });
    const stop = () => { try { process.platform === 'win32' ? child.kill() : process.kill(-child.pid, 'SIGTERM'); } catch {} };
    const timer = setTimeout(() => { timedOut = true; stop(); const hard = setTimeout(() => { try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {} }, 3000); hard.unref(); }, timeoutMs);
    const interrupt = () => { error = 'Execução interrompida'; stop(); };
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    const finish = (code, signal) => { if (settled) return; settled = true; clearTimeout(timer); fs.closeSync(fd); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); resolve({ code, signal, timedOut, error }); };
    child.once('error', e => { error = e.code || e.message; finish(null, null); });
    child.once('close', finish);
  });
}
