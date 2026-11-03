const {clampBounds}=require('./games.cjs');
const PANEL_WIDTH=400,PANEL_HEIGHT=560,NOTICE_WIDTH=480,NOTICE_HEIGHT=172;
class OverlayController{
 constructor({createWindow,displays,cursor,save,actions,now=Date.now,savedBounds,onVisibility=()=>{}}){
  Object.assign(this,{createWindow,displays,cursor,save,actions,now,onVisibility});
  this.savedBounds=savedBounds&&['x','y'].every(k=>Number.isFinite(savedBounds[k]))?savedBounds:null;
  this.opened=false;this.state=null;this.destroying=false;this.lastNoticeId=null;
 }
 area(){const p=this.cursor(),all=this.displays();return all.find(d=>p.x>=d.x&&p.x<d.x+d.width&&p.y>=d.y&&p.y<d.y+d.height)||all[0];}
 ensure(){
  if(this.panel&&!this.panel.isDestroyed())return;
  this.panelArea=this.area();this.panel=this.createWindow('panel',this.panelArea);this.panel.setIgnoreMouseEvents(false);
  this.panel.on('ready-to-show',()=>{if(this.opened)this.focusPanel();this.update(this.state);});
  this.panel.on('close',event=>{if(!this.destroying){event.preventDefault();this.hide();}});this.layout();
 }
 focusPanel(){this.panel.show();this.panel.focus();}
 show(){this.ensure();this.panelArea=this.area();this.opened=true;this.layout();this.focusPanel();this.onVisibility(true);this.update(this.state);}
 hide(){this.opened=false;this.panel?.hide();this.onVisibility(false);this.update(this.state);}
 collapse(){this.hide();}
 toggle(){if(this.opened)this.hide();else this.show();}
 layout(){
  if(this.panel&&!this.panel.isDestroyed()){
   const d=this.displays().find(a=>a.x===this.panelArea?.x&&a.y===this.panelArea?.y)||this.area();this.panelArea=d;
   const size={width:Math.min(PANEL_WIDTH,Math.max(1,d.width-24)),height:Math.min(PANEL_HEIGHT,Math.max(1,d.height-24))};
   const bounds=clampBounds({x:this.savedBounds?.x??d.x+d.width-size.width-24,y:this.savedBounds?.y??d.y+24,...size},[{x:d.x+12,y:d.y+12,width:Math.max(1,d.width-24),height:Math.max(1,d.height-24)}]);
   this.panelLayout={x:bounds.x-d.x,y:bounds.y-d.y,...size,area:{...d}};
   if(['x','y','width','height'].some(k=>this.panel.getBounds()[k]!==d[k]))this.panel.setBounds(d);
  }
  if(this.notice&&!this.notice.isDestroyed()){
   const d=this.noticeArea&&this.displays().find(a=>a.x===this.noticeArea.x&&a.y===this.noticeArea.y)||this.area();this.noticeArea=d;
   const width=Math.min(NOTICE_WIDTH,Math.max(240,d.width-32)),height=Math.min(NOTICE_HEIGHT,d.height-24);
   this.notice.setBounds({x:Math.round(d.x+(d.width-width)/2),y:d.y+24,width,height});
  }
 }
 move(position){
  if(!this.panel||!this.opened)return;
  this.savedBounds={x:position.x,y:position.y};this.layout();
  this.savedBounds={x:this.panelArea.x+this.panelLayout.x,y:this.panelArea.y+this.panelLayout.y,width:this.panelLayout.width,height:this.panelLayout.height};
  this.save(this.savedBounds);this.update(this.state);
 }
 update(state){
  this.state=state;if(!state)return;this.layout();
  if(this.panel&&!this.panel.isDestroyed())this.panel.webContents.send('nvu:overlay:update',{...state,expanded:this.opened,panelLayout:this.panelLayout});
  const notice=state.notice;if(!notice||notice.expiresAt<=this.now()){this.notice?.hide();this.lastNoticeId=null;return;}
  if(!this.notice||this.notice.isDestroyed()){
   this.notice=this.createWindow('notice',{x:0,y:24,width:NOTICE_WIDTH,height:NOTICE_HEIGHT});this.notice.setIgnoreMouseEvents(true);
   this.notice.on('ready-to-show',()=>this.update(this.state));
  }
  if(this.lastNoticeId!==notice.id){this.noticeArea=this.area();this.lastNoticeId=notice.id;}
  this.layout();this.notice.webContents.send('nvu:overlay:update',{...state,expanded:this.opened});this.notice.showInactive();
 }
 tick(){if(this.state?.notice&&this.state.notice.expiresAt<=this.now())this.notice?.hide();}
 async command(surface,action){
  if(surface!=='panel')throw Error('OVERLAY_ACTION_DENIED');if(action==='collapse')return this.hide();
  if(!['pause','resume','stop','panel','trips','setup','game','theme'].includes(action))throw Error('OVERLAY_ACTION_DENIED');return this.actions(action);
 }
 surface(event){
  const w=this.panel;
  if(w&&!w.isDestroyed()&&event.sender===w.webContents&&event.senderFrame===w.webContents.mainFrame&&event.senderFrame.url.startsWith('file:')&&event.senderFrame.url===w.webContents.getURL())return 'panel';
  throw Error('OVERLAY_IPC_DENIED');
 }
 destroy(){this.destroying=true;this.onVisibility(false);for(const w of[this.panel,this.notice])if(w&&!w.isDestroyed())w.destroy();}
}
module.exports={OverlayController};
