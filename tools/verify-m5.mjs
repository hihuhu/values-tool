// M5 · 结果与导出页 + 导出/复制/打印/手机适配 验证
// 模式：自启 chrome → CDP → 关闭 chrome
import { spawn } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
function loadWs(){
  const tries = [
    () => require('ws'),
    () => require('C:/Users/HUHU/.workbuddy/binaries/node/versions/22.22.2-6/node_modules/@tencent/slidep/node_modules/ws')
  ];
  for(const t of tries){
    try { const w = t(); if(w) return w; } catch(e){}
  }
  throw new Error('Cannot find ws package');
}
const WebSocket = loadWs();

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HTML_PATH = 'file:///F:/project/tongji/values-tool/index.html';
const PORT = 9361;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jsonGet = u => new Promise((r,j) => http.get(u, x => { let d=''; x.on('data', c => d += c); x.on('end', () => { try{r(JSON.parse(d))}catch(e){r(null)} }); }).on('error', j));

// 1. 启 chrome
const userData = `C:\\Users\\HUHU\\AppData\\Local\\Temp\\vt-m5-${process.pid}`;
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

// reload 后需要重连 ws
async function reconnectAfterReload(){
  // 找当前 page tab
  const cur = await jsonGet(`http://127.0.0.1:${PORT}/json`);
  const t = cur.find(x => x.type === 'page') || cur[0];
  ws.close();
  const ws2 = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws2.on('open', r));
  // 替换 pending / send：旧的 request id 已不可用，清空
  id = 2;
  pending.clear();
  return ws2;
}

const log = (msg, ok) => console.log((ok?'✓ ':'✗ ') + msg);
let passed = 0, failed = 0;
const check = (name, cond, extra) => {
  if(cond){ passed++; console.log('✓ ' + name); }
  else    { failed++; console.log('✗ ' + name + (extra?' :: '+extra:'')); }
};

// 重置 localStorage + state 到干净状态，准备测试（避免 reload 断开 ws）
await evalExpr(`
  localStorage.removeItem('values-tool-v1');
  __VT__.state.answers = {};
  __VT__.state.shortlist = [];
  __VT__.state.bankCustom = [];
  __VT__.state.nextCustomId = 1;
  __VT__.state.ui = { step1:{q:'',onlyUn:false,autoNext:true,dense:false,keyhintShown:true}, step2:{sort:'order'} };
  __VT__.go(0);
  return true;
`);

console.log('\n=== A) view-3 基础存在 + 空状态 ===');
const a1 = await evalExpr(`
  __VT__.go(3);
  await new Promise(r => setTimeout(r, 200));
  const view = document.getElementById('view-3');
  return {
    on: view.classList.contains('on'),
    summaryExists: !!document.getElementById('s3Summary'),
    groupsExists: !!document.getElementById('s3Groups'),
    coreExists: !!document.getElementById('s3Core'),
    allExists: !!document.getElementById('s3All'),
    actionExists: !!document.getElementById('s3Action'),
    exportExists: !!document.getElementById('s3ExportMd'),
    copyExists: !!document.getElementById('s3CopyMd'),
    printExists: !!document.getElementById('s3Print'),
    importExists: !!document.getElementById('s3ImportBtn'),
    back2Exists: !!document.getElementById('s3Back2'),
    back0Exists: !!document.getElementById('s3Back0'),
    barExists: !!document.getElementById('s3Bar'),
  };
`);
check('view-3 on', a1.on);
check('s3Summary 存在', a1.summaryExists);
check('s3Groups 存在', a1.groupsExists);
check('s3Core 存在', a1.coreExists);
check('s3All 存在', a1.allExists);
check('s3Action 存在', a1.actionExists);
check('s3ExportMd 按钮', a1.exportExists);
check('s3CopyMd 按钮', a1.copyExists);
check('s3Print 按钮', a1.printExists);
check('s3ImportBtn 按钮', a1.importExists);
check('s3Back2 / s3Back0 按钮', a1.back2Exists && a1.back0Exists);
check('s3Bar 存在', a1.barExists);

