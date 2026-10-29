import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {computeSourceFingerprint} from './source-fingerprint.mjs';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const pkg=read('package.json'),metadata=read('NVU_RELEASE_METADATA.json'),web=read('dist/nvu-build.json'),native=read('android/app/src/main/assets/public/nvu-build.json');
assert.equal(pkg.version,'2.3.181');assert.equal(metadata.androidVersionCode,503);assert.equal(metadata.androidVersion,'1.0.503');
const hash=await computeSourceFingerprint(process.cwd());
for(const manifest of [web,native]){assert.equal(manifest.version,pkg.version);assert.equal(manifest.sourceSha256,hash);assert.equal(manifest.otaEnabled,false);assert.equal(manifest.nativeBundleImmutable,true);assert.equal(manifest.capacitorRuntime,'local');}
assert.match(fs.readFileSync('android/app/build.gradle','utf8'),/versionCode 503\s+versionName "1\.0\.503"/);
assert.equal(read('android/app/src/main/assets/capacitor.config.json').plugins.LiveUpdate.defaultChannel,'production-503');
execFileSync(process.execPath,['scripts/verify-capacitor-assets.mjs'],{stdio:'inherit'});
const report={status:'PASS',sourceSha256:hash,webVersion:pkg.version,androidVersion:metadata.androidVersion,webAndEmbeddedAssetsVerified:true,androidGoogleConfigurationPresent:fs.existsSync('android/app/google-services.json'),apkBuilt:false,productionChanged:false};
fs.writeFileSync('reports/local-bundle-503-verification.json',JSON.stringify(report,null,2)+'\n');
console.log('LOCAL_BUNDLE_503_PASS — source/dist/embedded parity; APK preflight remains separate.');
