// M3 全功能真浏览器验证（基于 tools/verify.mjs）
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import http from 'node:http';

const HTML_PATH = 'F:/project/tongji/values-tool/index.html';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9225;

async function jsonGet(url){
  return new Promise((res, rej) => {
    http.get(url, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        if(!d){ rej(new Error('empty body')); return; }
        try{ res(JSON.parse(d)); }catch(e){ rej(e); }
      });
    }).on('error', rej);
  });
}

const child = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--disable-dev-shm-usage', '--mute-audio', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:\\Users\\HUHU\\AppData\\Local\\Temp\\vt-chrome-prof-m3',
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

// ========== 1. 加载后先清掉 localStorage 残留 ==========
await evalExpr(`localStorage.removeItem('values-tool-v1'); location.reload();`);
for (let i = 0; i < 80 && !loadFired; i++){ await sleep(100); }
await sleep(800);

// ========== 2. 初始题库数 ==========
const init = await evalExpr(`
return {
  totalItems: __VT__.state.bank.items.length + (__VT__.state.bankCustom || []).length,
  customInitial: (__VT__.state.bankCustom || []).length,
  customRows: document.querySelectorAll('#s1List .s1-row.is-custom').length,
  addPanelHidden: document.getElementById('s1AddPanel').hidden,
  hasTools: !!document.querySelector('.s1-bank-tools'),
  addedButtons: Array.from(document.querySelectorAll('.s1-bank-tools button')).map(b => b.id),
  editButtons: document.querySelectorAll('#s1List .s1-act.edit').length,
  delButtons: document.querySelectorAll('#s1List .s1-act.del').length,
};
`);
console.log('\n[1] 初始状态：');
log('default bank = 154', init.totalItems === 154);
log('初始无自建题', init.customInitial === 0);
log('s1-row.is-custom = 0（无自建标签）', init.customRows === 0);
log('添加面板默认隐藏', init.addPanelHidden === true);
log('bank-tools 行存在', init.hasTools);
log('4 个按钮：s1AddBtn/s1RestoreBankBtn/s1ExportBankBtn/s1ImportBankBtn',
  init.addedButtons.length === 4 && init.addedButtons[0]==='s1AddBtn' && init.addedButtons[1]==='s1RestoreBankBtn' && init.addedButtons[2]==='s1ExportBankBtn' && init.addedButtons[3]==='s1ImportBankBtn');
log('默认题 edit/del 按钮 DOM 各 154 个（display:none）', init.editButtons === 154 && init.delButtons === 154);

// ========== 3. openAddPanel() ==========
const opened = await evalExpr(`__VT__.openAddPanel(); return { hidden: document.getElementById('s1AddPanel').hidden };`);
log('openAddPanel 后隐藏=false', opened.hidden === false);

// ========== 4. saveAddItem() - 添加 "我的创意" ==========
const afterAdd = await evalExpr(`
document.getElementById('s1AddName').value = '我的创意';
document.getElementById('s1AddDesc').value = '能产出新想法、原创内容';
document.getElementById('s1AddGroup').value = 'M—R';
__VT__.saveAddItem();
return {
  hidden: document.getElementById('s1AddPanel').hidden,
  customLen: __VT__.state.bankCustom.length,
  firstCustom: __VT__.state.bankCustom[0],
  rowCount: document.querySelectorAll('#s1List .s1-row').length,
  isCustomCount: document.querySelectorAll('#s1List .s1-row.is-custom').length,
  msg: document.getElementById('s1BankMsg').textContent,
};
`);
log('saveAddItem 后面板关闭', afterAdd.hidden === true);
log('bankCustom 加了 1 条', afterAdd.customLen === 1);
log('id 是 c001', afterAdd.firstCustom.id === 'c001');
log('name/desc/group 正确', afterAdd.firstCustom.name === '我的创意' && afterAdd.firstCustom.desc === '能产出新想法、原创内容' && afterAdd.firstCustom.group === 'M—R');
log('row 总数 = 155', afterAdd.rowCount === 155);
log('is-custom 行 = 1', afterAdd.isCustomCount === 1);
log('顶部消息："已添加：我的创意 · c001"', /^已添加：我的创意/.test(afterAdd.msg));