console.log('\n=== B) 空状态文案 ===');
const b1 = await evalExpr(`
  return {
    coreEmpty: document.getElementById('s3Core').textContent.trim(),
    allEmpty: document.getElementById('s3All').textContent.trim(),
    actionHidden: document.getElementById('s3ActionCard').hidden,
  };
`);
check('核心价值空状态文案含"空"', /空/.test(b1.coreEmpty));
check('全部清单空状态文案含"暂无"', /暂无/.test(b1.allEmpty));
check('行动建议 hidden=true', b1.actionHidden === true);

console.log('\n=== C) 第二步"下一步"按钮存在 + 跳转 ===');
const c1 = await evalExpr(`
  __VT__.go(2);
  await new Promise(r => setTimeout(r, 200));
  const btn = document.getElementById('s2NextBtn');
  return { exists: !!btn, visible: btn && getComputedStyle(btn).display !== 'none' };
`);
check('第二步"s2NextBtn" 存在', c1.exists);
check('第二步"s2NextBtn" 可见', c1.visible);

const c2 = await evalExpr(`
  document.getElementById('s2NextBtn').click();
  await new Promise(r => setTimeout(r, 300));
  return {
    step: __VT__.state.step,
    view3On: document.getElementById('view-3').classList.contains('on'),
  };
`);
check('点击"s2NextBtn" → state.step=3', c2.step === 3);
check('点击"s2NextBtn" → view-3 on', c2.view3On === true);

console.log('\n=== D) 准备测试数据：6 个 mark=3，5 个打分完整，1 个孤儿 ===');
const d1 = await evalExpr(`
  // 直接清 state（避免 reload 断开 ws）
  __VT__.state.answers = {};
  __VT__.state.shortlist = [];
  localStorage.removeItem('values-tool-v1');
  __VT__.go(1);
  await new Promise(r => setTimeout(r, 200));
  // 6 个标非常重要
  ['v001','v005','v010','v020','v030','v040'].forEach(id => __VT__.setMarkS1(id, 3));
  // 2 个标一般重要
  ['v002','v015'].forEach(id => __VT__.setMarkS1(id, 2));
  // 2 个标完全不重要
  ['v003','v050'].forEach(id => __VT__.setMarkS1(id, 1));
  // 同步到第二步
  __VT__.syncFromStep1();
  await new Promise(r => setTimeout(r, 200));
  // 给 6 个打分（含孤儿 v040）
  __VT__.state.answers.v001.importance = 5; __VT__.state.answers.v001.consistency = 5; // gap=0 ok
  __VT__.state.answers.v005.importance = 5; __VT__.state.answers.v005.consistency = 2; // gap=+3 bad-huge
  __VT__.state.answers.v010.importance = 4; __VT__.state.answers.v010.consistency = 3; // gap=+1 warn
  __VT__.state.answers.v020.importance = 5; __VT__.state.answers.v020.consistency = 3; // gap=+2 bad
  __VT__.state.answers.v030.importance = 3; __VT__.state.answers.v030.consistency = 3; // gap=0 ok
  __VT__.state.answers.v040.importance = 5; __VT__.state.answers.v040.consistency = 1; // gap=+4 bad-huge
  // 让 v040 成为孤儿：先打分（让 setMarkS1 不会因 importance==null 把整条删除）
  // 再取消第一步标记 → mark=0 但 importance/consistency 保留 → v040 仍在第二步但 mark=0（orphan）
  __VT__.setMarkS1('v040', 0);
  // 保存到 localStorage 并跳到结果页
  __VT__.save();
  __VT__.go(3);
  await new Promise(r => setTimeout(r, 300));
  return {
    shortlistLen: __VT__.state.shortlist.length,
    n3Marked: Object.values(__VT__.state.answers).filter(a => a.mark === 3).length,
    scoredLen: Object.values(__VT__.state.answers).filter(a => a.importance != null && a.consistency != null).length,
  };
`);
check('shortlist 长度 = 6', d1.shortlistLen === 6);
check('mark=3 数 = 5 (v040 已取消)', d1.n3Marked === 5);
check('已打分数 = 6', d1.scoredLen === 6);

