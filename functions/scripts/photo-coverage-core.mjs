/**
 * Global, read-only vehicle-photo coverage census.
 * Never export Firebase document IDs or tokenized Storage URLs in the public report.
 * It is deliberately separate from the migration writer, which requires explicit flags.
 */
import {
  rankingVehiclePhotoDocumentKey, operationSelectionDriverId,
  operationAssignmentTimestamp, selectCurrentOperationJob,
  resolveVehiclePhotoOperationSimulatorEvidence,
} from './generated/photo-domain.mjs';

const usableOperation = job => {
  const state = String(job.status || '').trim().toLowerCase();
  if (['cancelled', 'canceled', 'invalid', 'rejected', 'deleted'].includes(state)) return false;
  return !!(job.vehicleId || job.veiculoId) && (
    ['active', 'awaiting_completion', 'delayed', 'completed', 'in_progress'].includes(state)
    || job.startedAt || job.completedAt || job.started_at || job.completed_at
  );
};

const id = value => String(value || '').trim();
const count = (table, name) => { table[name] = (table[name] || 0) + 1; };
const normalizedPhoto = source => source && typeof source === 'object' && source.url && /^https:\/\//.test(source.url);
const sortNewest = (a,b) => operationAssignmentTimestamp(b) - operationAssignmentTimestamp(a) || id(b.id).localeCompare(id(a.id));

function simulatorForOperation(job, companies, simulators, byCompany, byVehicle) {
  const company = byCompany.get(id(job.companyId || job.empresaId));
  const vehicle = byVehicle.get(id(job.vehicleId || job.veiculoId));
  // All explicit fields, including those on a *single* source, must agree.
  // A missing field is not equivalent to a contradictory field.
  return resolveVehiclePhotoOperationSimulatorEvidence(job, company, '', simulators, companies, [vehicle]);
}

/** Find per-simulator current-or-last-operated vehicle, not simply newest job across all simulators. */
export function expectedRankingVehiclePhotos(userId, jobs, companies = [], simulators = [], vehicles = []) {
  const byCompany = new Map(companies.map(row => [id(row.id), row]));
  const byVehicle = new Map(vehicles.map(row => [id(row.id), row]));
  const scoped = new Map();
  const unresolved = [];
  for (const job of jobs) {
    if (id(operationSelectionDriverId(job) || job.userId) !== id(userId) || !usableOperation(job)) continue;
    const { simulatorId, conflict } = simulatorForOperation(job, companies, simulators, byCompany, byVehicle);
    if (conflict || !simulatorId) {
      unresolved.push({ code: conflict ? 'CONFLICT_SIMULATOR_CONTEXT' : 'OPERATION_SIMULATOR_UNRESOLVED' });
      continue;
    }
    if (!scoped.has(simulatorId)) scoped.set(simulatorId, []);
    scoped.get(simulatorId).push({ ...job, driverId: userId });
  }
  const expected = [];
  for (const [simulatorId, group] of scoped) {
    const latest = (selectCurrentOperationJob(group, userId) || group.sort(sortNewest)[0]);
    if (!latest) continue;
    const vehicleId = id(latest.vehicleId || latest.veiculoId);
    if (!vehicleId) continue;
    expected.push({ userId, simulatorId, vehicleId, identityKey: rankingVehiclePhotoDocumentKey({ userId, simulatorId, vehicleId }) });
  }
  return { expected, unresolved };
}

function legacyForKey(rows, expected) {
  const rowsForKey = rows.filter(row => row.status === 'CANDIDATE' && row.identityKey === expected.identityKey);
  if (!rowsForKey.length) return null;
  if (new Set(rowsForKey.map(row => row.url)).size > 1) return { conflict: true };
  return rowsForKey[0];
}

function anyForeignSimulatorPhoto(rows, projections, expected) {
  return rows.some(row => row.userId === expected.userId && row.vehicleId === expected.vehicleId
    && row.simulatorId && row.simulatorId !== expected.simulatorId)
    || projections.some(row => row.userId === expected.userId && row.vehicleId === expected.vehicleId
      && row.simulatorId && row.simulatorId !== expected.simulatorId);
}

/**
 * @param {Object} sources Firebase read-only snapshots (or test fixtures)
 * @param {Object} options optional async verifyImage(url), no writes
 */
