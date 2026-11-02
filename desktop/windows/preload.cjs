const { contextBridge, ipcRenderer } = require('electron');
const invoke = (method, input) => ipcRenderer.invoke('nvu:windows', { method, input });
contextBridge.exposeInMainWorld('nvuWindows', Object.freeze({
  version: 1, platform: 'windows',
  signIn: () => invoke('signIn'), restoreAuth: () => invoke('restoreAuth'), signOut: () => invoke('signOut'),
  syncScope: input => invoke('syncScope', input), start: input => invoke('start', input),
  status: () => invoke('status'), pause: () => invoke('pause'), stop: () => invoke('stop'),
  acknowledge: input => invoke('acknowledge', input), openGame: key => invoke('openGame', key),
  discoverGames: () => invoke('discoverGames'), selectGame: key => invoke('selectGame', key),
  installPlugin: input => invoke('installPlugin', input), removePlugin: input => invoke('removePlugin', input),
  showOverlay: () => invoke('showOverlay'), setTheme: value => invoke('setTheme', value), chooseGame: game => invoke('chooseGame', game),
  diagnose: key => invoke('diagnose', key), copyDiagnostics: key => invoke('copyDiagnostics', key),
  prepareSimulator: input => invoke('prepareSimulator', input), removeSimulatorPlugin: input => invoke('removeSimulatorPlugin', input),
  versions: () => invoke('versions'), copyStartupReport: () => invoke('copyStartupReport'), openLogs: () => invoke('openLogs'),
  onUpdate: callback => { const listener = (_, value) => callback(value); ipcRenderer.on('nvu:windows:update', listener);
    return () => ipcRenderer.removeListener('nvu:windows:update', listener); },
  onNavigate: callback => { const listener = (_, value) => callback(value); ipcRenderer.on('nvu:windows:navigate', listener);
    return () => ipcRenderer.removeListener('nvu:windows:navigate', listener); }
}));
