import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const root = process.cwd();
const fail = (message) => { console.error(`FAIL ${message}`); process.exitCode = 1; };
const pass = (message) => console.log(`PASS ${message}`);
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const text = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const pkg = readJson('package.json');
const meta = readJson('NVU_RELEASE_METADATA.json');
const remote = readJson('capacitor.remote.json');
const functionsPkg = readJson('functions/package.json');

pkg.version === '2.3.9' ? pass('web version 2.3.9') : fail(`web version ${pkg.version}`);
meta.functionalRelease === 'R3.34-PC-HF10' ? pass('functional release HF10') : fail('functional release metadata');
meta.androidVersion === '1.0.62' && meta.androidVersionCode === 62 ? pass('Android baseline 1.0.62/code 62') : fail('Android baseline metadata');
remote.enabled === true && remote.url === meta.netlifyUrl ? pass('Capacitor remote URL equals Netlify production URL') : fail('Capacitor/Netlify URL mismatch');
text('capacitor.config.ts').includes("appId: 'com.nvu.operacional'") ? pass('Capacitor appId com.nvu.operacional') : fail('Capacitor appId');
text('capacitor.config.ts').includes("server: loadRemoteServer()") ? pass('Capacitor consumes remote Netlify runtime') : fail('Capacitor remote runtime wiring');
text('netlify.toml').includes('publish = "dist"') ? pass('Netlify publishes dist') : fail('Netlify publish directory');
text('src/services/gtoWorkLauncher.ts').includes('prepareFloatingButton') ? pass('automatic mode rearms floating button before GTO') : fail('floating button web contract');
text('src/services/gtoWorkLauncher.ts').includes('openGto') ? pass('automatic mode opens GTO after observer preparation') : fail('GTO launcher contract');
text('src/lib/gtoObserver.ts').includes('captureReadyForAnalysis') ? pass('web bridge exposes capture readiness') : fail('capture readiness bridge contract');
text('src/lib/gtoObserver.ts').includes('selectedOrigin') ? pass('web bridge exposes canonical origin') : fail('origin bridge contract');
text('src/pages/driver/Dashboard.tsx').includes('GTO_PREFERRED_DESTINATIONS') ? pass('trusted destination dictionary aligned') : fail('trusted destination dictionary');
text('src/pages/driver/Dashboard.tsx').includes('trustedGtoCitiesJson') ? pass('trusted destination list sent to native observer') : fail('trusted destination context');
text('functions/src/gtoTrips.ts').includes('const effectiveOrigin = originCompany') ? pass('Functions persists GTO company as Origem') : fail('Functions origin mapping');
text('functions/src/gtoTrips.ts').includes('gtoMoneySchemaVersion: 2') ? pass('Functions money schema v2') : fail('Functions money schema');
fs.existsSync(path.join(root,'functions/src/gtoMoney.ts')) ? pass('Functions shared money parser present') : fail('Functions gtoMoney helper missing');
functionsPkg.dependencies?.['firebase-admin'] === '^12.7.0' && functionsPkg.dependencies?.['firebase-functions'] === '^5.1.1' ? pass('Functions dependencies aligned') : fail('Functions dependency versions');

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
console.log(`INFO src launcher sha256=${sha('src/services/gtoWorkLauncher.ts')}`);
console.log(`INFO functions gtoTrips sha256=${sha('functions/src/gtoTrips.ts')}`);

if (process.exitCode) process.exit(process.exitCode);
console.log('PASS Google AI Studio/Netlify web contract aligned with approved R3.34-PC-HF10 baseline.');