export async function auditRankingPhotoCoverage(sources, options = {}) {
  const users = sources.users || [], jobs = sources.jobs || [], companies = sources.companies || [];
  const simulators = sources.simulators || [], projections = sources.projections || [], vehicles = sources.vehicles || [];
  const candidateForUser = options.collect || (() => []);
  const verifyImage = options.verifyImage;
  const projectionsByKey = new Map(projections.map(p => [p.id, p]));
  const jobsByOwner = new Map();
  for (const job of jobs) {
    const owner = id(operationSelectionDriverId(job) || job.userId);
    if (!owner) continue;
    if (!jobsByOwner.has(owner)) jobsByOwner.set(owner, []);
    jobsByOwner.get(owner).push(job);
  }
  const summary = {
    schemaVersion: 2, readOnly: true, generatedAt: new Date().toISOString(),
    verification: verifyImage ? 'download-and-decode' : 'metadata-only',
    usersScanned: users.length, jobsScanned: jobs.length, projectionsScanned: projections.length,
    expectedIdentities: 0, unresolvedOperations: 0, usersWithoutRelevantOperation: 0,
    counts: {}, bySimulator: {}, cases: [],
    caveats: [
      'A ausência de bytes apenas locais não pode ser determinada pelo Firebase.',
      'A leitura administrativa não substitui a validação de permissões pelo segundo usuário.',
      'Nenhuma fotografia é migrada ou alterada por esta auditoria.',
    ],
  };
  const add = (simulatorId, status, detail = '') => {
    count(summary.counts, status);
    const simulator = ['gto','wtds','wbds','toe3','ets2','ats','pbs'].includes(simulatorId) ? simulatorId : simulatorId ? 'other_simulator' : 'unresolved';
    summary.bySimulator[simulator] ||= {};
    count(summary.bySimulator[simulator], status);
    // Case number is a local ordinal, never the database's userId, documentId or a URL.
    summary.cases.push({ case: `C${String(summary.cases.length + 1).padStart(6, '0')}`, simulator, status, ...(detail ? { detail } : {}) });
  };
  for (const user of users) {
    const userId = id(user.id);
    const { expected, unresolved } = expectedRankingVehiclePhotos(userId, jobsByOwner.get(userId) || [], companies, simulators, vehicles);
    const legacy = candidateForUser(user);
    if (!expected.length && !unresolved.length) {
      // Not a photographic failure proof: a user may never have ranked. Keep
      // this count visible so zero expected identities cannot look like 100% coverage.
      summary.usersWithoutRelevantOperation++;
      add('', 'NO_RANKING_VEHICLE_OPERATION');
    }
    for (const row of unresolved) { summary.unresolvedOperations++; add('', row.code); }
    for (const identity of expected) {
      summary.expectedIdentities++;
      const projection = projectionsByKey.get(identity.identityKey);
      let status;
      if (projection) {
        if (id(projection.userId) !== identity.userId || id(projection.simulatorId) !== identity.simulatorId || id(projection.vehicleId) !== identity.vehicleId) {
          status = 'PROJECTION_IDENTITY_MISMATCH';
        } else if (!normalizedPhoto(projection)) {
          status = 'PROJECTION_INVALID_URL';
        } else if (verifyImage) {
          const result = await verifyImage(projection.url);
          status = !result.valid ? `PROJECTION_IMAGE_${result.code || 'INVALID'}`
            : result.cors?.some(c => c.allowed === false) ? 'PROJECTION_CORS_BLOCKED' : 'PROJECTION_VERIFIED';
        } else status = 'PROJECTION_PRESENT_UNVERIFIED';
      } else {
        const candidate = legacyForKey(legacy, identity);
        if (candidate?.conflict) status = 'CONFLICT_LEGACY_SOURCES';
        else if (candidate) {
          if (verifyImage) {
            const result = await verifyImage(candidate.url);
            status = result.valid ? 'LEGACY_VERIFIED_NOT_PROJECTED' : `LEGACY_IMAGE_${result.code || 'INVALID'}`;
          } else status = 'LEGACY_UNVERIFIED_NOT_PROJECTED';
        } else if (anyForeignSimulatorPhoto(legacy, projections, identity)) status = 'DIFFERENT_SIMULATOR_REFERENCE_REVIEW';
        else status = 'PHOTO_REFERENCE_MISSING';
      }
      add(identity.simulatorId, status);
    }
  }
  const claimed = new Set(summary.cases.map(x => x.case));
  if (claimed.size !== summary.cases.length) throw new Error('CENSUS_CASE_SEQUENCE_INCONSISTENT');
  summary.actionableVerifiedLegacy = summary.counts.LEGACY_VERIFIED_NOT_PROJECTED || 0;
  summary.pendingPhotoValidation = summary.counts.LEGACY_UNVERIFIED_NOT_PROJECTED || 0;
  summary.remainingUnrecoverableOrUnresolved = Object.entries(summary.counts)
    .filter(([key]) => /MISSING|UNRESOLVED|CONFLICT|REVIEW|INVALID|HTTP_|DECODER_UNAVAILABLE/.test(key))
    .reduce((sum, [,value]) => sum + value, 0);
  return summary;
}
