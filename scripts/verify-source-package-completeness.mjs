import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
  'package.json',
  'package-lock.json',
  'android/app/build.gradle',
  'src/main.tsx',
  'src/lib/otaManager.ts',
  'src/lib/firebase.ts',
  'src/lib/liveUpdate.ts',
  'src/lib/liveUpdateStatus.ts',
  'src/lib/deployRecovery.ts',
  'src/lib/CanonicalTripStore.ts',
  'src/lib/offlineTripQueue.ts',
  'src/lib/tripManager.ts',
  'functions/package.json',
  'functions/package-lock.json',
  'functions/src/gtoTrips.ts',
  'functions/src/reconcileOperationTrips.ts',
  'functions/src/reconcileOperationProjectionOnTripWrite.ts',
  'functions/src/operationReconciliationPolicy.ts',
  'functions/src/legacyOperationTripRecovery.ts',
  'scripts/test-operation-finalization-regression.ts',
  'scripts/test-gto-operation-finalization-path.mjs',
  'scripts/test-operation-finalization-emulator.mjs',
  'scripts/test-operation-architecture-v4.mjs',
  'scripts/verify-ota-ready.mjs',
];

const missing = required.filter((rel) => !fs.existsSync(path.join(root, rel)));
if (missing.length) {
  console.error('SOURCE_PACKAGE_INCOMPLETE');
  for (const rel of missing) console.error(`MISSING ${rel}`);
  process.exit(1);
}

const libFiles = fs.readdirSync(path.join(root, 'src/lib')).filter((name) => name.endsWith('.ts'));
if (libFiles.length < 80) {
  console.error(`SOURCE_PACKAGE_INCOMPLETE src/lib contém apenas ${libFiles.length} arquivos TypeScript`);
  process.exit(1);
}

const gradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
const codeMatch = gradle.match(/versionCode\s+(\d+)/);
const nameMatch = gradle.match(/versionName\s+"([^"]+)"/);
const expectedCode = codeMatch ? Number(codeMatch[1]) : 0;
const expectedName = nameMatch ? nameMatch[1] : '';
if (!expectedCode || expectedName !== `1.0.${expectedCode}`) {
  console.error(`SOURCE_PACKAGE_VERSION_MISMATCH Android deve usar versionName 1.0.<versionCode>; encontrado ${expectedName || 'ausente'} / ${expectedCode || 'ausente'}`);
  process.exit(1);
}

const gto = fs.readFileSync(path.join(root, 'functions/src/gtoTrips.ts'), 'utf8');
const reconciler = fs.readFileSync(path.join(root, 'functions/src/reconcileOperationTrips.ts'), 'utf8');
if (!/reconcileOperationTripsCore/.test(gto) || !/operationReconciliationVersion:\s*4/.test(reconciler)) {
  console.error('SOURCE_PACKAGE_CANONICAL_FINALIZATION_MISSING');
  process.exit(1);
}

console.log(`SOURCE_PACKAGE_COMPLETENESS_PASS src/lib=${libFiles.length} arquivos; Android ${expectedName}/${expectedCode}; reconciliação v4 presente`);
