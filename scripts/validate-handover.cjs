#!/usr/bin/env node
// 부서 인수인계 자료(data/import-handover.json, data/handover-<부서id>.json)가 매뉴얼 기준을 지키는지 검사.
//   node scripts/validate-handover.cjs data/handover-sales.json
// 기준은 lib/importHandover.js 의 validateImportHandover 그대로(6항목·단계 번호·확정/추정과 근거·쓰지 않는 말).
// 추가로: 사람 이름은 practicedBy 에만, 전화번호·메일 주소 금지, 업무표 줄 수 최소치.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const repo = path.join(__dirname, '..');
const strip = (src) => src.replace(/^import (\w+) from '(fs|path)';/gm, "const $1 = require('$2');").replace(/^export (const|function|async function) /gm, '$1 ');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-'));
fs.writeFileSync(path.join(tmp, 'ih.cjs'), strip(fs.readFileSync(path.join(repo, 'lib', 'importHandover.js'), 'utf8')) + '\nmodule.exports = { validateImportHandover, BANNED_WORDS };');
const H = require(path.join(tmp, 'ih.cjs'));
const guides = JSON.parse(fs.readFileSync(path.join(repo, 'config', 'workflow-guides.json'), 'utf8')).workflows;

function check(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = H.validateImportHandover(data, guides);
  const raw = JSON.stringify(data);
  if (!data.dept) out.push('dept(부서 이름) 필요');
  for (const k of ['daily', 'weekly']) if (!(data.schedule?.[k]?.length >= 3)) out.push(`schedule.${k} 3줄 이상`);
  if (!(data.manuals?.length >= 3)) out.push('매뉴얼 3편 이상');
  if (!Array.isArray(data.questions)) out.push('questions 배열 필요');
  if (/01[016789][- ]?\d{3,4}[- ]?\d{4}/.test(raw) || /0\d{1,2}-\d{3,4}-\d{4}/.test(raw)) out.push('전화번호가 들어 있음');
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(raw)) out.push('메일 주소가 들어 있음');
  // 사람 이름은 practicedBy 에만 — 본문에 같은 이름이 나오면 안 된다
  const names = [...new Set((data.manuals || []).flatMap((m) => m.practicedBy || []))];
  const body = JSON.stringify({ ...data, manuals: (data.manuals || []).map((m) => ({ ...m, practicedBy: [] })) });
  for (const n of names) if (n && body.includes(n)) out.push(`사람 이름이 본문에 있음: ${n} (practicedBy 에만 쓴다)`);
  return out;
}
module.exports = { check };
if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('검사할 파일을 적어 주세요'); process.exit(1); }
  let bad = 0;
  for (const f of files) { const out = check(f); if (out.length) { bad++; console.log(`✗ ${f}\n  - ` + out.join('\n  - ')); } else console.log(`✓ ${f}`); }
  process.exit(bad ? 1 : 0);
}