console.log('\n=== E) 摘要渲染 ===');
const e1 = await evalExpr(`
  const sum = document.getElementById('s3Summary');
  const cells = Array.from(sum.children).map(c => ({
    label: c.querySelector('small').textContent,
    value: c.querySelector('b').textContent,
    cls: c.querySelector('b').className
  }));
  return { cells, barW: document.getElementById('s3Bar').style.width };
`);
console.log('   ' + JSON.stringify(e1.cells));
check('摘要 5 个指标', e1.cells.length === 5);
check('勾选总数 = 9/154 (mark=0 的孤儿 v040 不算勾选)', e1.cells[0].value === '9 / 154');
check('非常重要 = 5', e1.cells[1].value === '5');
check('平均重要性 = 4.50', e1.cells[2].value === '4.50');
check('平均一致性 = 2.83', e1.cells[3].value === '2.83');
check('最大差距 = +4', e1.cells[4].value === '+4');
check('最大差距 warn 类', /warn/.test(e1.cells[4].cls));
check('s3Bar 宽度 ≈ 5.8%', /^5\.[78]\d*%$/.test(e1.barW));

console.log('\n=== F) 分组概览 ===');
const f1 = await evalExpr(`
  const rows = document.querySelectorAll('#s3Groups .s3-group-row');
  return Array.from(rows).map(r => ({
    name: r.querySelector('.g-name').textContent,
    legend: r.querySelector('.g-legend').textContent.trim(),
    segs: Array.from(r.querySelectorAll('.g-seg')).map(s => s.className)
  }));
`);
check('分组行数 = 5', f1.length === 5);
// 应该都在 A-C 组（v001 v002 v003 v005 v010 v015 v020 v030 v040 v050）：分别 3=5, 2=2, 1=2 = 9
// 但 v040 在 A-C 已被取消 mark=0，所以 A-C 显示 3=4
// 简化：仅校验每组有 name + 至少一个分组有 seg
const hasAnySeg = f1.some(r => r.segs.length > 0);
check('至少一个分组有 seg', hasAnySeg);
const firstRowLegendHas3 = f1[0] && /3=/.test(f1[0].legend);
check('第一行 legend 含 3= 计数', firstRowLegendHas3);

console.log('\n=== G) 核心价值清单（按差距排序） ===');
const g1 = await evalExpr(`
  const rows = Array.from(document.querySelectorAll('#s3Core tbody tr'));
  return rows.map(r => ({
    id: r.querySelector('.idx').textContent,
    name: r.querySelector('.nm').textContent.trim(),
    grp: r.querySelector('.s3-group-cell').textContent,
    imp: r.querySelectorAll('.num')[0].textContent,
    con: r.querySelectorAll('.num')[1].textContent,
    gap: r.querySelector('.gp').textContent,
    isOrphan: r.classList.contains('is-orphan')
  }));
`);
check('核心价值 6 行（shortlist）', g1.length === 6);
// 排序：第一行应该是 +4 (v040 孤儿)
check('第一行 gap = +4', g1[0] && g1[0].gap === '+4');
check('第一行 is-orphan', g1[0] && g1[0].isOrphan === true);
// 第二行 +3
check('第二行 gap = +3', g1[1] && g1[1].gap === '+3');
// 第三行 +2
check('第三行 gap = +2', g1[2] && g1[2].gap === '+2');
// 末位 gap = 0 (v030)
check('末位 gap = +0', g1[5] && (g1[5].gap === '+0' || g1[5].gap === '0'));

