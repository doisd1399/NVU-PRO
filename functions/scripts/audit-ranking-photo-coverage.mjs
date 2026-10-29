#!/usr/bin/env node
/** Complete read-only ranking coverage census, no production mutation. */
import { atomicJson, argument, createPhotoAdminAdapter } from './photo-admin-adapter.mjs';
import { auditRankingPhotoCoverage } from './photo-coverage-core.mjs';

if (process.argv.includes('--help')) {
  console.log('READ ONLY: node functions/scripts/audit-ranking-photo-coverage.mjs --report=ranking-photo-coverage.json [--check-urls] [--origins=https://localhost,http://localhost,capacitor://localhost]. Read-only access to Firebase project required. No IDs, image URLs, or tokens in report.');
  process.exit(0);
}
if (process.argv.some(v => ['--execute', '--write', '--deploy', '--migrate'].includes(v))) {
  throw new Error('This tool is strictly read-only; writing/deploy flags are prohibited.');
}
const adapter = await createPhotoAdminAdapter();
const users = await adapter.all('users');
const projections = await adapter.all('rankingVehiclePhotos');
const report = await auditRankingPhotoCoverage({
  users, jobs: adapter.jobs, companies: adapter.companies, simulators: adapter.simulators,
  vehicles: adapter.vehicles, projections,
}, {
  collect: user => adapter.collect({ id: user.id, data: user }),
  verifyImage: process.argv.includes('--check-urls') ? adapter.verifyImage : undefined,
});
const output = argument('--report', 'ranking-photo-coverage.json');
await atomicJson(output, { ...report, projectId: adapter.projectId, origin: 'READ_ONLY_FIREBASE',
  runtime: { cloudCredentialsUsed: true, modifiedRecords: 0, checkUrls: process.argv.includes('--check-urls') },
});
console.log(JSON.stringify({ output, users: report.usersScanned, expectedIdentities: report.expectedIdentities,
  actionableVerifiedLegacy: report.actionableVerifiedLegacy, counts: report.counts, writes: 0 }));
