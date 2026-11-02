const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('overlay',Object.freeze({
 command:(action,contextKey)=>ipcRenderer.invoke('nvu:overlay',{action,contextKey}),
 move:position=>ipcRenderer.invoke('nvu:overlay:move',position),
 onUpdate:callback=>{const listener=(_,value)=>callback(value);ipcRenderer.on('nvu:overlay:update',listener);return()=>ipcRenderer.removeListener('nvu:overlay:update',listener);}
}));
