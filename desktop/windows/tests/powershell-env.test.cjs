const test = require('node:test');
const assert = require('node:assert/strict');
const { windowsPowerShellEnv } = require('../core/powershell-env.cjs');

test('Windows PowerShell 5.1 aberto por um pwsh 7 não herda o PSModulePath do PowerShell 7 (senão não carrega os próprios módulos)', () => {
  const env = windowsPowerShellEnv({ PSModulePath: 'C:\\Program Files\\PowerShell\\7\\Modules', Path: 'C:\\Windows', SystemRoot: 'C:\\Windows' }, { NVU_X: '1' });
  assert.equal('PSModulePath' in env, false); assert.deepEqual({ Path: env.Path, SystemRoot: env.SystemRoot, NVU_X: env.NVU_X }, { Path: 'C:\\Windows', SystemRoot: 'C:\\Windows', NVU_X: '1' });
});
test('a remoção do PSModulePath ignora maiúsculas/minúsculas (o ambiente do Windows não distingue) e não altera o objeto original', () => {
  const base = { psmodulepath: 'x', KEEP: 'y' }; const env = windowsPowerShellEnv(base);
  assert.deepEqual(env, { KEEP: 'y' }); assert.equal(base.psmodulepath, 'x');
});