console.log('\n=== H) 全部勾选清单 ===');
const h1 = await evalExpr(`
  const secs = document.querySelectorAll('#s3All .s3-all-sec');
  const secLabels = Array.from(document.querySelectorAll('#s3All .s3-all-head h3')).map(h => h.textContent.trim());
  const allRows = document.querySelectorAll('#s3All .s3-all-row').length;
  // 第一档（非常重要）的行数
  const firstSec = secs[0];
  const firstRows = firstSec ? firstSec.querySelectorAll('.s3-all-row').length : 0;
  // orphan 是否在"非常重要"段（不应该）
  const v040InFirst = !!document.querySelector('#s3All .s3-all-row[data-id="v040"]');
  return { secCount: secs.length, labels: secLabels, allRows, firstRows, v040InFirst };
`);
check('全部清单有 3 个段', h1.secCount === 3);
check('3 个段标题为：非常重要 / 一般重要 / 完全不重要', h1.labels.includes('非常重要') && h1.labels.includes('一般重要') && h1.labels.includes('完全不重要'));
check('全部清单合计 9 行（5+2+2，孤儿不算 mark=3 任何档）', h1.allRows === 9);
check('「非常重要」段 5 行 (v001 v005 v010 v020 v030)', h1.firstRows === 5);
check('孤儿 v040 不在"非常重要"段', h1.v040InFirst === false);

console.log('\n=== I) 行动建议 ===');
const i1 = await evalExpr(`
  const card = document.getElementById('s3ActionCard');
  const items = document.querySelectorAll('#s3Action .s3-action-item');
  return {
    hidden: card.hidden,
    count: items.length,
    firstTitle: items[0] && items[0].querySelector('.ai-title').textContent.trim(),
    firstRank: items[0] && items[0].querySelector('.ai-rank').textContent.trim(),
    firstDesc: items[0] && items[0].querySelector('.ai-desc').textContent.trim()
  };
`);
check('行动建议 hidden=false', i1.hidden === false);
check('行动建议 top 3', i1.count === 3);
check('第一条 rank = "1"', i1.firstRank === '1');
check('第一条 title 含"差距"', /差距/.test(i1.firstTitle));
check('第一条 desc 含"重要性"和"一致性"', /重要性/.test(i1.firstDesc) && /一致性/.test(i1.firstDesc));

console.log('\n=== J) Markdown / TXT / JSON 内容 ===');
const j1 = await evalExpr(`
  const md = __VT__._buildMarkdown();
  const tx = __VT__._buildTxt();
  const js = __VT__._buildJson();
  return {
    md,
    mdLen: md.length,
    mdHasTitle: /# 价值观梳理结果/.test(md),
    mdHasSummary: /## 全局摘要/.test(md),
    mdHasGroupTable: /## 各分组勾选分布/.test(md) && /\| 分组 \|/.test(md),
    mdHasCoreTable: /## 核心价值清单/.test(md) && /\| # \| 价值词/.test(md),
    mdHasAction: /## 行动建议/.test(md),
    mdHasAll: /## 非常重要/.test(md) && /## 一般重要/.test(md) && /## 完全不重要/.test(md),
    mdHasV040: /v040|被取消/.test(md) || /第一步已取消/.test(md),
    txLen: tx.length,
    txHasNo: tx.length > 0 && tx.indexOf('|') < 0,  // txt 应该没有 | 表格标记（简化检查）
    jsOk: (() => { try { const o = JSON.parse(js); return o.schemaVersion === 1 && o.shortlist.length === 6 && o.answers.v005; } catch(e){ return false; } })()
  };
`);
console.log('   md length=' + j1.mdLen + '  tx length=' + j1.txLen);
check('md 含主标题', j1.mdHasTitle);
check('md 含全局摘要段', j1.mdHasSummary);
check('md 含分组表（管道符号）', j1.mdHasGroupTable);
check('md 含核心价值表', j1.mdHasCoreTable);
check('md 含行动建议段', j1.mdHasAction);
check('md 含全部三档清单', j1.mdHasAll);
check('md 标注了 orphan v040', j1.mdHasV040);
check('txt 非空且无 markdown 表格标记', j1.txLen > 100 && j1.txHasNo);
check('json 解析 OK 且 schemaVersion=1', j1.jsOk);

console.log('\n=== K) 复制 Markdown ===');
const k1 = await evalExpr(`
  // 直接调用：模拟剪贴板不可用，但 execCommand 降级也应成功
  // navigator.clipboard 在 file:// 下可能不可用；测试覆盖层
  const md = __VT__._buildMarkdown();
  return {
    mdLength: md.length,
    hasClipboard: !!(navigator.clipboard && navigator.clipboard.writeText),
    hasExecCommand: !!document.execCommand
  };
`);
check('md 内容 > 500 字', k1.mdLength > 500);
check('剪贴板能力检测完成（hasClipboard / hasExecCommand 任一为 true）', k1.hasClipboard || k1.hasExecCommand);

