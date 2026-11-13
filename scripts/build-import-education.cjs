// data/import-education.json 을 만든다 — 수입부 신입 교육 화면(부서별 업무 매뉴얼 › 수입부 인수인계 업무표 › 신입 교육)의 자료.
//   입력: 분석 결과 두 파일(저장소 밖). 사용법: node scripts/build-import-education.cjs <분석 폴더>
//     erp-files-edu.json  전산 기록(SELECT 만)·엑셀 기록·해독 안 된 화면 기록에서 뽑은 것
//     kakao-edu.json      카카오톡 업무방 기록에서 뽑은 것(역할 기준, 개인 이름·연락처·금액 없음)
//   화면에 필요한 만큼만 줄여 저장한다. 사람별 건수·근무 시간은 넣지 않는다(주어는 업무 절차).
const fs = require('node:fs'), path = require('node:path');
const dir = process.argv[2]; if (!dir) { console.error('분석 폴더 경로가 필요합니다'); process.exit(1); }
const read = f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } };
const erp = read('erp-files-edu.json'), kakao = read('kakao-edu.json'), trig = read('trigger-chains.json');
if (!erp) { console.error('erp-files-edu.json 없음'); process.exit(1); }
const cut = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];

// 1) 나라별 카드: 입고 요일 규칙·한 건의 크기·주요 농장·품목 규칙
const totalBy = {}; for (const r of erp.countryCalendar) totalBy[r.country] = (totalBy[r.country] || 0) + r.count;
const countries = Object.entries(totalBy).sort((a, b) => b[1] - a[1]).filter(([, n]) => n >= 5).map(([country, receipts]) => {
  const heat = {}; for (const r of erp.countryCalendar) if (r.country === country) heat[`${r.weekday}-${r.hour}`] = (heat[`${r.weekday}-${r.hour}`] || 0) + r.count;
  const subs = erp.subWeekday.filter(s => s.country === country).map(s => { const top = Object.entries(s.weekday).sort((a, b) => b[1] - a[1]); return { sub: s.sub, total: s.total, weekday: s.weekday, rule: `${top[0][0]}요일 ${top[0][1].toLocaleString()}건(${Math.round(top[0][1] / s.total * 100)}%)` }; }).sort((a, b) => a.sub.localeCompare(b.sub));
  const size = erp.sizes.find(s => s.country === country) || {};
  const farms = erp.farms.filter(f => f.country === country).sort((a, b) => b.count12m - a.count12m);
  const products = erp.productDict.filter(p => p.country === country).sort((a, b) => b.count - a.count).slice(0, 8).map(p => ({ flower: p.flower, count: p.count, unitCombo: p.unitCombo, examples: (p.examples || []).slice(0, 3) }));
  const freight = (erp.freight?.lines || []).filter(l => l.country === country).map(l => `${l.lineName} ${l.count}건`);
  return { country, receipts, heat, subs, linesMedian: size.linesMedian ?? null, boxMedian: size.boxMedian ?? null, farmCount: farms.length, farms: farms.slice(0, 12).map(f => ({ farm: f.farm, count: f.count12m, last: f.lastDate, flowers: f.flowers, weekday: f.weekday })), products, freight };
});

// 2) 담당자 주간 일정표(나라×요일) — 담당자가 직접 적어 둔 표
const weeklySheet = erp.weeklySheet ? { period: erp.weeklySheet.editedPeriod, rows: erp.weeklySheet.rows.map(r => ({ country: r.label || r.country, cells: Object.fromEntries(DAYS.filter(d => r.cells?.[d]).map(d => [d, cut(r.cells[d], 220)])) })) } : null;

// 3) 파일 이름 사전·엑셀 양식·지출결의서 적요
const kinds = {}; for (const f of erp.fileNames) { const k = f.kind || '미분류'; (kinds[k] = kinds[k] || { kind: k, count: 0, patterns: [] }); kinds[k].count += f.count; if (kinds[k].patterns.length < 6 && !/kakao files/.test(f.pattern)) kinds[k].patterns.push({ pattern: cut(f.pattern, 70), count: f.count, example: cut((f.examples || [])[0], 70) }); }
const fileKinds = Object.values(kinds).sort((a, b) => b.count - a.count);
const templates = (erp.templates || []).map(t => ({ file: t.file, sheetCount: (t.sheets || []).length, sheets: (t.sheets || []).slice(0, 6), headers: [...new Set((t.headers || []).flat(2).map(h => cut(String(h).replace(/^[A-Z]{1,2}:/, ''), 24)).filter(Boolean))].slice(0, 24) }));
const expenseLabels = (erp.expenseLabels || []).map(l => ({ label: l.label, count: l.count }));

