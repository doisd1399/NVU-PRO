import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const checks=[];
const check=(name,ok,detail="")=>{checks.push({name,ok:!!ok});console.log(`${ok?"PASS":"FAIL"} ${name}${detail?` — ${detail}`:""}`)};
const root=process.cwd();
const gradle=fs.readFileSync("android/app/build.gradle","utf8");
const service=fs.readFileSync("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java","utf8");
const sync=fs.readFileSync("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java","utf8");
const consensus=fs.readFileSync("android/app/src/main/java/com/nvu/operacional/GtoResultValueConsensus.java","utf8");
const functions=fs.readFileSync("functions/src/gtoTrips.ts","utf8");

check("R3.34 HF10+ Android version", Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0) >= 62 && Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/) || [])[1] || 0) >= 62);
check("result consensus uses explicit cents", consensus.includes("=c") && consensus.includes("GtoMoneyValue.parseCents") && consensus.includes("SCHEMA_VERSION = 2"));
check("legacy ambiguous result evidence is invalidated", service.includes("resultValueConsensusVersion") && service.includes("GtoResultValueConsensus.SCHEMA_VERSION"));
check("offered freight value uses the same locale-safe money parser", service.includes("private String canonicalMoney(String value)") && service.includes("return GtoMoneyValue.canonical(value);") && service.includes("differentMoneyValue(exact.offeredValue, stable.offeredValue)"));
check("local queue blocks monetary incompatibility", sync.includes("GtoMoneyValue.finalValueCompatibilityIssue"));
check("backend blocks monetary incompatibility", functions.includes("finalValueCompatibilityIssue(offeredValue, finalValue)"));
check("backend marks corrected money schema", functions.includes("gtoMoneySchemaVersion: 2"));
check("backend parser extracted to pure money helper", functions.includes('from "./gtoMoney"'));

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"nvu-r334-money-"));
try {
  const run=spawnSync("java",[
    "scripts/java-tests/JavaTestRunner.java",
    tmp,
    "com.nvu.operacional.GtoMoneyValueRegressionTest",
    "android/app/src/main/java/com/nvu/operacional/GtoMoneyValue.java",
    "android/app/src/main/java/com/nvu/operacional/GtoResultValueConsensus.java",
    "scripts/java-tests/com/nvu/operacional/GtoMoneyValueRegressionTest.java",
  ],{cwd:root,encoding:"utf8"});
  const out=`${run.stderr||""}\n${run.stdout||""}`.trim();
  check("money regression fixtures compile", !out.includes("compilation failed")&&!out.includes("Java compilation failed"), out);
  check("money regression scenarios pass", run.status===0 && String(run.stdout||"").includes("PASS"), out);
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }

const failed=checks.filter(x=>!x.ok);
console.log(`\n${checks.length-failed.length}/${checks.length} R3.34 money-integrity checks passed.`);
if(failed.length) process.exit(1);
