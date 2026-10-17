// 自启 chrome + 跑 CDP 测试 + 关闭 chrome（一体化）
import { spawn } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
function loadWs(){
  const tries = [
    () => require('ws'),
    () => require('C:/Users/HUHU/.workbuddy/binaries/node/versions/22.22.2-6/node_modules/@tencent/slidep/node_modules/ws')
  ];
  for(const t of tries){ try { const w = t(); if(w) return w; } catch(e){} }
  throw new Error('Cannot find ws package');
}
const WebSocket = loadWs();

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HTML_PATH = 'file:///F:/project/tongji/values-tool/index.html';
const PORT = 9360;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jsonGet = u => new Promise((r,j) => http.get(u, x => { let d=''; x.on('data', c => d += c); x.on('end', () => { try{r(JSON.parse(d))}catch(e){r(null)} }); }).on('error', j));

// 1. 启动 chrome
const userData = `C:\\Users\\HUHU\\AppData\\Local\\Temp\\vt-cpx-${process.pid}`;
try { require('node:fs').rmSync(userData, { recursive: true, force: true }); } catch{}
const c = spawn(CHROME, ['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage','--mute-audio',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`, 'about:blank'],
  { detached: true, stdio: 'ignore' });
c.unref();
process.stderr.write(`[1] chrome PID=${c.pid}\n`);

// 2. 等 chrome listening
let tabs = null;
for(let i=0; i<60; i++){
  try { tabs = await jsonGet(`http://127.0.0.1:${PORT}/json`); if(tabs && tabs.length) break; } catch{}
  await sleep(250);
}
if(!tabs){ console.log('! chrome failed to start'); process.exit(1); }
process.stderr.write(`[2] chrome ready, ${tabs.length} tabs\n`);

// 3. 接 ws
const tab = tabs.find(t => t.type === 'page') || tabs[0];
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.on('open', r));
let id = 1;
const pending = new Map();
const consoleMsgs = [];
const pageErrors = [];
ws.on('message', data => {
  const d = JSON.parse(data);
  if(d.id && pending.has(d.id)){
    const { res, rej } = pending.get(d.id); pending.delete(d.id);
    if(d.error) rej(new Error(JSON.stringify(d.error))); else res(d.result);
  } else if(d.method === 'Runtime.consoleAPICalled'){
    consoleMsgs.push({ t:d.params.type, text: d.params.args.map(a => a.value || a.description).join(' ') });
  } else if(d.method === 'Runtime.exceptionThrown'){
    const e = d.params.exceptionDetails;
    pageErrors.push(e.text + (e.exception ? ' :: ' + (e.exception.description || e.exception.value) : ''));
  }
});
function send(method, params){
  return new Promise((res, rej) => { const i = id++; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id:i, method, params })); });
}
async function evalExpr(expr){
  const r = await send('Runtime.evaluate', {
    expression: `(()=>{ try{ return (async function(){ ${expr} })(); }catch(e){ return {err:e.message, stack:e.stack}; } })()`,
    returnByValue:true, awaitPromise:true,
  });
  if(r.exceptionDetails){ return { __evalError: r.exceptionDetails.text }; }
  return r.result.value;
}

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: HTML_PATH });
for(let i=0; i<60; i++){
  const e = await send('Runtime.evaluate', { expression:'document.readyState', returnByValue:true });
  if(e.result.value === 'complete') break;
  await sleep(100);
}
await sleep(800);
for(let i=0; i<30; i++){
  const e = await send('Runtime.evaluate', { expression:'typeof window.__VT__', returnByValue:true });
  if(e.result.value === 'object') break;
  await sleep(100);
}

const log = (msg, ok) => console.log((ok?'✓ ':'✗ ') + msg);

