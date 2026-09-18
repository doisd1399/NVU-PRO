import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const plugin = read('android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java');
const service = read('android/app/src/main/java/com/nvu/operacional/GtoObserverService.java');
const main = read('android/app/src/main/java/com/nvu/operacional/MainActivity.java');
const launcher = read('src/services/gtoWorkLauncher.ts');
const dashboard = read('src/pages/driver/Dashboard.tsx');
const profile = read('src/pages/driver/Profile.tsx');
const record = read('src/pages/driver/RecordTrip.tsx');
const gradle = read('android/app/build.gradle');

const checks = [];
const check = (name, ok) => { checks.push({name, ok}); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`); };

check('R3.9+ version remains at or above v1.0.29', Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0) >= 29 && Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/) || [])[1] || 0) >= 29);
check('initial capture consent is hosted by Capacitor activity', plugin.includes('@ActivityCallback') && plugin.includes('startActivityForResult(call, captureIntent, "screenCaptureResult")'));
check('Android14 initial capture uses default display config', plugin.includes('MediaProjectionConfig.createConfigForDefaultDisplay()'));
check('initial flow cannot open GTO before projection', launcher.indexOf('requestScreenCapture()') > 0 && launcher.indexOf('requestScreenCapture()') < launcher.indexOf('openGto()') && launcher.includes('if (!status.projectionActive)'));
check('denied initial capture is explicit and blocks GTO', launcher.includes('screen-capture-denied') && dashboard.includes('screen-capture-denied') && profile.includes('screen-capture-denied') && record.includes('screen-capture-denied'));
check('in-game recovery no longer launches transparent permission root task', service.includes('new Intent(this, MainActivity.class)') && !service.slice(service.indexOf('private void requestProjectionPermission()'), service.indexOf('private void scheduleBubbleRestoreAfterPermission()')).includes('GtoProjectionPermissionActivity.class'));
check('in-game recovery requests automatic return to GTO', service.includes('EXTRA_RETURN_TO_GTO_AFTER_PROJECTION') && main.includes('reopenGtoWhenProjectionReady'));
check('GTO return waits for projectionActive', main.includes('boolean active = prefs.getBoolean("projectionActive", false)') && main.indexOf('boolean active = prefs.getBoolean("projectionActive", false)') < main.indexOf('getLaunchIntentForPackage'));
check('permission denial never auto-opens GTO', main.includes('if (granted && returnToGtoAfterProjection)') && main.includes('else if (!granted)'));
check('bubble restore has slow-OEM bounded retries', service.includes('1400L') && service.includes('2600L') && service.includes('restoreBubbleAfterPermission(true)'));
check('permission latch is synchronized with live service', plugin.includes('markProjectionPermissionInFlightIfRunning') && service.includes('public static boolean markProjectionPermissionInFlightIfRunning()'));
check('MediaProjection result still enters existing service contract', plugin.includes('ACTION_START_PROJECTION') && main.includes('ACTION_START_PROJECTION') && service.includes('startProjection(resultCode, resultData)'));

const passed = checks.filter((x) => x.ok).length;
console.log(`\n${passed}/${checks.length} R3.9 projection/OEM hotfix checks passed.`);
if (passed !== checks.length) process.exit(1);
