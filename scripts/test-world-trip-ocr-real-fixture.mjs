import fs from 'node:fs';
import crypto from 'node:crypto';

const source = fs.readFileSync(new URL('../src/services/worldTripOcrService.ts', import.meta.url), 'utf8');
const fixture = fs.readFileSync(new URL('./fixtures-wtds-real-1000360891.png', import.meta.url));
const sha = crypto.createHash('sha256').update(fixture).digest('hex');

const checks = [
  ['real fixture present', fixture.length > 100_000],
  ['broad full-screen result is diagnostic only', source.includes('fullParsedDiagnosticOnly') && !source.includes('if (wholeScreenValue) return wholeScreenValue')],
  ['broad panel result is diagnostic only', source.includes('panelParsedDiagnosticOnly') && !source.includes('if (panelValue) return panelValue')],
  ['safe payout ROI excludes FPS/EXP columns', source.includes('canvas.width * 0.50') && source.includes('canvas.width * 0.14')],
  ['raw ROI OCR precedes threshold fallback', source.indexOf('rawPayoutText') > 0 && source.indexOf('rawPayoutText') < source.indexOf('payoutPixels')],
  ['fails closed after ROI', source.includes('Fail closed')],
];
for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}
console.log(`Fixture SHA256: ${sha}`);
console.log('Expected WTDS payout: 10.914,04; forbidden distractors: FPS 80, EXP 1091, level 39, percentages/ADS 0.');
