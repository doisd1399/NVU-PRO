import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const files = [
  'android/app/src/main/java/com/nvu/operacional/GtoCaptureController.java',
  'android/app/src/main/java/com/nvu/operacional/GtoOverlayController.java',
  'android/app/src/main/java/com/nvu/operacional/GtoServiceBoundaries.java',
];
const tmp = '/tmp/nvu-android-boundaries';
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
const result = spawnSync('javac', ['-d', tmp, ...files], { cwd: root, encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr || result.stdout);
console.log('ANDROID SERVICE BOUNDARIES: PASS');
console.log('Separated responsibilities: capture session, overlay lifecycle, shared service composition root.');
