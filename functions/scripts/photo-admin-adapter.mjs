import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { collectPhotoCandidates, verifyPhotoUrl } from './photo-audit-core.mjs';

export const argument = (name, fallback = '') => process.argv.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
export const atomicJson = async (file, data) => { await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true }); await fs.writeFile(`${file}.tmp`, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); await fs.rename(`${file}.tmp`, file); };

export async function createPhotoAdminAdapter() {
  const require = createRequire(process.env.NVU_PHOTO_TOOLS_PACKAGE || import.meta.url);
  const { applicationDefault, getApps, initializeApp } = require('firebase-admin/app');
  const { FieldPath, getFirestore, Timestamp } = require('firebase-admin/firestore');
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'vtc-frota-log';
  const token = process.env.FIREBASE_ACCESS_TOKEN;
  const credential = token ? { getAccessToken: async () => ({ access_token: token, expires_in: 3600 }) } : applicationDefault();
  const app = getApps()[0] || initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId } : { projectId, credential });
  const db = getFirestore(app);
  async function list(collection, after = '', size = 250) {
    let query = db.collection(collection).orderBy(FieldPath.documentId()).limit(size);
    if (after) query = query.startAfter(after);
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }));
  }
  async function all(collection) {
    const records = []; let after = '';
    for (;;) { const page = await list(collection, after); records.push(...page.map(row => ({ ...row.data, id: row.id }))); if (page.length < 250) break; after = page.at(-1).id; }
    return records;
  }
  const [vehicles, companies, simulators, jobs] = await Promise.all(['veiculos', 'frotas', 'simuladores', 'trabalhos'].map(all));
  let sharp;
  try { sharp = require(process.env.NVU_IMAGE_DECODER_MODULE || 'sharp'); } catch { /* Report missing decoder; never mark unchecked bytes as verified. */ }
  const decode = sharp ? async bytes => {
    const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    await image.raw().toBuffer();
    return metadata;
  } : undefined;
  const allowedHosts = argument('--allowed-hosts', 'firebasestorage.googleapis.com,storage.googleapis.com,res.cloudinary.com').split(',').map(value => value.trim()).filter(Boolean);
  const origins = argument('--origins', 'https://localhost,http://localhost,capacitor://localhost').split(',').map(value => value.trim()).filter(Boolean);
  const checkedUrls = new Map();
  const verifyImage = async url => {
    if (!checkedUrls.has(url)) checkedUrls.set(url, (async () => {
      const first = await verifyPhotoUrl(url, { decode, allowedHosts, origins });
      const cors = first.cors ? [first.cors] : [];
      if (first.valid) for (const origin of origins.slice(1)) {
        const result = await verifyPhotoUrl(url, { decode, allowedHosts, origins: [origin] });
        cors.push(result.cors || { origin, allowed: false, code: result.code });
      }
      return { ...first, cors, untestedOrigins: [] };
    })());
    return checkedUrls.get(url);
  };
  return {
    projectId, db, vehicles, companies, simulators, jobs, all, verifyImage,
    listUsers: (after, size) => list('users', after, size),
    collect: user => collectPhotoCandidates(user.id, user.data, { vehicles, companies, simulators, jobs }),
    getProjection: async key => { const snapshot = await db.collection('rankingVehiclePhotos').doc(key).get(); return snapshot.exists ? snapshot.data() : null; },
    createProjection: (key, row) => db.collection('rankingVehiclePhotos').doc(key).create({ userId: row.userId, simulatorId: row.simulatorId, vehicleId: row.vehicleId, vehicleName: row.vehicleName, url: row.url, revision: row.revision || `migrated:${row.url}`, updatedAt: row.updatedAt || Timestamp.now(), migratedFrom: row.source, migrationVersion: '456-v3' }),
  };
}