console.log('\n=== A) 三档按钮 kbd 角标在选中时仍可见 ===');
const a1 = await evalExpr(`
  __VT__.go(1);
  await new Promise(r => setTimeout(r, 200));
  __VT__.setMarkS1('v001', 3);
  await new Promise(r => setTimeout(r, 100));
  const row = document.querySelector('#s1List .s1-row[data-id="v001"]');
  const kbd = row && row.querySelector('.s1-opt.k3 .kbd-hint');
  const cs = kbd && getComputedStyle(kbd);
  const rect = kbd && kbd.getBoundingClientRect();
  return {
    kbdFound: !!kbd,
    kbdText: kbd ? kbd.textContent : null,
    kbdVisible: cs && cs.display !== 'none' && Number(cs.opacity) > 0.01,
    kbdWidth: rect ? rect.width : 0,
    kbdHeight: rect ? rect.height : 0,
    cssPosition: cs ? cs.position : null,
    cssColor: cs ? cs.color : null,
    cssBackground: cs ? cs.backgroundColor : null,
    cssBorder: cs ? cs.borderColor : null,
    onBtn: row && row.querySelector('.s1-opt.k3').classList.contains('on'),
  };
`);
log('角标存在', a1.kbdFound);
log('角标内容 = "1"', a1.kbdText === '1');
log('角标 width >= 14', a1.kbdWidth >= 14);
log('角标 height >= 14', a1.kbdHeight >= 14);
log('角标 position: absolute', a1.cssPosition === 'absolute');
log('按钮 .on 类生效', a1.onBtn === true);
log('角标不被隐藏', a1.kbdVisible === true);
console.log('   角标 color=' + a1.cssColor + ' bg=' + a1.cssBackground + ' border=' + a1.cssBorder + ' w=' + a1.kbdWidth + ' h=' + a1.kbdHeight);

const a2 = await evalExpr(`
  __VT__.setMarkS1('v001', 2);
  await new Promise(r => setTimeout(r, 100));
  const kbd = document.querySelector('#s1List .s1-row[data-id="v001"] .s1-opt.k2 .kbd-hint');
  const cs = getComputedStyle(kbd);
  return { text: kbd.textContent, color: cs.color, visible: cs.display !== 'none' };
`);
log('切换档位后角标仍可见', a2.visible && a2.text === '2');

console.log('\n=== B) M4 默认排序 = order ===');
const b1 = await evalExpr(`__VT__.go(2); return document.getElementById('s2Sort').value;`);
log('M4 排序控件默认值 = "order"', b1 === 'order');

console.log('\n=== C) onboarding 气泡 ===');
await evalExpr(`localStorage.removeItem('values-tool-v1'); location.reload(); return true;`);
await sleep(1500);
const c1 = await evalExpr(`
  __VT__.go(1);
  await new Promise(r => setTimeout(r, 700));
  const el = document.getElementById('s1Onboard');
  return { hidden: el.hidden, text: el.innerText };
`);
log('onboarding hidden=false', c1.hidden === false);
log('onboarding 含"试试用键盘"', /试试用键盘/.test(c1.text));
log('onboarding 含 "按 1" "2" "3"', /按 1/.test(c1.text) && /2/.test(c1.text) && /3/.test(c1.text));

const c2 = await evalExpr(`
  document.getElementById('s1OnboardClose').click();
  await new Promise(r => setTimeout(r, 600));
  return { hidden: document.getElementById('s1Onboard').hidden, keyhintShown: __VT__.state.ui.step1.keyhintShown };
`);
log('点 × 后 hidden=true', c2.hidden === true);
log('keyhintShown=true 写入 state', c2.keyhintShown === true);

const c3 = await evalExpr(`
  __VT__.go(0); __VT__.go(1);
  await new Promise(r => setTimeout(r, 600));
  return { hidden: document.getElementById('s1Onboard').hidden };
`);
log('再次进入不重复弹', c3.hidden === true);

console.log('\n=== D) 回到顶部按钮 ===');
const d1 = await evalExpr(`
  const btn = document.getElementById('backToTop');
  const init = btn.hidden;
  window.scrollTo(0, 600);
  await new Promise(r => setTimeout(r, 250));
  const afterScroll = btn.hidden;
  btn.click();
  await new Promise(r => setTimeout(r, 1200));
  const afterClick = window.pageYOffset;
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 250));
  const afterZero = btn.hidden;
  return { init, afterScroll, afterClick, afterZero };
`);
log('初始 hidden=true', d1.init === true);
log('滚 600px 后 hidden=false', d1.afterScroll === false);
log('点击回顶 y≈0', d1.afterClick < 10);
log('回 0px 后 hidden=true', d1.afterZero === true);