// ========== 5. 再加一条 ==========
const afterAdd2 = await evalExpr(`
__VT__.openAddPanel();
document.getElementById('s1AddName').value = '成长陪伴';
document.getElementById('s1AddDesc').value = '陪亲友一起成长';
document.getElementById('s1AddGroup').value = 'S—Z';
__VT__.saveAddItem();
return { len: __VT__.state.bankCustom.length, secondId: __VT__.state.bankCustom[1].id };
`);
log('bankCustom 现在 2 条，第二条 id=c002', afterAdd2.len === 2 && afterAdd2.secondId === 'c002');

// ========== 6. editCustomItem() - 改第一条 ==========
const afterEdit = await evalExpr(`
__VT__.editCustomItem('c001');
const row = document.querySelector('[data-id="c001"]');
document.getElementById('ed_c001_name').value = '原创力';
document.getElementById('ed_c001_desc').value = '产出新作品';
document.getElementById('ed_c001_group').value = 'D—H';
__VT__.saveEditCustom('c001');
return {
  editing: document.querySelector('[data-id="c001"]').classList.contains('editing'),
  item: __VT__.state.bankCustom[0],
  searchIdx: document.querySelector('[data-id="c001"]').dataset.search,
  group: document.querySelector('[data-id="c001"]').dataset.sec,
  msg: document.getElementById('s1BankMsg').textContent,
};
`);
log('编辑态已关闭', afterEdit.editing === false);
log('name/desc/group 更新', afterEdit.item.name === '原创力' && afterEdit.item.desc === '产出新作品' && afterEdit.item.group === 'D—H');
log('search 索引已更新', afterEdit.searchIdx.indexOf('原创力') >= 0 && afterEdit.searchIdx.indexOf('产出新作品') >= 0);
log('行 group 已更新', afterEdit.group === 'D—H');

// ========== 7. 给 c001 选档 → 看按钮 .on + state ==========
const afterMark = await evalExpr(`
__VT__.setMarkS1('c001', 3);
return {
  ans: __VT__.state.answers.c001,
  domV: document.querySelector('[data-id="c001"]').dataset.v,
  k3on: document.querySelector('[data-id="c001"] .s1-opt.k3').classList.contains('on'),
};
`);
log('c001 mark=3 已写入', afterMark.ans && afterMark.ans.mark === 3);
log('行 data-v=3', afterMark.domV === '3');
log('k3 按钮 .on=true', afterMark.k3on === true);

// ========== 8. deleteCustomItem(c002) ==========
const afterDel = await evalExpr(`
window.confirm = () => true;
__VT__.deleteCustomItem('c002');
return {
  len: __VT__.state.bankCustom.length,
  hasC002: __VT__.state.bankCustom.some(c => c.id === 'c002'),
  totalRows: document.querySelectorAll('#s1List .s1-row').length,
  msg: document.getElementById('s1BankMsg').textContent,
};
`);
log('bankCustom 现在 1 条', afterDel.len === 1);
log('c002 已删除', afterDel.hasC002 === false);
log('row 总数 = 155（154 默认 + c001）', afterDel.totalRows === 155);
log('顶部消息含"已删除"', /已删除/.test(afterDel.msg));

// ========== 9. importBankText - 模拟导入 ==========
const afterImp = await evalExpr(`
window.confirm = () => true;
// 准备一个本地 JSON：包含 1 个新 id、1 个与 c001 id 重复、1 个与默认 v001 id 冲突
const fakeJson = JSON.stringify({
  name: 'fake bank',
  items: [
    { id: 'x001', group: 'J—L', name: '真实', desc: 'authenticity' },
    { id: 'c001', group: 'A—C', name: '原创力 v2', desc: 'update via import' },  // 已存在
    { id: 'v001', group: 'A—C', name: '丰富(覆盖默认)', desc: 'should be skipped' },  // 默认 id 冲突
  ]
});
return __VT__.importBankText(fakeJson);
`);
log('importBankText 返回 ok=true', afterImp.ok === true);
log('added=1（新 x001）', afterImp.added === 1);
log('updated=1（c001 重复）', afterImp.updated === 1);
log('skippedDefault=1（v001 与默认冲突）', afterImp.skippedDefault === 1);