// 4) 아직 분석에 안 잡힌 화면(해독이 안 된 쪽에 많이 나오는 창)
const blind = erp.undecoded ? { undecoded: erp.undecoded.totals.undecoded, decoded: erp.undecoded.totals.decoded, titles: (erp.undecoded.titles || []).filter(t => t.title && !/제목 없음/.test(t.title)).slice(0, 20).map(t => ({ title: cut(t.title, 60), undecoded: t.undecoded ?? t.u ?? t.count, decoded: t.decoded ?? t.d ?? null })) } : null;

// 5) 계기 사슬: 각 작업이 무엇을 계기로 시작되는지(직전에 들어온 것 → 확인하는 곳 → 하는 일)
const compactChains = t => !t ? null : { generatedAt: t.generatedAt, inputs: t.method?.inputs || null, chains: (t.chains || []).map(c => ({
  id: c.id, action: c.action, anchor: cut(c.anchor, 160), windowMin: c.window?.minutes ?? null, status: c.status, basis: cut(c.statusBasis, 260), summary: c.summary,
  when: [...(c.timing?.weekdayTop || []), ...(c.timing?.hourTop || [])].join(' · '), anchors: c.counts?.anchors ?? null,
  signals: [...(c.signals || [])].sort((a, b) => (b.beyondChance ? 1 : 0) - (a.beyondChance ? 1 : 0) || (b.lift || 0) - (a.lift || 0)).slice(0, 6).map(s => ({ source: s.source, where: cut(s.where, 60), who: s.who, what: cut(s.what, 90), share: s.share, base: s.base, lag: s.lagMedianMin, strong: !!s.beyondChance })),
  fields: (c.fields || []).map(x => ({ field: x.field, from: cut(x.from, 200), basis: cut(x.basis, 160) })),
  cases: (c.manualCases || []).slice(0, 2).map(x => cut(x, 420)), handoff: cut(c.handoff, 220), question: c.question || null, unverified: (c.unverified || []).slice(0, 4).map(x => cut(x, 140)),
})) };
const data = {
  version: 1, updatedAt: new Date().toISOString().slice(0, 10),
  basis: { receipts12m: Object.values(totalBy).reduce((a, b) => a + b, 0), window: erp.meta?.window12m, perWeekMedian: erp.perWeek?.median, perSubWeekMedian: erp.perSubWeek?.median, farms12m: erp.idleFarms?.farmsIn12m, countryNote: '입고 기록에 나라 칸이 없어 농장 표와 품목으로 나라를 정했다(추정 포함).', kakao: kakao?.coverage ? { messages: kakao.coverage.total, period: kakao.coverage.period, rooms: (kakao.coverage.rooms || []).map(x => ({ room: x.room, count: x.count, first: x.first, last: x.last })) } : null },
  triggers: compactChains(trig),
  countries, weeklySheet, fileKinds, templates, expenseLabels, blind,
  cycles: kakao?.cycles || [], notices: kakao?.templates || [], qa: kakao?.qa || [], glossary: kakao?.glossary || [], partners: kakao?.partners || [], incidents: kakao?.incidents || [], kakaoCountries: (kakao?.countries || []).map(c => ({ country: c.country, items: c.items, arrive: c.arrive, order: c.order })), missing: kakao?.missingProcedures || [], unverified: kakao?.unverified || [], clCodes: kakao?.clCodes ? { distinct: kakao.clCodes.distinct, prefix: kakao.clCodes.prefix } : null,
};
fs.writeFileSync(path.join(process.cwd(), 'data', 'import-education.json'), JSON.stringify(data, null, 1) + '\n');
console.log('wrote data/import-education.json', { countries: countries.length, fileKinds: fileKinds.length, templates: templates.length, cycles: data.cycles.length, notices: data.notices.length, qa: data.qa.length, glossary: data.glossary.length, partners: data.partners.length, incidents: data.incidents.length, bytes: fs.statSync('data/import-education.json').size });
