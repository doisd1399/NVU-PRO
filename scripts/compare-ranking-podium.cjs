const fs=require('node:fs');
let sharp; try { sharp=require('sharp'); } catch { sharp=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/sharp'); }
const root=process.cwd();
(async()=>{
 const ref=await sharp(root+'/verification/podium/reference.png').extract({left:0,top:755,width:691,height:555}).png().toBuffer();
 const output=root+'/verification/podium/results';
 await fs.promises.writeFile(output+'/reference-podium.png',ref);
 const actual=output+'/podium-dark-reference-size.png';
 const source=await sharp(ref).removeAlpha().raw().toBuffer();
 const rendered=await sharp(actual).removeAlpha().raw().toBuffer();
 const metrics=[];
 for(const name of ['frame-silver','frame-gold','frame-bronze','medal-silver','medal-gold','medal-bronze','pedestal']){
  const mask=await sharp(root+'/public/assets/ranking-podium/'+name+'.png').ensureAlpha().raw().toBuffer();
  let count=0,sum=0,exact=0;
  for(let p=0;p<691*555;p++){
   if(mask[p*4+3]!==255)continue;
   count++;let d=0;
   for(let c=0;c<3;c++){d+=Math.abs(source[p*3+c]-rendered[p*3+c]);}
   if(d===0)exact++;sum+=d;
  }
  metrics.push({layer:name,opaquePixels:count,exactPixels:exact,exactPercent:count?100*exact/count:0,meanChannelError:count?sum/(count*3):0});
 }
 await fs.promises.writeFile(output+'/decoration-comparison.json',JSON.stringify({scope:'Opaque pixels of decorative layers only; excludes dynamic text, photos, panels, transparency and halo edges.',metrics},null,2));
 const label=Buffer.from('<svg width="1406" height="48" xmlns="http://www.w3.org/2000/svg"><rect width="1406" height="48" fill="#161b24"/><text x="20" y="31" fill="white" font-size="20" font-family="Arial">Referência aprovada</text><text x="725" y="31" fill="white" font-size="20" font-family="Arial">Implementação — tema escuro</text></svg>');
 await sharp({create:{width:1406,height:603,channels:3,background:'#09090b'}}).composite([{input:label,left:0,top:0},{input:ref,left:0,top:48},{input:actual,left:715,top:48}]).png().toFile(output+'/comparison.png');
 await sharp(ref).composite([{input:await sharp(actual).ensureAlpha().composite([{input:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="691" height="555"><rect width="691" height="555" fill="white" opacity=".5"/></svg>'),blend:"dest-in"}]).png().toBuffer()}]).png().toFile(output+'/overlay.png');
 console.log(JSON.stringify(metrics));
})();
