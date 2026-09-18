const a=(x,m)=>{if(!x)throw Error(m)};
const show=s=>s.running&&!s.destroying&&s.enabled&&s.gtoForeground&&!s.projectionActive&&!s.inFlight&&s.captureNeeded&&s.reauth&&s.overlay;
let n=0;
for(const state of ['WAITING','CONFIRMING','TRIP','RESULT','BONUS']){const b={running:1,destroying:0,enabled:1,gtoForeground:1,projectionActive:0,inFlight:0,captureNeeded:1,reauth:1,overlay:1}; a(show(b),state);n++; for(const k of ['projectionActive','inFlight']){a(!show({...b,[k]:1}),state+k);n++;} for(const k of ['gtoForeground','captureNeeded','reauth','overlay']){a(!show({...b,[k]:0}),state+k);n++;}}
const place=(w,x)=>{const bs=56,bw=82,g=8,m=8,r=x+bs+g,l=x-bw-g;return r+bw<=w-m?Math.max(m,r):Math.max(m,Math.min(l,Math.max(m,w-bw-m)))};
for(const w of [360,480,720,1080,1440,2160])for(const x of [0,8,Math.floor(w/2),Math.max(0,w-64)]){const q=place(w,x);a(q>=8&&q+82<=w-8,`${w}/${x}`);n++;}
console.log(`${n}/${n} compact reauthorization scenarios passed.`);
