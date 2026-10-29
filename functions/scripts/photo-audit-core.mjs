import { rankingVehiclePhotoDocumentKey, resolveVehiclePhotoOperationSimulatorEvidence, operationSelectionDriverId } from './generated/photo-domain.mjs';

export function collectPhotoCandidates(userId, data, { vehicles = [], companies = [], simulators = [], jobs = [] } = {}) {
  const rows = [];
  for (const source of ['vehiclePhotosV2', 'vehiclePhotos']) {
    for (const [sourceKey, record] of Object.entries(data?.[source] || {})) {
      const reject = (status) => rows.push({ userId, source, sourceKey, status });
      if (!record || typeof record !== 'object') { reject('REJECTED_NOT_OBJECT'); continue; }
      if (record.userId && record.userId !== userId) { reject('REJECTED_FOREIGN_OWNER'); continue; }
      const vehicleId = String(record.vehicleId || (source === 'vehiclePhotos' && vehicles.some(v => v.id === sourceKey) ? sourceKey : '')).trim();
      if (!vehicleId) { reject('REJECTED_VEHICLE_REQUIRED'); continue; }
      const recordIdentity = resolveVehiclePhotoOperationSimulatorEvidence(record, null, "", simulators, companies);
      if (recordIdentity.conflict) { reject('REJECTED_CONFLICT_SIMULATOR_FIELDS'); continue; }
      let simulatorId = recordIdentity.simulatorId;
      if (!simulatorId) {
        const vehicle = vehicles.find(v => v.id === vehicleId);
        const evidence = [vehicle, ...jobs.filter(j => (operationSelectionDriverId(j) || j.userId) === userId && (j.vehicleId || j.veiculoId) === vehicleId)].filter(Boolean);
        const resolved = new Set();
        let contradictory = false;
        for (const item of evidence) {
          const company = companies.find(c => c.id === (item.companyId || item.empresaId));
          const identity = resolveVehiclePhotoOperationSimulatorEvidence(item, company, '', simulators, companies);
          if (identity.conflict) contradictory = true;
          if (identity.simulatorId) resolved.add(identity.simulatorId);
        }
        // Never infer the simulator from a company name or truck model.
        if (contradictory || resolved.size !== 1) { reject('REJECTED_AMBIGUOUS_SIMULATOR'); continue; }
        simulatorId = [...resolved][0];
      }
      let url;
      try { url = new URL(record.url); if (url.protocol !== 'https:') throw new Error(); }
      catch { reject('REJECTED_INVALID_URL'); continue; }
      const row = { userId, simulatorId, vehicleId, vehicleName: String(record.vehicleName || ''), url: url.href, revision: String(record.revision || ''), updatedAt: record.updatedAt || null, source, sourceKey, status: 'CANDIDATE' };
      rows.push({ ...row, identityKey: rankingVehiclePhotoDocumentKey(row) });
    }
  }
  return rows;
}

