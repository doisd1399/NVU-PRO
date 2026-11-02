const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const include = path.join(__dirname, '../plugin/vendor/include');
const source = fs.readFileSync(path.join(__dirname, '../plugin/nvu_scs_telemetry.cpp'), 'utf8');
function headers(dir = include) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? headers(path.join(dir, e.name)) : e.name.endsWith('.h') ? [path.join(dir, e.name)] : []); }
const text = headers().map(f => fs.readFileSync(f, 'utf8')).join('\n');
// "#define NAME "value"" plus the "Type: x" line of the comment block right above it, exactly as written by SCS.
function sdkDefinition(name) {
  const lines = text.split('\n'), at = lines.findIndex(l => new RegExp(`^#define\\s+${name}\\s+"`).test(l));
  if (at < 0) return null;
  const value = lines[at].match(/"([^"]+)"/)[1];
  let type = null; for (let i = at - 1; i >= Math.max(0, at - 14) && !type; i--) type = lines[i].match(/\bType:\s*([a-z0-9]+)/)?.[1] || null;
  return { value, type };
}
// What the plugin assumes about each field. The test fails if the vendored SDK headers disagree.
const assumed = {
  SCS_TELEMETRY_CONFIG_ATTRIBUTE_source_city: 'string', SCS_TELEMETRY_CONFIG_ATTRIBUTE_destination_city: 'string',
  SCS_TELEMETRY_CONFIG_ATTRIBUTE_source_city_id: 'string', SCS_TELEMETRY_CONFIG_ATTRIBUTE_destination_city_id: 'string',
  SCS_TELEMETRY_CONFIG_ATTRIBUTE_cargo_id: 'string', SCS_TELEMETRY_CONFIG_ATTRIBUTE_source_company_id: 'string', SCS_TELEMETRY_CONFIG_ATTRIBUTE_destination_company_id: 'string',
  SCS_TELEMETRY_CONFIG_ATTRIBUTE_delivery_time: 'u32', SCS_TELEMETRY_CONFIG_ATTRIBUTE_planned_distance_km: 'u32',
  SCS_TELEMETRY_GAMEPLAY_EVENT_ATTRIBUTE_revenue: 's64', SCS_TELEMETRY_GAMEPLAY_EVENT_ATTRIBUTE_distance_km: 'float',
  SCS_TELEMETRY_TRUCK_CHANNEL_navigation_distance: 'float',
};
test('Todo identificador SCS usado pelo plugin existe nos headers oficiais empacotados (SDK 1.16 / API 1.01)', () => {
  const used = [...new Set(source.match(/SCS_TELEMETRY_[A-Za-z0-9_]+/g))].filter(n => !/^SCS_TELEMETRY_(VERSION|EVENT|CHANNEL_FLAG|CHANNEL_[a-z]+_value)/.test(n) && !/_VERSION_/.test(n));
  const named = used.filter(n => /(CONFIG_ATTRIBUTE_|GAMEPLAY_EVENT_|TRUCK_CHANNEL_|CONFIG_job$)/.test(n));
  assert(named.length >= 14, 'a análise precisa encontrar os campos usados');
  for (const name of named) assert(sdkDefinition(name), `${name} não está definido nos headers do SDK`);
});
test('Tipos assumidos pelo plugin conferem com a documentação (Type:) dos headers: strings, u32, s64 e float', () => {
  for (const [name, type] of Object.entries(assumed)) {
    const d = sdkDefinition(name); assert(d, `${name} ausente`); assert.equal(d.type, type, `${name}: o SDK documenta ${d.type}, o plugin assume ${type}`);
    assert(source.includes(name), `${name} deixou de ser usado: atualize o contrato`);
  }
  // The C++ must read each value with the accessor of the documented type.
  for (const name of Object.keys(assumed).filter(n => assumed[n] === 'string' && n.includes('CONFIG_ATTRIBUTE_'))) assert(new RegExp(`stringValue\\(c->attributes, ${name}\\)`).test(source), `${name} deve ser lido como string`);
  assert(/uintValue\(c->attributes, SCS_TELEMETRY_CONFIG_ATTRIBUTE_delivery_time\)/.test(source)); assert(/uintValue\(c->attributes, SCS_TELEMETRY_CONFIG_ATTRIBUTE_planned_distance_km\)/.test(source));
  assert(/revenue->type == SCS_VALUE_TYPE_s64/.test(source)); assert(/distance->type == SCS_VALUE_TYPE_float/.test(source));
  assert(/SCS_TELEMETRY_TRUCK_CHANNEL_navigation_distance, SCS_U32_NIL, SCS_VALUE_TYPE_float/.test(source));
});
test('Eventos oficiais usados: job.delivered e job.cancelled; receita em moeda nativa (EUR no ETS2, USD no ATS) conforme os headers do jogo', () => {
  assert.equal(sdkDefinition('SCS_TELEMETRY_GAMEPLAY_EVENT_job_delivered').value, 'job.delivered'); assert.equal(sdkDefinition('SCS_TELEMETRY_GAMEPLAY_EVENT_job_cancelled').value, 'job.cancelled');
  assert.match(text, /revenue in native game currency/); assert.match(text, /The game uses Euro as internal currency/); assert.match(text, /The game uses US Dolars as internal currency/);
  assert(source.includes('game == "ets2" ? "EUR" : "USD"'), 'moeda do plugin');
  const { validateEvent } = require('../core/session.cjs');
  const base = { version: 1, eventId: '0123456789abcdef0123456789abcdef0123', type: 'job.delivered', capturedAt: Date.now(), origin: 'A', destination: 'B', amountCents: 100, distanceKm: 5 };
  assert.equal(validateEvent({ ...base, simulatorKey: 'ets2', currency: 'EUR' }), true); assert.equal(validateEvent({ ...base, simulatorKey: 'ets2', currency: 'USD' }), false);
  assert.equal(validateEvent({ ...base, simulatorKey: 'ats', currency: 'USD' }), true); assert.equal(validateEvent({ ...base, simulatorKey: 'ats', currency: 'EUR' }), false);
});
test('O plugin só usa a API de telemetria 1.01 e informa a própria versão a partir de uma única definição', () => {
  assert(source.includes('SCS_TELEMETRY_VERSION_1_01')); assert(!/\b0\.1\.[0-9]\b/.test(source), 'sem versão fixa no código');
  assert(source.includes('NVU_PLUGIN_VERSION')); assert(/"pluginVersion\\":" \+ quote\(NVU_PLUGIN_VERSION\)/.test(source));
  const dll = fs.readFileSync(path.join(__dirname, '../plugin/bin/nvu_scs_telemetry.dll')); const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../plugin/bin/nvu_scs_telemetry.manifest.json'), 'utf8'));
  assert(dll.includes(Buffer.from(`[NVU PRO ${manifest.version}]`)), 'a DLL compilada carrega a versão do manifesto'); assert.equal(manifest.version, require('../package.json').nvu.pluginVersion);
});
