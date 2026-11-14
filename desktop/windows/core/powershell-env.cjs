// Windows PowerShell 5.1 (powershell.exe) started from a PowerShell 7 (pwsh) process inherits PowerShell 7's PSModulePath and then
// cannot load its own modules ("The 'Get-AuthenticodeSignature' command was found in the module Microsoft.PowerShell.Security, but the
// module could not be loaded"). Dropping the variable lets 5.1 compute its default path. Nothing changes when the parent is
// Explorer or a service (there is no PSModulePath to drop that matters). Found on a real Windows runner.
function windowsPowerShellEnv(base = process.env, extra = {}) {
  const env = { ...base, ...extra };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
  return env;
}
module.exports = { windowsPowerShellEnv };
