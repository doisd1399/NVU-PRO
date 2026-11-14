const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { redact, redactDeep } = require('../core/redact.cjs');

test('Diagnostics redact the active home and POSIX/Windows profiles while retaining useful system paths', () => {
  const home = os.homedir();
  if (home.length > 1) assert(!JSON.stringify(redactDeep({ stack: `at ${home}/work/nvu/main.cjs:20`, nested: [`${home}/logs`] })).includes(home));
  for (const input of ['/home/qa-person/app/main.cjs', '/Users/qa-person/app/main.cjs', 'C:\\Users\\QA Person\\app\\main.cjs']) {
    const result = redact(input); assert(result.startsWith('%USERPROFILE%')); assert(!result.includes('qa-person')); assert(!result.includes('QA Person'));
  }
  assert.equal(redact('/usr/bin/node'), '/usr/bin/node');
  assert.equal(redact('https://example.test/support'), 'https://example.test/support');
});