console.log('\n=== L) 打印样式（CSS 媒体查询） ===');
// 通过 CDP 模拟 print 媒体类型
await send('Emulation.setEmulatedMedia', { media: 'print' });
await sleep(200);
const l1 = await evalExpr(`
  const styleOf = sel => {
    const el = document.querySelector(sel);
    if(!el) return null;
    return getComputedStyle(el).display;
  };
  return {
    steps: styleOf('.steps'),
    backToTop: styleOf('#backToTop'),
    exportCard: styleOf('.s3-export-card'),
    s3Nav: styleOf('.s3-nav'),
    debug: styleOf('.debugrp'),
    banner: styleOf('#banner'),
    view3On: document.getElementById('view-3').classList.contains('on'),
    bodyBg: getComputedStyle(document.body).backgroundColor,
  };
`);
check('print: 步骤条 hidden', l1.steps === 'none');
check('print: 回到顶部 hidden', l1.backToTop === 'none');
check('print: 导出按钮区 hidden', l1.exportCard === 'none');
check('print: 结果页底部导航 hidden', l1.s3Nav === 'none');
check('print: 调试条 hidden', l1.debug === 'none');
check('print: banner hidden', l1.banner === 'none');
check('print: view-3 仍 on', l1.view3On === true);
check('print: body 背景白色', /255.*255.*255/.test(l1.bodyBg));
// 恢复
await send('Emulation.setEmulatedMedia', { media: 'screen' });
await sleep(200);

console.log('\n=== M) 手机适配（375px） ===');
await send('Emulation.setDeviceMetricsOverride', { width:375, height:720, deviceScaleFactor:2, mobile:true });
await sleep(300);
const m1 = await evalExpr(`
  __VT__.go(3);
  await new Promise(r => setTimeout(r, 300));
  return {
    width: window.innerWidth,
    summaryCols: getComputedStyle(document.getElementById('s3Summary')).gridTemplateColumns.split(' ').length,
    exportToolsDisplay: getComputedStyle(document.querySelector('.s3-export-tools')).display,
    coreTableDisplay: getComputedStyle(document.querySelector('.s3-core-table')).display,
    s3NavDir: getComputedStyle(document.querySelector('.s3-nav')).flexDirection,
    groupRowCols: getComputedStyle(document.querySelector('.s3-group-row')).gridTemplateColumns.split(' ').length,
    coreTheadDisplay: getComputedStyle(document.querySelector('.s3-core-table thead')).display
  };
`);
console.log('   ' + JSON.stringify(m1));
check('viewport = 375', m1.width === 375);
check('摘要 5列 → 2列', m1.summaryCols === 2);
check('导出按钮 grid 布局', /grid/.test(m1.exportToolsDisplay));
check('核心价值表 = block (转卡片)', m1.coreTableDisplay === 'block');
check('核心价值表 thead 隐藏', m1.coreTheadDisplay === 'none');
check('s3-nav column-reverse', m1.s3NavDir === 'column-reverse');
check('分组行 3 列', m1.groupRowCols === 3);

await send('Emulation.clearDeviceMetricsOverride');
await sleep(200);

console.log('\n=== N) 导出答案 JSON → 导入往返 ===');
const n1 = await evalExpr(`
  // 触发 JSON 字符串并 parse 验证
  const js = __VT__._buildJson();
  // 清空 state 后再 restore
  const obj = JSON.parse(js);
  __VT__.state.answers = {};
  __VT__.state.shortlist = [];
  __VT__.save();
  __VT__.go(3);
  await new Promise(r => setTimeout(r, 200));
  // 模拟"导入"：直接调用 _handleImportText 但 mock confirm
  window.confirm = () => true;
  const ok = __VT__._handleImportText(js);
  await new Promise(r => setTimeout(r, 300));
  return {
    ok,
    shortlistAfter: __VT__.state.shortlist.length,
    n3After: Object.values(__VT__.state.answers).filter(a => a.mark === 3).length,
    msg: document.getElementById('s3ExportMsg').textContent,
    msgCls: document.getElementById('s3ExportMsg').className
  };
`);
check('导入 ok=true', n1.ok === true);
check('导入后 shortlist = 6', n1.shortlistAfter === 6);
check('导入后 mark=3 = 5', n1.n3After === 5);
check('导入后 msg 含"导入完成"', /导入完成/.test(n1.msg));
check('导入后 msg ok 类', /ok/.test(n1.msgCls));

