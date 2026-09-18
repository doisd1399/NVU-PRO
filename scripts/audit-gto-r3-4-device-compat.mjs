import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const service = read('android/app/src/main/java/com/nvu/operacional/GtoObserverService.java');
const fast = read('android/app/src/main/java/com/nvu/operacional/GtoFastVisualDetector.java');
const plugin = read('android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java');
const sync = read('android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java');
const gradle = read('android/app/build.gradle');
const pkg = JSON.parse(read('package.json'));

let passed = 0;
let failed = 0;
function check(name, ok) {
  if (ok) { console.log(`OK   ${name}`); passed++; }
  else { console.error(`FAIL ${name}`); failed++; }
}

check('R3.4+ versionCode >= 24', Number((gradle.match(/versionCode\s+(\d+)/)||[])[1]||0) >= 24);
check('R3.4+ versionName >= 1.0.24', Number(((gradle.match(/versionName\s+"1\.0\.(\d+)"/)||[])[1]||0)) >= 24);
check('fast detector probes multiple horizontal button bands', fast.includes('{0.750f, 0.865f}') && fast.includes('{0.910f, 0.994f}'));
check('bitmap detector probes the same adaptive bands', service.includes('{0.750f, 0.865f}') && service.includes('detectAcceptButtonRectsInBand'));
check('page signature follows detected button geometry', fast.includes('panelSignature(buffer, pixelStride, rowStride, width, height, buttons)'));
check('panel snapshot left edge follows detected buttons', (service.match(/freightPanelLeftForButtons/g) || []).length >= 4);
check('precise OCR crop follows selected button X', service.includes('button.left - Math.round(captureWidth * 0.245f)'));
check('fixed precise-row right cutoff was removed', !service.includes('line.rect.centerX() > captureWidth * 0.918f'));
check('new freight page clears previous textual cache', service.includes('Nova página de fretes detectada · cache textual anterior descartado'));
check('same-page text fallback is generation gated', service.includes('textGeneration != freightPageGeneration'));
check('critical km/value disagreement fails closed', service.includes('hasCriticalFreightConflict') && service.includes('duas leituras da mesma linha divergiram'));
check('passive OEM fallback requires stronger row evidence', service.includes('strongPassive') && service.includes('missingButtonSignal'));
check('SystemUI is always ignored as transient foreground', service.includes('"com.android.systemui".equals(p)'));
check('GTO background lifecycle is tracked on older/newer Android', service.includes('MOVE_TO_BACKGROUND') && service.includes('ACTIVITY_PAUSED') && service.includes('lastGtoBackgroundEventAt'));
check('detached bubble self-heals', service.includes('!bubbleView.isAttachedToWindow()') && service.includes('restaurando'));
check('touch pulse sensor failures are no longer silent', service.includes('touchPulseSensorError') && service.includes('confirmação visual reforçada'));
check('capture size/API diagnostics are persisted', service.includes('captureAndroidApi') && service.includes('captureDensityDpi'));
check('native status exposes device/layout diagnostics', plugin.includes('freightButtonBandLeft') && plugin.includes('lastFreightConflict') && plugin.includes('foregroundPackage'));
check('senior navigation validator is preserved in Capacitor package', pkg.scripts?.['validate:senior-navigation'] === 'node scripts/validate-senior-navigation.mjs');
check('cap sync executes R3.4 and senior audits', String(pkg.scripts?.['cap:sync:android']).includes('audit:gto-r3.4') && String(pkg.scripts?.['cap:sync:android']).includes('validate:senior-navigation'));

check('fast detector refines real horizontal button bounds', fast.includes('refineButtonHorizontalBounds'));
check('bitmap fallback refines real horizontal button bounds', service.includes('refineBitmapButtonHorizontalBounds'));
check('generic freight OCR crop follows current detected layout', service.includes('freightOcrLeftForCurrentLayout'));
check('page-number OCR region follows detected button column', service.includes('pageLeft') && service.includes('pageRight') && service.includes('freightButtonBandLeft'));
check('outside-touch row fallback follows detected button column', service.includes('rightSideThreshold') && service.includes('detectedButtonLeft'));
check('native UID mismatch is surfaced instead of silently stalling queue', sync.includes('DRIVER_UID_MISMATCH') && sync.includes('A sessão autenticada não corresponde ao motorista'));
check('missing native auth is explicitly diagnosable', sync.includes('NO_NATIVE_AUTH') && sync.includes('gtoTripSyncLastAttemptAt'));
check('pending completed delivery displays preserved/error state', service.includes('Registro preservado no aparelho') && service.includes('STATUS_PENDING'));
check('plugin exposes sync diagnostic code/timestamp', plugin.includes('gtoTripSyncLastAttemptAt') && plugin.includes('gtoTripSyncLastErrorCode'));

// Numeric geometry sanity: every representative Aceitar X position from 75%-99%
// must overlap at least one adaptive scan band. This models shifted HUD layouts across
// common landscape aspect ratios without tying the detector to a single pixel width.
const bands = [
  [0.910, 0.994], [0.885, 0.975], [0.855, 0.950],
  [0.825, 0.925], [0.790, 0.895], [0.750, 0.865],
];
for (const x of [0.93, 0.90, 0.87, 0.84, 0.81, 0.78]) {
  check(`adaptive band covers button center x=${x.toFixed(2)}`, bands.some(([l, r]) => x >= l && x <= r));
}

// Verify that the dynamic text ROI stays left of the button across representative widths.
for (const width of [1280, 1600, 1920, 2340, 2400, 2712, 3200]) {
  const buttonLeft = Math.round(width * 0.84);
  const panelLeft = Math.max(Math.round(width * 0.40), buttonLeft - Math.round(width * 0.30));
  const textLeft = Math.max(panelLeft, buttonLeft - Math.round(width * 0.245));
  check(`dynamic OCR ROI valid at ${width}px`, panelLeft >= 0 && textLeft >= panelLeft && textLeft < buttonLeft);
}

console.log(`\n${passed}/${passed + failed} R3.4 device/layout compatibility checks passed.`);
if (failed) process.exit(1);
