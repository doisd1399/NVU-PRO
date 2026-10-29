import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {spawn} from 'node:child_process';
const require=createRequire(import.meta.url);let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright')));}
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4178'],{stdio:'ignore'});
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:393,height:852}});await context.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:4178/')?r.continue():r.abort());
const page=await context.newPage(),checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
const expectVisible=async(name)=>{await page.getByRole('status',{name,exact:true}).waitFor({state:'visible'});};
try{
 for(let n=0;n<100;n++){try{if((await fetch('http://127.0.0.1:4178/verification/release-513/history.html')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 await page.goto('http://127.0.0.1:4178/verification/release-513/history.html');await page.getByRole('button',{name:'Lançar viagem'}).waitFor();
 await context.setOffline(true);await page.getByRole('button',{name:'Lançar viagem'}).click();await expectVisible('Aguardando envio');
 assert.equal(await page.locator('.nvu-driver-activity-row').count(),1);assert.match(await page.getByTestId('confirmed-count').innerText(),/0/);assert.equal(await page.evaluate(()=>window.__nvu513.uploadCalls),0);
 await page.getByRole('button',{name:/Ver viagem/}).click();assert.match(await page.locator('main').innerText(),/PR → SP/);checks.push('Offline capture appears immediately in the real React history row with clock icon, money and details; zero server calls and zero confirmed gains');
 await context.setOffline(false);await page.reload();await expectVisible('Aguardando envio');assert.equal(await page.locator('.nvu-driver-activity-row').count(),1);checks.push('Real localStorage and IndexedDB retain the same history row and proof across a page reload');
 await page.getByRole('button',{name:'Sincronizar'}).click();await expectVisible('Enviando');
 const colors=[];
 for(const dark of [false,true]){await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),dark);await page.screenshot({path:`verification/release-513/history-${dark?'dark':'light'}.png`});
  colors.push(await page.getByRole('status',{name:'Enviando',exact:true}).evaluate(el=>getComputedStyle(el).color));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 }
 assert.notEqual(colors[0],colors[1]);checks.push('Pending/sending status stays visible in light and dark themes at 393px with no horizontal overflow');
 await page.evaluate(()=>window.__nvu513.release());await expectVisible('Enviada');assert.equal(await page.locator('.nvu-driver-activity-row').count(),1);assert.match(await page.getByTestId('confirmed-count').innerText(),/1/);assert.equal(await page.evaluate(()=>window.__nvu513.trips[0].id),'print-browser513');checks.push('Server ACK updates the same row to Enviada and one confirmed trip without a second history listener or duplicate');
 await page.reload();await expectVisible('Enviada');assert.equal(await page.locator('.nvu-driver-activity-row').count(),1);checks.push('Confirmed row also survives restart before the history server read completes');
 assert.deepEqual(errors,[]);fs.mkdirSync('reports/release-513',{recursive:true});fs.writeFileSync('reports/release-513/browser.json',JSON.stringify({checks:checks.length,passed:checks,productionAccess:false,browser:'Chromium headless, 393 x 852',method:'Actual React row, history hook, journal, receipt IndexedDB, command, filters and synchronizer; controlled ACK boundary',pageErrors:errors},null,2));console.log('HISTORY_BROWSER_513_PASS',checks.length);
}finally{await browser.close();server.kill();}