console.log('\n=== O) 错误拒绝（schemaVersion 不匹配） ===');
const o1 = await evalExpr(`
  window.confirm = () => true;
  const ok = __VT__._handleImportText('{"schemaVersion":999,"answers":{}}');
  await new Promise(r => setTimeout(r, 200));
  return {
    okReturned: ok,
    msg: document.getElementById('s3ExportMsg').textContent,
    msgCls: document.getElementById('s3ExportMsg').className
  };
`);
check('schemaVersion 不匹配 → ok=false', o1.okReturned === false);
check('schemaVersion 不匹配 → msg 含 "schemaVersion"', /schemaVersion/.test(o1.msg));
check('schemaVersion 不匹配 → bad 类', /bad/.test(o1.msgCls));

console.log('\n=== P) s3Back2 / s3Back0 导航 ===');
const p1 = await evalExpr(`
  document.getElementById('s3Back2').click();
  await new Promise(r => setTimeout(r, 200));
  const s2 = __VT__.state.step;
  document.getElementById('s3Back2').click();  // 不会触发因为在 step2 上，但实际是 btn 在 step3 上才有，所以先 go(3)
  __VT__.go(3);
  await new Promise(r => setTimeout(r, 200));
  document.getElementById('s3Back0').click();
  await new Promise(r => setTimeout(r, 200));
  const s0 = __VT__.state.step;
  return { s2, s0 };
`);
check('s3Back2 → step=2', p1.s2 === 2);
check('s3Back0 → step=0', p1.s0 === 0);

console.log('\n=== R) resetAll 主动刷全部视图（修复前 view-1 row 残留 data-v） ===');
const r1 = await evalExpr(`
  // 准备：标 6 个 mark=3 + 给其中 4 个打分 + sync + 进 view-2
  __VT__.state.answers = {};
  __VT__.state.shortlist = [];
  __VT__.go(1);
  await new Promise(r => setTimeout(r, 200));
  ['v001','v005','v010','v020','v030','v040'].forEach(id => __VT__.setMarkS1(id, 3));
  ['v002','v007'].forEach(id => __VT__.setMarkS1(id, 2));
  __VT__.syncFromStep1();
  __VT__.state.answers.v001.importance = 5; __VT__.state.answers.v001.consistency = 5;
  __VT__.state.answers.v005.importance = 5; __VT__.state.answers.v005.consistency = 2;
  __VT__.state.answers.v010.importance = 4; __VT__.state.answers.v010.consistency = 3;
  __VT__.state.answers.v020.importance = 5; __VT__.state.answers.v020.consistency = 3;
  await new Promise(r => setTimeout(r, 200));
  __VT__.go(2);
  await new Promise(r => setTimeout(r, 200));

  const beforeReset = {
    s1RowsWithV: document.querySelectorAll('#s1List .s1-row[data-v]').length,
    s2TbodyRows: document.querySelectorAll('#s2Body tr').length,
    s2RankRows: document.querySelectorAll('#s2Rank .s2-rank-row').length,
  };

  // 回开始页点 resetAll
  window.confirm = () => true;
  __VT__.go(0);
  await new Promise(r => setTimeout(r, 100));
  document.getElementById('btnResetAll').click();
  await new Promise(r => setTimeout(r, 300));

  // 不切视图，直接看各 view 的 DOM 残留
  const immediate = {
    s1RowsWithV: document.querySelectorAll('#s1List .s1-row[data-v]').length,
    s2TbodyRows: document.querySelectorAll('#s2Body tr').length,
    s2RankRows: document.querySelectorAll('#s2Rank .s2-rank-row').length,
    s2Scored: document.getElementById('s2Scored').textContent,
    s2N3: document.getElementById('s2N3').textContent,
    s3SummaryValue: document.querySelector('#s3Summary b').textContent,
    s3CoreRows: document.querySelectorAll('#s3Core tbody tr').length,
    s3AllRows: document.querySelectorAll('#s3All .s3-all-row').length,
  };

  // state 也应该清空
  const afterState = {
    answers: Object.keys(__VT__.state.answers).length,
    shortlist: __VT__.state.shortlist.length,
    step: __VT__.state.step,
  };

  return { beforeReset, immediate, afterState };
`);
check('reset 前 view-1 有 11 行 data-v（D 测试残留 + R 测试新增）', r1.beforeReset.s1RowsWithV === 11);
check('reset 前 view-2 有 6 行 tbody', r1.beforeReset.s2TbodyRows === 6);
check('reset 前 view-2 有 4 行排行', r1.beforeReset.s2RankRows === 4);
check('reset 后 view-1 row data-v 全清（=0）', r1.immediate.s1RowsWithV === 0);
check('reset 后 view-2 tbody 全清（=0）', r1.immediate.s2TbodyRows === 0);
check('reset 后 view-2 排行 全清（=0）', r1.immediate.s2RankRows === 0);
check('reset 后 s2Scored = "0 / 0"', r1.immediate.s2Scored === '0 / 0');
check('reset 后 s2N3 = "0"', r1.immediate.s2N3 === '0');
check('reset 后 view-3 摘要 = "0 / 154"', r1.immediate.s3SummaryValue === '0 / 154');
check('reset 后 view-3 核心价值 0 行', r1.immediate.s3CoreRows === 0);
check('reset 后 view-3 全部清单 0 行', r1.immediate.s3AllRows === 0);
check('reset 后 state.answers = {}', r1.afterState.answers === 0);
check('reset 后 state.shortlist = []', r1.afterState.shortlist === 0);
check('reset 后 state.step = 0', r1.afterState.step === 0);

