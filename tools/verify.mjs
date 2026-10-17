// Minimal CDP client to render index.html in real Chrome (bypasses npm install issue)
// 用法: node verify.mjs
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import http from 'node:http';

const HTML_PATH = 'F:/project/tongji/values-tool/index.html';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222;

async function jsonGet(url){
  return new Promise((res, rej) => {
    http.get(url, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        if(!d){ rej(new Error('empty body')); return; }
        try{ res(JSON.parse(d)); }catch(e){ rej(e); }
      });
      r.on('error', rej);
    }).on('error', rej);
  });
}

// 1. 启动 chrome (后台模式，独立进程组)
console.log('[1] launching chrome …');
const child = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--disable-dev-shm-usage', '--mute-audio',
  '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:\\Users\\HUHU\\AppData\\Local\\Temp\\vt-chrome-prof',
  'about:blank',
], { detached: true, stdio: 'ignore' });
child.unref();  // 让 chrome 独立于父进程生命周期

// 2. 探测 wsUrl (polling 最多 30s)
let wsUrl, tabs;
for (let i = 0; i < 60; i++){
  try{ tabs = await jsonGet(`http://127.0.0.1:${PORT}/json`); if(tabs && tabs.length) break; }catch{}
  await sleep(500);
}
if (!tabs || !tabs.length){
  // 直接退出，让 chrome 留在那里
  console.log('! could not connect to chrome after 30s');
  process.exit(1);
}
// 找到 type==='page' 的 tab
const pageTab = tabs.find(t => t.type === 'page') || tabs[0];
wsUrl = pageTab.webSocketDebuggerUrl;
console.log('[2] wsUrl:', wsUrl.slice(0, 80) + '…');

// 3. 用内置 WebSocket 连
const ws = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();
const consoleMsgs = [];
const pageErrors = [];

ws.onmessage = (ev) => {
  const data = JSON.parse(ev.data);
  if (data.id && pending.has(data.id)){
    const { res, rej } = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) rej(new Error(JSON.stringify(data.error)));
    else res(data.result);
  } else if (data.method === 'Runtime.consoleAPICalled'){
    consoleMsgs.push({ t: data.params.type, args: data.params.args.map(a => a.value || a.description).join(' ') });
  } else if (data.method === 'Runtime.exceptionThrown'){
    const ed = data.params.exceptionDetails;
    pageErrors.push({ msg: ed.text + (ed.exception ? ' :: ' + (ed.exception.description || ed.exception.value) : '') });
  } else if (data.method === 'Page.loadEventFired'){
    loadFired = true;
  }
};

await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

function send(method, params){
  id += 1;
  const mid = id;
  return new Promise((res, rej) => {
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
}

// 4. 启用 console + exception events
await send('Runtime.enable');
await send('Page.enable');

// 5. 导航到本地文件
console.log('[3] navigating to:', HTML_PATH);
let loadFired = false;
await send('Page.navigate', { url: 'file:///' + HTML_PATH.replace(/\\/g,'/') });
for (let i = 0; i < 80 && !loadFired; i++){ await sleep(100); }
if (!loadFired){ console.log('! loadEventFired timeout'); }
await sleep(500);  // 让 setTimeout(50) vtTestToggle 跑过

// 6. 抓数据
async function evalExpr(expr){
  const r = await send('Runtime.evaluate', { expression: `(()=>{${expr}})()`, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails){
    console.log('! eval exception:', r.exceptionDetails.text, r.exceptionDetails.exception?.description || '');
  }
  return r.result ? r.result.value : undefined;
}

const stats = await evalExpr(`
return {
  rows: document.querySelectorAll('#s1List .s1-row').length,
  secs: document.querySelectorAll('#s1List .s1-sec').length,
  step: __VT__.state.step,
  merged: document.querySelectorAll('#s1List .s1-tag').length,    // 期望为 0（已合并徽标已移除）
  customTags: document.querySelectorAll('#s1List .s1-tag').length,
  firstOptStyle: (() => {
    const o = document.querySelector('.s1-opt.k3');
    const cs = getComputedStyle(o);
    return { color: cs.color, bg: cs.backgroundColor, border: cs.borderColor };
  })(),
  firstRowHTML: document.querySelector('.s1-row').innerHTML.slice(0, 200),
};
`);
console.log('[4] stats:', JSON.stringify(stats, null, 2));

const aft = await evalExpr(`
__VT__.setMarkS1('v001', 3);
return {
  v001state: __VT__.state.answers.v001,
  v001opt: document.querySelector('[data-id="v001"] .s1-opt.k3').classList.contains('on'),
  v001markRow: document.querySelector('[data-id="v001"]').dataset.v,
  n3: document.getElementById('s1N3').textContent,
};
`);
console.log('[5] after setMarkS1:', JSON.stringify(aft, null, 2));

const clr = await evalExpr(`
__VT__.setMarkS1('v001', 0);
return {
  hasV001: 'v001' in __VT__.state.answers,
  n3: document.getElementById('s1N3').textContent,
};
`);
console.log('[6] after clear:', JSON.stringify(clr, null, 2));

const filter = await evalExpr(`
document.getElementById('s1Q').value = '家庭';
document.getElementById('s1Q').dispatchEvent(new Event('input', {bubbles:true}));
return {
  rows: document.querySelectorAll('#s1List .s1-row:not(.hide)').length,
  visibleNames: Array.from(document.querySelectorAll('#s1List .s1-row:not(.hide) .s1-name')).map(e => e.textContent.trim().slice(0,15)),
};
`);
console.log('[7] search \"家庭\":', JSON.stringify(filter, null, 2));

console.log('[8] console msgs (' + consoleMsgs.length + '):');
for (const c of consoleMsgs.slice(0, 20)) console.log('   ', c.t, '·', String(c.args).slice(0, 200));
console.log('[9] page errors (' + pageErrors.length + '):');
for (const e of pageErrors.slice(0, 20)) console.log('   !', String(e.msg).slice(0, 300));

ws.close();
// child.kill();  // 暂留 chrome 进程供调试
await sleep(300);
process.exit(pageErrors.length ? 1 : 0);
