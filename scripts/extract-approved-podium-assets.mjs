// Deterministic extraction of decorative layers only. No generated/reinterpreted metal.
// Usage: node scripts/extract-approved-podium-assets.mjs /absolute/approved-reference.png
// sharp is a build-time utility; it is not added to the app or its dependencies.
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let sharp;
try { sharp = require("sharp"); }
catch { sharp = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || "", "sharp")); }
const source = process.argv[2];
if (!source) throw new Error("Provide the approved 691 × 1536 reference image");
const out = path.resolve("public/assets/ranking-podium");
await fs.mkdir(out, { recursive: true });
const scene = await sharp(source).extract({ left: 0, top: 755, width: 691, height: 555 }).png().toBuffer();
const shape = (contents) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="691" height="555">${contents}</svg>`);
const framePaths = {
  silver: { outer: "44,125 202,125 225,148 225,389 204,409 44,409 22,390 22,149", inner: "50,141 195,141 211,155 211,374 194,391 50,391 36,375 36,155" },
  gold: { outer: "257,70 435,70 459,94 459,379 435,403 257,403 233,380 233,94", inner: "264,87 428,87 443,101 443,362 426,382 264,382 249,365 249,101" },
  bronze: { outer: "492,135 646,135 669,157 669,394 649,414 491,414 470,393 470,158", inner: "499,150 640,150 654,164 654,378 637,397 500,397 485,382 485,165" },
};
const writeLayer = async (name, mask) => {
  await sharp(scene).ensureAlpha().composite([{ input: shape(mask), blend: "dest-in" }]).png().toFile(path.join(out, name + ".png"));
};
for (const [metal, { outer, inner }] of Object.entries(framePaths)) {
  // The interior hole has alpha zero; it contains no baked participant data.
  const frame = await sharp(scene).ensureAlpha().composite([{ input: shape(`<path fill="white" fill-rule="evenodd" d="M${outer.replaceAll(' ', ' L')} Z M${inner.replaceAll(' ', ' L')} Z"/>`), blend: "dest-in" }]).png().toBuffer();
  await fs.writeFile(path.join(out, "frame-" + metal + ".png"), frame);
}
await writeLayer("medal-silver", '<circle cx="125" cy="130" r="36" fill="white"/>');
await writeLayer("medal-bronze", '<circle cx="570" cy="144" r="36" fill="white"/>');
await writeLayer("medal-gold", '<circle cx="346" cy="75" r="44" fill="white"/><polygon fill="white" points="280,54 290,53 294,70 305,91 320,102 333,106 332,117 309,112 293,103 281,91 275,72"/><polygon fill="white" points="412,54 402,53 398,70 387,91 372,102 359,106 360,117 383,112 399,103 411,91 417,72"/>');
// Remove dark backdrop between the separate laurel leaves, retaining their RGB.
const {data:laurel,info}=await sharp(path.join(out,"medal-gold.png")).ensureAlpha().raw().toBuffer({resolveWithObject:true});
for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
  const i=(y*info.width+x)*4;
  if(laurel[i+3] && Math.hypot(x-346,y-75)>44) laurel[i+3]=Math.round(laurel[i+3]*Math.max(0,Math.min(1,(laurel[i]-25)/35)));
}
await sharp(laurel,{raw:info}).png().toFile(path.join(out,"medal-gold.png"));
await writeLayer("pedestal", '<defs><filter id="soft" x="-30%" y="-100%" width="160%" height="300%"><feGaussianBlur stdDeviation="8"/></filter></defs><ellipse cx="346" cy="504" rx="315" ry="23" fill="white" opacity=".55" filter="url(#soft)"/><path fill="white" d="M19 410 Q35 395 88 402 L209 402 Q225 389 263 393 L429 393 Q467 391 481 409 Q520 400 648 405 Q676 407 676 421 L676 463 Q684 478 663 482 L535 482 Q512 495 489 495 L208 495 Q180 492 157 482 L35 482 Q10 480 15 466 L15 425 Q14 416 19 410 Z"/>');
// Truck glyphs only; no numbers or travel totals are retained in these assets.
for(const [metal,box] of Object.entries({silver:{left:65,top:356,width:28,height:24},gold:{left:282,top:335,width:32,height:28},bronze:{left:512,top:362,width:28,height:24}})){
  const {data,info}=await sharp(scene).extract(box).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(let i=0;i<data.length;i+=4){
    const a=Math.max(0,Math.min(1,(Math.max(data[i],data[i+1],data[i+2])-30)/180));
    data[i]=195;data[i+1]=207;data[i+2]=222;data[i+3]=Math.round(a*255);
  }
  await sharp(data,{raw:info}).png().toFile(path.join(out,`truck-${metal}.png`));
}
const measurements = { reference: { width:691,height:1536 }, scene: { x:0,y:755,width:691,height:555 }, framePaths, photos:{ silver:{x:76,y:176,w:99,h:98,r:17},gold:{x:286,y:129,w:120,h:117,r:18},bronze:{x:522,y:186,w:95,h:95,r:16} }, names:{ silver:{x:44,y:285,w:162,h:25},gold:{x:258,y:257,w:175,h:25},bronze:{x:490,y:293,w:160,h:25} }, amounts:{silver:{x:40,y:313,w:169,h:27},gold:{x:257,y:286,w:178,h:29},bronze:{x:493,y:320,w:151,h:27}},trips:{silver:{x:49,y:349,w:151,h:35},gold:{x:263,y:328,w:168,h:41},bronze:{x:496,y:355,w:149,h:34}} };
await fs.writeFile(path.resolve("verification/podium/measurements.json"), JSON.stringify(measurements,null,2)+"\n");
console.log("Extracted seven decorative layers and three truck glyphs; no participant photos, names, earnings or trip totals.");
