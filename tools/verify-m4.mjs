// M4 全功能真浏览器验证（CDP）
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import http from 'node:http';

const HTML_PATH = 'F:/project/tongji/values-tool/index.html';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9226;

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

const child = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  '--mute-audio', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:\\Users\\HUHU\\AppData\\Local\\Temp\\vt-chrome-prof-m4',
  'about:blank',
], { detached: true, stdio: 'ignore' });
child.unref();

let wsUrl, tabs;
for (let i = 0; i < 60; i++){
  try{ tabs = await jsonGet(`http://127.0.0.1:${PORT}/json`); if(tabs && tabs.length) break; }catch{}
  await sleep(500);
}
const pageTab = tabs.find(t => t.type === 'page') || tabs[0];
wsUrl = pageTab.webSocketDebuggerUrl;
console.log('[ws]', wsUrl.slice(0, 80) + '…');

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
let loadFired = false;

await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

function send(method, params){
  id += 1;
  const mid = id;
  return new Promise((res, rej) => {
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
}

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'file:///' + HTML_PATH.replace(/\\/g,'/') });
for (let i = 0; i < 80 && !loadFired; i++){ await sleep(100); }
await sleep(800);

async function evalExpr(expr){
  const r = await send('Runtime.evaluate', { expression: `(()=>{${expr}})()`, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails){
    console.log('! eval exception:', r.exceptionDetails.text, r.exceptionDetails.exception?.description || '');
  }
  return r.result ? r.result.value : undefined;
}

function log(msg, ok){
  console.log((ok===true?'  ✓ ':ok===false?'  ✗ ':'  · ') + msg);
}

// 清 localStorage 起点
await evalExpr(`localStorage.removeItem('values-tool-v1'); location.reload();`);
for (let i = 0; i < 80 && !loadFired; i++){ await sleep(100); }
await sleep(800);

// ========== 1. 键盘提示位置 + 三档按钮 kbd 标记 ==========
const a1 = await evalExpr(`
__VT__.go(1);
return {
  keyhintExists: !!document.getElementById('s1KeyHint'),
  keyhintVisible: (() => {
    const el = document.getElementById('s1KeyHint');
    if(!el) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && el.offsetWidth > 0;
  })(),
  keyhintText: document.getElementById('s1KeyHint')?.innerText.replace(/\\s+/g,' '),
  kbdHintsOnButtons: Array.from(document.querySelectorAll('.s1-opt .kbd-hint')).map(s => s.textContent.trim()),
  kbdFirstRowOK: (() => {
    const opts = document.querySelector('.s1-row .s1-opts');
    if(!opts) return false;
    return Array.from(opts.querySelectorAll('.kbd-hint')).map(s => s.textContent.trim()).join(',') === '1,2,3';
  })(),
  legendNoKeyboardPhrase: !document.querySelector('.s1-legend').innerText.includes('键盘'),
  firstRowFocused: document.activeElement?.classList?.contains('s1-row'),
};
`);
console.log('\n[键盘提示优化]');
log('顶部 .s1-keyhint 已存在', a1.keyhintExists);
log('.s1-keyhint 实际可见（非 hidden）', a1.keyhintVisible);
log('提示文本含 1/2/3/0/↑↓/跳搜索', /1.*2.*3/.test(a1.keyhintText||'') && /0/.test(a1.keyhintText||'') && /↑/.test(a1.keyhintText||'') && /\/ /.test(a1.keyhintText||''));
log('每个 row 内嵌 kbd 标记 = [1,2,3]', a1.kbdFirstRowOK === true);
log('底部 legend 不再有冗余"键盘："句', a1.legendNoKeyboardPhrase);
log('进入步骤①时首行自动 focus', a1.firstRowFocused === true);

// ========== 2. / 跳搜索 + Esc 回退 ==========
const a2 = await evalExpr(`
// 模拟键 "/"：用 dispatchEvent on document（跟真实按 / 等价）
document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
return {
  before: document.activeElement?.tagName,
  afterSlash: document.activeElement?.id,
  afterSlashCls: document.activeElement?.className,
};
`);
log('/ 键跳搜索框（activeElement=#s1Q）  actual=' + a2.afterSlash + ' tag=' + a2.afterSlashCls, a2.afterSlash === 's1Q');

// 同样验证搜索框 ESC 退出回首行（主动 focus search）
const a2esc = await evalExpr(`
const q = document.getElementById('s1Q');
q.focus();
const tag0 = document.activeElement?.tagName;
const cls0 = document.activeElement?.className;
// 直接在 input 上 dispatch（e.target = q，匹配 type=search）
q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
return {
  step: __VT__.state.step,
  tag0, cls0,
  active: document.activeElement?.tagName,
  cls: document.activeElement?.className,
  focusIsRow: document.activeElement?.classList?.contains('s1-row'),
};
`);
log('搜索框 Escape actual step=' + a2esc.step + ' tag0=' + a2esc.tag0 + ' -> active=' + a2esc.active + ' cls=' + a2esc.cls, a2esc.focusIsRow === true);

// ========== 3. 关键路径：第一步选 5 条「非常重要」→ 进第二步 → 自动空 → 点同步 → 渲染表格 ==========
const a3 = await evalExpr(`
__VT__.setMarkS1('v001', 3);
__VT__.setMarkS1('v004', 3);
__VT__.setMarkS1('v044', 3);
__VT__.setMarkS1('v095', 3);
__VT__.setMarkS1('v134', 3);
return { shortlistBefore: __VT__.state.shortlist.length, marked: Object.keys(__VT__.state.answers).length };
`);
log('标 5 条非常重要 → shortlist 仍 = 0（还没同步）', a3.shortlistBefore === 0);

const a4 = await evalExpr(`
__VT__.go(2);
return {
  emptyShown: !document.getElementById('s2Empty').hidden,
  rowsRendered: document.querySelectorAll('#s2Body tr').length,
  n3Shown: document.getElementById('s2N3').textContent,
  scoredText: document.getElementById('s2Scored').textContent,
  avgI: document.getElementById('s2AvgI').textContent,
  avgC: document.getElementById('s2AvgC').textContent,
  maxG: document.getElementById('s2MaxG').textContent,
};
`);
console.log('\n[第二步 · 初次空状态]');
log('empty 区显示', a4.emptyShown);
log('表格 0 行', a4.rowsRendered === 0);
log('同步按钮上 N=5', a4.n3Shown === '5');
log('顶部统计：已打分 0/0', a4.scoredText === '0 / 0');
log('avgI/avgC/maxG 都是 -', a4.avgI === '-' && a4.avgC === '-' && a4.maxG === '-');

// ========== 4. 同步：syncFromStep1 → 5 条进 shortlist ==========
const a5 = await evalExpr(`
__VT__.syncFromStep1();
return {
  slLen: __VT__.state.shortlist.length,
  ids: __VT__.state.shortlist.slice(),
  rowsNow: document.querySelectorAll('#s2Body tr').length,
  firstName: document.querySelector('#s2Body tr .nm')?.textContent,
};
`);
log('syncFromStep1 后 shortlist=5', a5.slLen === 5);
log('表格渲染 5 行', a5.rowsNow === 5);
log('排序按加入顺序：第一行 = 丰富', a5.firstName === '丰富');

// ========== 5. 给 5 条打分（已知差距）+ 排序切换 ==========
const a6 = await evalExpr(`
__VT__._setScoreS2('v001', 'importance', 5);
__VT__._setScoreS2('v001', 'consistency', 2);
__VT__._setScoreS2('v004', 'importance', 5);
__VT__._setScoreS2('v004', 'consistency', 4);
__VT__._setScoreS2('v044', 'importance', 3);
__VT__._setScoreS2('v044', 'consistency', 3);
__VT__._setScoreS2('v095', 'importance', 2);
__VT__._setScoreS2('v095', 'consistency', 5);
__VT__._setScoreS2('v134', 'importance', 4);
__VT__._setScoreS2('v134', 'consistency', 5);
return {
  scored: document.getElementById('s2Scored').textContent,
  avgI: document.getElementById('s2AvgI').textContent,
  avgC: document.getElementById('s2AvgC').textContent,
  maxG: document.getElementById('s2MaxG').textContent,
  ranked: Array.from(document.querySelectorAll('#s2Body tr td.idx')).map(td => td.textContent.trim()),
  gapClasses: Array.from(document.querySelectorAll('#s2Body tr .gp')).map(g => ({txt: g.textContent.trim(), cls: g.className.replace('gp ','')})),
  rankRows: Array.from(document.querySelectorAll('#s2-rank .s2-rank-row .name, .s2-rank-row .name')).map(n => n.textContent),
};
`);
console.log('\n[打 5 条分 + 排序]');
log('已打分 5/5', a6.scored === '5 / 5');
log('avgI = (5+5+3+2+4)/5 = 3.80', a6.avgI === '3.80');
log('avgC = (2+4+3+5+5)/5 = 3.80', a6.avgC === '3.80');
log('maxG = 3（v001:5-2）', a6.maxG === '3');
log('排序按 order, #1=丰富', a6.ranked[0] === '1.' && a6.ranked[1] === '2.');
// gap 数据
const expectedGaps = {
  v001: 3,  // 5-2 = +3 huge red
  v004: 1,  // 5-4 = +1 warn yellow
  v044: 0,  // 3-3 = 0   ok green
  v095: -3, // 2-5 = -3  ok green (反向也 ok)
  v134: -1, // 4-5 = -1  ok green
};
log('gapClasses 包含 bad-huge / warn / ok', a6.gapClasses.some(g => g.cls === 'bad-huge') && a6.gapClasses.some(g => g.cls === 'warn') && a6.gapClasses.some(g => g.cls === 'ok'));
// 排行
const rankCheck = await evalExpr(`return { rows: document.querySelectorAll('.s2-rank-row').length, maxBarWidth: Math.max(...Array.from(document.querySelectorAll('.bar-bar')).map(b => Number(b.style.width.replace('%','') || 0))) };`);
log('排行区域 5 行', rankCheck.rows === 5);
log('最大条形宽度=100% (gap=3 是 maxAbs)', rankCheck.maxBarWidth === 100);

// ========== 6. 切换排序：按差距降序 ==========
const a7 = await evalExpr(`
const sel = document.getElementById('s2Sort');
sel.value = 'gap';
sel.dispatchEvent(new Event('change', { bubbles: true }));
const order = Array.from(document.querySelectorAll('#s2Body tr td.name .nm')).map(n => n.textContent);
// 期望：v001(gap=3) 第一，然后 gap=1, gap=0, -1, -3
return { order, top: order[0] };
`);
log('排序=gap 后，第一名 v001（gap=3 最大）', a7.order[0] === '丰富');

// 切换回 order
await evalExpr(`const s=document.getElementById('s2Sort'); s.value='order'; s.dispatchEvent(new Event('change',{bubbles:true}));`);

// ========== 7. 移除某条 + 同步回第一步改 mark → 触发孤儿 ==========
const a8 = await evalExpr(`
window.confirm = () => true;
// v044 移除
__VT__._removeFromShortlist('v044');
return {
  slLen: __VT__.state.shortlist.length,
  rowsNow: document.querySelectorAll('#s2Body tr').length,
  scoredText: document.getElementById('s2Scored').textContent,
};
`);
log('移除 v044 后 shortlist=4', a8.slLen === 4);
log('已打分 = 4/4', a8.scoredText === '4 / 4');

const a9 = await evalExpr(`
// 把 v001（被移除"非常重要"，改回一般重要）
__VT__.setMarkS1('v001', 2);
__VT__._renderS2Orphan();
return {
  orphanShown: !document.getElementById('s2Orphan').hidden,
  orphanIds: Array.from(document.querySelectorAll('#s2OrphanList li b')).map(b => b.textContent),
  rowCls: document.querySelector('#s2Body tr[data-id="v001"]')?.className,
};
`);
log('v001 取消 mark=3 后，s2-orphan 卡片显示', a9.orphanShown);
log('孤儿列表含"丰富"', a9.orphanIds.indexOf('丰富') >= 0);
log('表格行 class 包含 is-orphan', /is-orphan/.test(a9.rowCls));

// ========== 8. 再加一条（候选池）: + 从题库再加 ==========
const a10 = await evalExpr(`
// 先加 c001 再标 mark=3 才能被 sync 选到
__VT__.openAddPanel();
document.getElementById('s1AddName').value = '自建试值';
document.getElementById('s1AddDesc').value = '在 verify 中加的';
document.getElementById('s1AddGroup').value = 'A—C';
__VT__.saveAddItem();
__VT__.setMarkS1('c001', 3);
__VT__.syncFromStep1();
return {
  slLen: __VT__.state.shortlist.length,
  isC001InS2: __VT__.state.shortlist.indexOf('c001') >= 0,
};
`);
log('同步后自建题 c001 已入第二步', a10.isC001InS2);

// ========== 9. hard 切步骤不重置 ==========
const a11 = await evalExpr(`
// 切回步骤 1
__VT__.go(0);
__VT__.go(1);
__VT__.go(2);
return {
  slLen: __VT__.state.shortlist.length,
  scored: document.getElementById('s2Scored').textContent,
  avgI: document.getElementById('s2AvgI').textContent,
};
`);
log('来回切换 0→1→2 后 shortlist=6（之前 c001 加入了）', a11.slLen === 6);
log('打分统计仍正常', /\/ 6$/.test(a11.scored));

// ========== 10. 清空打分 ==========
const a12 = await evalExpr(`
window.confirm = () => true;
__VT__._clearAllScoresS2();
return {
  scored: document.getElementById('s2Scored').textContent,
  avgI: document.getElementById('s2AvgI').textContent,
  slLen: __VT__.state.shortlist.length,
};
`);
log('clearAllScores 后 已打分=0', a12.scored === '0 / 6');
log('shortlist 不变（6 条条目保留）', a12.slLen === 6);

// ========== 11. 持久化 + 真刷新 ==========
const persist = await evalExpr(`
window.confirm = () => true;
__VT__._setScoreS2('v001', 'importance', 5);
__VT__._setScoreS2('v001', 'consistency', 4);
const before = {
  shortlist: __VT__.state.shortlist.slice(),
  scored: document.getElementById('s2Scored').textContent,
  slLen: __VT__.state.shortlist.length,
  v001ans: __VT__.state.answers.v001,
  sort: __VT__.state.ui.step2.sort,
};
return before;
`);
console.log('\n[refresh] before:', persist);

loadFired = false;
await send('Page.reload');
for (let i = 0; i < 80 && !loadFired; i++){ await sleep(100); }
await sleep(800);

const a13 = await evalExpr(`
__VT__.go(2);
return {
  rowsNow: document.querySelectorAll('#s2Body tr').length,
  v001ImpBtn: document.querySelector('tr[data-id="v001"] .sc6.imp button.on')?.textContent.trim(),
  v001ConBtn: document.querySelector('tr[data-id="v001"] .sc6.con button.on')?.textContent.trim(),
  v001Gap: document.querySelector('tr[data-id="v001"] .gp')?.textContent.trim(),
  ranked: Array.from(document.querySelectorAll('#s2Body tr td.idx')).map(td => td.textContent.trim()),
};
`);
log('刷新后 6 行', a13.rowsNow === 6);
log('刷新后 v001 重要性=5 已恢复', a13.v001ImpBtn === '5');
log('刷新后 v001 一致性=4 已恢复', a13.v001ConBtn === '4');
log('刷新后 gap=+1', a13.v001Gap === '+1');

// ========== 12. console errors ==========
console.log('\n[console] msgs=' + consoleMsgs.length + ' · pageErrors=' + pageErrors.length);
if(pageErrors.length){
  for(const e of pageErrors) console.log('  !', String(e.msg).slice(0, 250));
} else {
  console.log('  ✓ zero page errors');
}

ws.close();
await sleep(200);
process.exit(pageErrors.length ? 1 : 0);
