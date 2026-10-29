const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const bundles = [
  'ensureRankingAggregates_v15',
  'registerGtoTrip_v18',
  'authenticateSeniorAccess_v10',
  'syncGtoTripState_v10',
];

for (const bundle of bundles) {
  const source = fs.readFileSync(
    path.join(root, 'backend_source', 'source_bundles', bundle, 'src', 'rankingAggregates.ts'),
    'utf8',
  );
  const compiled = fs.readFileSync(
    path.join(root, 'backend_source', 'source_bundles', bundle, 'lib', 'rankingAggregates.js'),
    'utf8',
  );

  assert.match(source, /const SCHEMA_VERSION = 4/);
  assert.match(source, /RANKING_TIME_ZONE/);
  assert.match(source, /RANKING_PERIOD_POLICY/);
  assert.match(source, /v\$\{SCHEMA_VERSION\}__/);
  assert.match(source, /historico_viagens/);
  assert.match(source, /exclude_missing_or_ineligible_frotas/);
  assert.match(source, /missing_frotas/);
  assert.match(source, /ineligible_frotas/);
  assert.match(compiled, /exclude_missing_or_ineligible_frotas/);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.projectRevision, 'V36.4');
assert.equal(pkg.rankingContract, 'v4__<simulatorId>__<periodKey>');
assert.equal(pkg.rankingCalendarPolicy, 'SAO_PAULO_CALENDAR');
assert.equal(pkg.rankingTimeZone, 'America/Sao_Paulo');

console.log(`ETAPA36.4 RANKING CONTRACT PASS (${bundles.length} synchronized backend bundles)`);
