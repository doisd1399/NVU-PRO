// Command line understood by NVU PRO.exe. Only documented flags are honoured; everything else is ignored.
//   --nvu-no-dialogs              support/automation: never open message boxes; decisions go to the log and the exit code
//   --nvu-versions-out=<file>     write the real version report as JSON and exit (no window, no instance lock)
//   --nvu-elevated-plugin=<b64>   internal: elevated plugin copy requested by the running application (see elevated-plugin.cjs)
function parseCli(argv = []) {
  const out = { noDialogs: false, versionsOut: '', elevatedPlugin: '', raw: [] };
  for (const arg of argv) {
    if (typeof arg !== 'string' || !arg.startsWith('--nvu-')) continue;
    out.raw.push(arg.length > 64 ? arg.slice(0, 40) + '…' : arg);
    if (arg === '--nvu-no-dialogs') out.noDialogs = true;
    else if (arg.startsWith('--nvu-versions-out=')) out.versionsOut = arg.slice('--nvu-versions-out='.length);
    else if (arg.startsWith('--nvu-elevated-plugin=')) out.elevatedPlugin = arg.slice('--nvu-elevated-plugin='.length);
  }
  return out;
}
module.exports = { parseCli };
