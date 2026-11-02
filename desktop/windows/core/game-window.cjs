
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const processes = Object.freeze({ ats: 'amtrucks', ets2: 'eurotrucks2' });
function focusScript(key) {
  if (!Object.hasOwn(processes, key)) throw Error('GAME_INVALID');
  return `$ErrorActionPreference='Stop'; Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class NvuGameWindow {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
}
'@; $p=Get-Process -Name '${processes[key]}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1;
if (!$p) { @{found=$false;focused=$false} | ConvertTo-Json -Compress; exit 0 };
$h=$p.MainWindowHandle; if ([NvuGameWindow]::IsIconic($h)) { $null=[NvuGameWindow]::ShowWindow($h,9) };
@{found=$true;focused=[NvuGameWindow]::SetForegroundWindow($h)} | ConvertTo-Json -Compress;`;
}
async function focusGameWindow(key, run = execute) {
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(focusScript(key), 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 5000, maxBuffer: 16384, encoding: 'utf8' });
  const result = JSON.parse(stdout.trim());
  if (!result || typeof result.found !== 'boolean' || typeof result.focused !== 'boolean') throw Error('GAME_WINDOW_RESPONSE_INVALID');
  return result;
}
module.exports = { focusGameWindow, focusScript };

