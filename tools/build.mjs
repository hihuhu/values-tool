// Build script: 把 values-bank.json 内联进 index.html，生成单文件应用
// 用法：node tools/build.mjs
// 输出：index.html（包含全部题库数据，无需外部文件）

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TPL = join(ROOT, 'index.template.html');
const OUT = join(ROOT, 'index.html');
const BANK = join(ROOT, 'values-bank.json');

const tpl = readFileSync(TPL, 'utf8');
const bank = JSON.parse(readFileSync(BANK, 'utf8'));

// 把 items 包成一个完整数组字面量（前后 [] + 逗号+换行的项目），替换模板中 [/*__BANK_ITEMS__*/] 占位符
// build 时把 merged 字段过滤掉（PRD 没要求展示；UI 不显示）
const itemsArray = '[\n' + bank.items.map(it => {
  const { merged, ...rest } = it;
  return '  ' + JSON.stringify(rest);
}).join(',\n') + '\n]';

const out = tpl
  .replace('[/*__BANK_ITEMS__*/]', itemsArray)
  .replace('__BANK_GROUPS__', JSON.stringify(bank.groups))
  .replace('__BANK_VERSION__', JSON.stringify(bank.version || '1.0'))
  .replace('__BANK_NOTE__', JSON.stringify(bank.note || ''))
  .replace('__BANK_NAME__', JSON.stringify(bank.name || '价值观题库'))
  .replace('__BANK_GENERATED__', JSON.stringify(bank.generatedAt || ''));

writeFileSync(OUT, out, 'utf8');
console.log(`OK · generated index.html with ${bank.items.length} bank items, ${bank.groups.length} groups`);
