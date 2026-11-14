import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

// The compression worker must not depend on a CDN during offline uploads.
const require = createRequire(import.meta.url);
const moduleFile = require.resolve('browser-image-compression');
const vendor = path.resolve('public/vendor');
await mkdir(vendor, { recursive: true });
await copyFile(moduleFile, path.join(vendor, 'browser-image-compression.js'));
await copyFile(path.resolve(path.dirname(moduleFile), '../LICENSE'), path.join(vendor, 'browser-image-compression.LICENSE'));
console.log('Local vehicle-photo compression worker prepared.');
