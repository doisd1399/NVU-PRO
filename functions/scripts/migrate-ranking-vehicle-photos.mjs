#!/usr/bin/env node
import fs from 'node:fs/promises';
import { scanPhotoUsers } from './photo-audit-core.mjs';
import { argument, atomicJson, createPhotoAdminAdapter } from './photo-admin-adapter.mjs';

if (process.argv.includes('--help')) {
  console.log('Dry-run: node functions/scripts/migrate-ranking-vehicle-photos.mjs --check-urls --report=report.json\nExecution requires --execute --ack-metadata-only --check-urls. Resume: --resume=checkpoint.json. --page-size controls pagination; every page is processed. Uses ADC or FIREBASE_ACCESS_TOKEN. Install sharp in functions for actual decode validation.');
  process.exit(0);
}
const execute = process.argv.includes('--execute'), checkUrls = process.argv.includes('--check-urls');
if (execute && (!checkUrls || !process.argv.includes('--ack-metadata-only'))) throw new Error('Writing requires --execute --ack-metadata-only --check-urls.');
const reportPath = argument('--report', 'ranking-photo-migration.json');
const checkpointPath = argument('--checkpoint', `${reportPath}.checkpoint.json`);
const resumePath = argument('--resume');
const resume = resumePath ? JSON.parse(await fs.readFile(resumePath, 'utf8')) : null;
if (resume && (resume.version !== 1 || resume.execute !== execute)) throw new Error('Checkpoint mode/version differs from this execution. Start a fresh run.');
const adapter = await createPhotoAdminAdapter();
if (resume?.projectId && resume.projectId !== adapter.projectId) throw new Error('Checkpoint belongs to another Firebase project.');
adapter.checkpoint = value => atomicJson(checkpointPath, { ...value, projectId: adapter.projectId });
adapter.progress = report => atomicJson(`${reportPath}.partial.json`, { ...report, projectId: adapter.projectId });
try {
  const report = await scanPhotoUsers(adapter, { execute, checkUrls, pageSize: argument('--page-size', argument('--limit', '100')), startAfter: resume?.lastCompletedUserId || argument('--start-after') });
  await atomicJson(reportPath, { ...report, projectId: adapter.projectId, checkpointPath });
  console.log(JSON.stringify({ reportPath, dryRun: report.dryRun, usersScanned: report.usersScanned, migrated: report.migrated, conflicts: report.conflicts, rejected: report.rejected }));
} catch (error) { await atomicJson(`${reportPath}.failure.json`, { projectId: adapter.projectId, error: error.message, checkpointPath, resumable: true }); throw error; }