// 验证：reset 后用户重新进 view-1，应该一切干净（顶部统计 + UI 控件）
const r2 = await evalExpr(`
  __VT__.go(1);
  // 等到 onboarding setTimeout 250ms 触发
  await new Promise(r => setTimeout(r, 600));
  return {
    n3: document.getElementById('s1N3').textContent,
    n2: document.getElementById('s1N2').textContent,
    n1: document.getElementById('s1N1').textContent,
    rowsWithV: document.querySelectorAll('#s1List .s1-row[data-v]').length,
    // 同时验证 search 框被清空（ui 重置了）
    searchValue: document.getElementById('s1Q').value,
    // onboarding 气泡会被重新弹（keyhintShown 被重置为 false）
    onboardShown: !document.getElementById('s1Onboard').hidden,
    keyhintShown: __VT__.state.ui.step1.keyhintShown,
  };
`);
check('reset 后进 view-1: s1N3=0', r2.n3 === '0');
check('reset 后进 view-1: s1N2=0', r2.n2 === '0');
check('reset 后进 view-1: s1N1=0', r2.n1 === '0');
check('reset 后进 view-1: rowsWithV=0', r2.rowsWithV === 0);
check('reset 后进 view-1: 搜索框清空', r2.searchValue === '');
check('reset 后进 view-1: onboarding 重新弹出', r2.onboardShown === true);

console.log('\n=== Q) Errors ===');
if(pageErrors.length){ failed++; console.log('✗ page errors:'); pageErrors.forEach(e => console.log(' ', e)); }
else { passed++; console.log('✓ 0 page error'); }
const errs = consoleMsgs.filter(m => m.t === 'error');
if(errs.length){ failed++; console.log('✗ console errors:'); errs.forEach(m => console.log(' ', m.text)); }
else { passed++; console.log('✓ 0 console error'); }

// 4. 关闭
ws.close();
try { spawn('taskkill', ['/PID', c.pid, '/F', '/T'], { stdio:'ignore' }); } catch{}
console.log(`\n=== 总结 ===\n通过 ${passed} · 失败 ${failed}`);
process.exit(failed ? 1 : 0);