console.log('\n=== E) 手机适配（375px） ===');
await send('Emulation.setDeviceMetricsOverride', { width:375, height:720, deviceScaleFactor:2, mobile:true });
await sleep(300);
// 滚动让回到顶部按钮显示后再测宽度
await evalExpr(`window.scrollTo(0, 600); await new Promise(r=>setTimeout(r,250));`);
const e1 = await evalExpr(`
  __VT__.go(1);
  __VT__.setMarkS1('v001', 3); __VT__.setMarkS1('v002', 2); __VT__.setMarkS1('v003', 3); __VT__.setMarkS1('v004', 3); __VT__.setMarkS1('v005', 3);
  __VT__.syncFromStep1();
  __VT__.go(2);
  await new Promise(r => setTimeout(r, 200));
  return {
    width: window.innerWidth,
    hasViewport: !!document.querySelector('meta[name="viewport"]'),
    metaContent: (document.querySelector('meta[name="viewport"]')||{}).content,
    toolbarDir: getComputedStyle(document.querySelector('.s1-tools')).flexDirection,
    s2StatsCols: getComputedStyle(document.querySelector('.s2-stats')).gridTemplateColumns.split(' ').length,
    s2TableDisplay: getComputedStyle(document.querySelector('.s2-table')).display,
    s2TbodyDisplay: getComputedStyle(document.querySelector('#s2Body')).display,
    s2RowDisplay: getComputedStyle(document.querySelector('#s2Body tr')).display,
    backToTop: document.querySelector('#backToTop').getBoundingClientRect().width,
    s2ToolsExists: !!document.querySelector('.s2-tools'),
    view2On: document.getElementById('view-2').classList.contains('on'),
  };
`);
console.log('   e_actual=' + JSON.stringify(e1));
log('viewport = 375', e1.width === 375);
log('viewport meta 存在', e1.hasViewport === true);
log('工具栏 flex-direction=column', e1.toolbarDir === 'column');
log('M4 stats 2 列', e1.s2StatsCols === 2);
log('s2-table = block', e1.s2TableDisplay === 'block');
log('s2-row (tr) = grid', /grid/.test(e1.s2RowDisplay));
log('回到顶部按钮宽度 38-46', e1.backToTop >= 38 && e1.backToTop <= 46);

await send('Emulation.clearDeviceMetricsOverride');
await sleep(200);

console.log('\n=== F) 旧 sort=gap 兼容 ===');
await evalExpr(`
  localStorage.setItem('values-tool-v1', JSON.stringify({
    schemaVersion:1, step:2,
    answers:{v001:{mark:3, importance:5, consistency:4}},
    shortlist:['v001'],
    ui:{step1:{q:'',onlyUn:false,autoNext:true,dense:false}, step2:{sort:'gap'}},
    bankCustom:[], nextCustomId:1, updatedAt:'x'
  }));
  location.reload(); return true;
`);
await sleep(2000);
const f1 = await evalExpr(`return { sort: __VT__.state.ui.step2.sort, keyhintShown: __VT__.state.ui.step1.keyhintShown };`);
log('旧 sort=gap 加载后 = order', f1.sort === 'order');
log('旧 state 补全 keyhintShown=false', f1.keyhintShown === false);

console.log('\n=== G) Errors ===');
if(pageErrors.length){ console.log('✗ page errors:'); pageErrors.forEach(e => console.log(' ', e)); }
else console.log('✓ 0 page error');
const errs = consoleMsgs.filter(m => m.t === 'error');
if(errs.length){ console.log('✗ console errors:'); errs.forEach(m => console.log(' ', m.text)); }
else console.log('✓ 0 console error');

// 4. 关闭
ws.close();
try { spawn('taskkill', ['/PID', c.pid, '/F', '/T'], { stdio:'ignore' }); } catch{}
process.exit(pageErrors.length ? 1 : 0);