// 验证 c001 被覆盖
const afterImpState = await evalExpr(`return __VT__.state.bankCustom.find(c => c.id === 'c001');`);
log('c001 已被 import 覆盖为"原创力 v2"', afterImpState.name === '原创力 v2');

// ========== 10. 验证默认题 v001 没被破坏 ==========
const v001 = await evalExpr(`return __VT__.state.bank.items.find(it => it.id === 'v001');`);
log('默认题 v001.name 仍是"丰富"（未覆盖）', v001.name === '丰富');

// ========== 11. restoreBank ==========
const afterRestore = await evalExpr(`
window.confirm = () => true;
__VT__.restoreBank();
return {
  len: __VT__.state.bankCustom.length,
  hasC001: __VT__.state.bankCustom.some(c => c.id === 'c001'),
  totalRows: document.querySelectorAll('#s1List .s1-row').length,
  hasAnsC001: 'c001' in __VT__.state.answers,
  msg: document.getElementById('s1BankMsg').textContent,
};
`);
log('restoreBank 后 bankCustom=0', afterRestore.len === 0);
log('c001 不再存在', afterRestore.hasC001 === false);
log('row 总数 = 154', afterRestore.totalRows === 154);
log('c001 答案被清除', afterRestore.hasAnsC001 === false);

// ========== 12. localStorage 持久化 - 模拟刷新 ==========
const persist = await evalExpr(`
__VT__.openAddPanel();
document.getElementById('s1AddName').value = '持久测试';
document.getElementById('s1AddDesc').value = '过了刷新还在';
document.getElementById('s1AddGroup').value = 'A—C';
__VT__.saveAddItem();
__VT__.setMarkS1(__VT__.state.bankCustom[0].id, 3);
const json = __VT__.buildBankJson();
const parsed = JSON.parse(json);
return {
  custom: __VT__.state.bankCustom.length,
  nextId: __VT__.state.nextCustomId,
  step: __VT__.state.step,
  ans: Object.assign({}, __VT__.state.answers),
  export: { valid: parsed && Array.isArray(parsed.items), itemCount: parsed.items.length, firstItem: parsed.items.find(it => it.id === __VT__.state.bankCustom[0].id) }
};
`);
console.log('\n[persist] before reload:', persist);

// 真模拟刷新用 location.reload + 再次 navigation
loadFired = false;
await send('Page.reload');
for (let i = 0; i < 80 && !loadFired; i++){ await sleep(100); }
await sleep(800);

const afterReload = await evalExpr(`
return {
  custom: __VT__.state.bankCustom.length,
  nextId: __VT__.state.nextCustomId,
  itemName: __VT__.state.bankCustom[0].name,
  mark: __VT__.state.answers[__VT__.state.bankCustom[0].id].mark,
};
`);
log('刷新后 bankCustom 仍 = '+persist.custom, afterReload.custom === persist.custom);
log('刷新后 nextCustomId 仍 = '+persist.nextId, afterReload.nextId === persist.nextId);
log('刷新后自建题名仍在', afterReload.itemName === '持久测试');
log('刷新后 mark=3 仍在', afterReload.mark === 3);

// ========== 12b. export 然后 importBankText 双向通 ==========
log('export: JSON 合法', persist.export.valid);
log('export: items 数 >= 155', persist.export.itemCount >= 155);
log('export: 自建题已含', persist.export.firstItem && persist.export.firstItem.name === '持久测试' && persist.export.firstItem.custom === true);

// ========== 13. console errors ==========
console.log('\n[console] msgs=' + consoleMsgs.length + ' · pageErrors=' + pageErrors.length);
if(pageErrors.length){
  for(const e of pageErrors) console.log('  !', String(e.msg).slice(0, 200));
} else {
  console.log('  ✓ zero page errors');
}

ws.close();
await sleep(200);
process.exit(pageErrors.length ? 1 : 0);