export async function scanPhotoUsers(adapter, options = {}) {
  if (options.execute && !options.checkUrls) throw new Error('Execution requires image verification.');
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 100));
  let cursor = options.startAfter || '';
  const report = { dryRun: !options.execute, startedAt: new Date().toISOString(), pages: 0, usersScanned: 0, found: 0, verified: 0, wouldMigrate: 0, migrated: 0, alreadyPresent: 0, conflicts: 0, rejected: 0, lastCompletedUserId: cursor, decisions: [] };
  const decide = (row) => { report.decisions.push(row); options.onDecision?.(row); };
  for (;;) {
    const users = await adapter.listUsers(cursor, pageSize);
    if (!users.length) break;
    report.pages++;
    for (const user of users) {
      const rows = await adapter.collect(user);
      report.usersScanned++; report.found += rows.length;
      const byKey = new Map(), collisions = new Set();
      for (const row of rows) {
        if (row.status !== 'CANDIDATE') { report.rejected++; decide(row); continue; }
        const prior = byKey.get(row.identityKey);
        if (prior && prior.url !== row.url) { collisions.add(row.identityKey); byKey.delete(row.identityKey); report.conflicts++; decide({ identityKey: row.identityKey, status: 'CONFLICT_SOURCE_URLS', userId: user.id }); }
        else if (!collisions.has(row.identityKey) && (!prior || row.source === 'vehiclePhotosV2')) byKey.set(row.identityKey, row);
      }
      for (const row of byKey.values()) {
        const destination = await adapter.getProjection(row.identityKey);
        if (destination) {
          const equal = ['userId', 'simulatorId', 'vehicleId', 'url'].every(field => destination[field] === row[field]);
          const image = options.checkUrls ? await adapter.verifyImage(destination.url) : null;
          if (equal) report.alreadyPresent++; else report.conflicts++;
          decide({ identityKey: row.identityKey, userId: user.id, status: equal ? 'ALREADY_PRESENT' : 'CONFLICT_DESTINATION_NOT_OVERWRITTEN', image });
          continue;
        }
        const image = options.checkUrls ? await adapter.verifyImage(row.url) : { valid: false, code: 'URL_NOT_VERIFIED' };
        if (options.checkUrls && !image.valid) { report.rejected++; decide({ identityKey: row.identityKey, userId: user.id, status: 'REJECTED_IMAGE', image }); continue; }
        // Rendering an <img> does not prove fetch() can download/cache bytes
        // from a different viewer/origin. Do not mass-publish legacy URLs with
        // confirmed CORS failures while offline third-party ranking is required.
        if (options.checkUrls && image.cors?.some((origin) => origin.allowed === false)) {
          report.rejected++;
          decide({ identityKey: row.identityKey, userId: user.id, status: 'REJECTED_CORS', originCount: image.cors.length });
          continue;
        }
        if (image.valid) report.verified++;
        report.wouldMigrate++;
        if (options.execute) {
          // create() must enforce "does not exist" in the database itself.
          // A projection inserted after our read can never be overwritten.
          try { await adapter.createProjection(row.identityKey, row); report.migrated++; }
          catch (error) { if ([6, 'already-exists'].includes(error.code)) { report.conflicts++; decide({ identityKey: row.identityKey, status: 'CONCURRENT_DESTINATION_PRESERVED' }); continue; } throw error; }
        }
        decide({ identityKey: row.identityKey, userId: user.id, status: options.execute ? 'MIGRATED' : 'WOULD_MIGRATE', source: row.source, image });
      }
      // Only resume after a completely processed user. A crash within that
      // user safely repeats it; successful create() operations are idempotent.
      cursor = user.id; report.lastCompletedUserId = cursor;
      await adapter.checkpoint?.({ version: 1, lastCompletedUserId: cursor, execute: !!options.execute, usersScanned: report.usersScanned, migrated: report.migrated });
      await adapter.progress?.(report);
    }
    if (users.length < pageSize) break;
  }
  report.finishedAt = new Date().toISOString();
  return report;
}

export async function verifyPhotoUrl(url, { decode, fetcher = fetch, allowedHosts = ['firebasestorage.googleapis.com', 'storage.googleapis.com', 'res.cloudinary.com'], origins = ['https://localhost'], maxBytes = 10 * 1024 * 1024, timeoutMs = 15_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (!decode) return { valid: false, code: 'DECODER_UNAVAILABLE' };
    let target = new URL(url), response;
    for (let redirects = 0; redirects <= 4; redirects++) {
      if (target.protocol !== 'https:' || target.username || target.password || !allowedHosts.includes(target.hostname)) return { valid: false, code: 'URL_HOST_NOT_ALLOWED' };
      response = await fetcher(target.href, { redirect: 'manual', signal: controller.signal, headers: { Origin: origins[0] || 'https://localhost' } });
      if (response.status < 300 || response.status >= 400) break;
      await response.body?.cancel();
      if (!response.headers.get('location') || redirects === 4) return { valid: false, code: 'REDIRECT_INVALID' };
      target = new URL(response.headers.get('location'), target);
    }
    if (!response.ok) { await response.body?.cancel(); return { valid: false, code: `HTTP_${response.status}` }; }
    const type = (response.headers.get('content-type') || '').split(';')[0];
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(type) || Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); return { valid: false, code: 'CONTENT_INVALID' }; }
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) { bytes += chunk.length; if (bytes > maxBytes) { controller.abort(); return { valid: false, code: 'IMAGE_TOO_LARGE' }; } chunks.push(chunk); }
    const dimensions = await decode(Buffer.concat(chunks));
    if (!dimensions?.width || !dimensions?.height || !['jpeg', 'png', 'webp', 'gif', 'avif'].includes(dimensions.format) || dimensions.width * dimensions.height > 40_000_000) return { valid: false, code: 'DECODE_INVALID' };
    const allow = response.headers.get('access-control-allow-origin');
    return { valid: true, status: response.status, contentType: type, bytes, width: dimensions.width, height: dimensions.height, cors: { origin: origins[0] || 'https://localhost', allowed: allow === '*' || allow === origins[0], header: allow }, untestedOrigins: origins.slice(1) };
  } catch (error) { return { valid: false, code: controller.signal.aborted ? 'TIMEOUT' : 'DECODE_OR_DOWNLOAD_FAILED', message: error.message }; }
  finally { clearTimeout(timer); }
}
