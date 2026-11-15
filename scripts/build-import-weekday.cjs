#!/usr/bin/env node
// 수입부 요일별 업무표(월~일, 시간대별) 만들기 — 2026-11-14 사장님: "월 / 화~금으로 나오는데 매일 다른데 디테일이 부족"
//   node scripts/build-import-weekday.cjs <업무 단위(cuts) 폴더>  → data/import-weekday.json
//   입력: cuts-*.jsonl (수입부 PC 화면 기록을 5분 경계로 묶은 업무 단위. no,start,sec,wd,proc,doc,seen[])
//   집계만 싣는다: 요일 × 시간대 × 작업 종류 × 나라 — "그 요일이 있던 주 가운데 몇 주에서 보였나"와 걸린 시간(중앙값).
//   사람 이름·개인 대화·금액은 싣지 않는다. 주어는 업무 절차다.
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) { console.error('업무 단위 폴더를 적어 주세요'); process.exit(1); }
const cuts = fs.readdirSync(dir).filter((f) => /^cuts-.*\.jsonl$/.test(f)).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l)));
const WD = ['월', '화', '수', '목', '금', '토', '일'];
const BLOCKS = [[7, 9, '07~09시'], [9, 11, '09~11시'], [11, 13, '11~13시'], [13, 15, '13~15시'], [15, 17, '15~17시'], [17, 19, '17~19시'], [19, 24, '19시 이후']];
// 작업 종류 → 화면에 쓸 이름과 매뉴얼
const PROC = {
  '농장 발주(발주서·협의)': ['농장 발주(주문서 · 농장 방 협의)', null], '인보이스·서류 대조': ['인보이스 · 서류 대조', 'packing-list-from-invoice'], '원가자료 작성': ['원가자료 작성', 'cost-sheet'],
  '송금·결제': ['지출결의서 · 결제 확인', 'payment-request'], '파일 정리': ['서류 · 파일 정리(차수 폴더)', 'customs-docs'], '통관·운송(AWB)': ['통관 서류 · 도착 일정', 'customs-docs'],
  '클레임·크레딧': ['불량 클레임 · 크레딧', 'defect-claim'], '입고 등록(전산)': ['입고 등록(전산)', 'incoming-upload'], '메일': ['메일 확인 · 회신', null], '거래처 배분표·수입수량': ['거래처 배분표 · 수입수량', null],
  '공급처 탐색·자료': ['공급처 자료 확인', null], '전산 발주·주문 조회': ['전산 발주 · 주문 조회', null], '패킹리스트 생성기': ['패킹리스트 만들기', 'packing-list-from-invoice'], '신규 품목 등록': ['신규 품목 등록', 'product-new-registration'],
};
const COUNTRY = [['콜롬비아', /콜롬|colombia|bogot|medell|콜카|clavel|rosa|hortensia|alstro|pedido|보고타|메데진/i], ['중국', /중국|china|cloud|위챗|해상|sea\b/i], ['네덜란드', /네덜|holex|nl\b|neth|ez flower/i], ['에콰도르', /에콰|ecuador|rosaleda/i], ['태국', /태국|thai|super ?fresh|klong/i], ['호주', /호주|austral|premium greens/i], ['미국', /미국|us_|더글라스|usa/i], ['베트남', /베트남|vietnam|royal base/i], ['뉴질랜드', /뉴질|nzbloom|new zealand/i]];
const order = (m, proc) => (proc === '농장 발주(발주서·협의)' ? (/중국/.test(m) ? 'china-order' : 'colombia-weekly-order') : PROC[proc]?.[1] || null);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const days = {}; // 요일 → 날짜 집합
const cell = {}; // 요일|시간대|작업 → { dates:Set, min: {date: 분}, country: {나라: Set(date)} }
for (const c of cuts) {
  if (!PROC[c.proc]) continue;
  const d = String(c.start).slice(0, 10), h = +String(c.start).slice(11, 13), b = BLOCKS.find(([a, z]) => h >= a && h < z);
  (days[c.wd] = days[c.wd] || new Set()).add(d);
  if (!b) continue;
  const k = `${c.wd}|${b[2]}|${c.proc}`, x = (cell[k] = cell[k] || { dates: new Set(), min: {}, country: {} });
  x.dates.add(d); x.min[d] = (x.min[d] || 0) + c.sec / 60;
  const text = `${c.doc || ''} ${(c.seen || []).map((s) => s.screen || '').join(' ')}`;
  for (const [name, re] of COUNTRY) if (re.test(text)) (x.country[name] = x.country[name] || new Set()).add(d);
}
const weekdays = WD.map((wd) => {
  const total = (days[wd] || new Set()).size;
  const blocks = BLOCKS.map(([, , label]) => {
    const items = Object.entries(cell).filter(([k]) => k.startsWith(`${wd}|${label}|`)).map(([k, x]) => {
      const proc = k.split('|')[2], seen = x.dates.size, share = total ? seen / total : 0;
      const countries = Object.entries(x.country).map(([n, s]) => [n, s.size]).filter(([, n]) => n >= Math.max(2, Math.ceil(seen / 3))).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
      return { title: PROC[proc][0], manualId: order(countries.join(' '), proc), seenDays: seen, totalDays: total, minutes: Math.round(median(Object.values(x.min))), countries,
        freq: share >= 0.8 ? '거의 매주' : share >= 0.5 ? '자주' : '가끔' };
    }).filter((it) => it.seenDays >= 2 && it.seenDays / Math.max(1, total) >= 0.34).sort((a, b) => b.seenDays - a.seenDays || b.minutes - a.minutes).slice(0, 5);
    return { time: label, items };
  }).filter((b) => b.items.length);
  return { weekday: wd, observedDays: total, blocks };
});
const dates = cuts.map((c) => String(c.start).slice(0, 10)).sort();
const out = { version: 1, generatedAt: new Date().toISOString().slice(0, 10), basis: { cuts: cuts.length, from: dates[0], to: dates[dates.length - 1], seats: 2, note: '수입부 PC 두 자리의 화면 기록을 업무 단위로 묶어 요일 · 시간대별로 센 것. 같은 요일이 있던 날 가운데 3분의 1 이상(2일 이상)에서 보인 작업만 싣는다. 화면 기록만의 집계라 추정이며, 전산 기록으로 확인된 일은 하루 · 주 업무표에 확정으로 표시돼 있다.' }, weekdays };
fs.writeFileSync(path.join(process.cwd(), 'data', 'import-weekday.json'), JSON.stringify(out, null, 2) + '\n');
console.log('wrote data/import-weekday.json', weekdays.map((w) => `${w.weekday}:${w.observedDays}일/${w.blocks.reduce((a, b) => a + b.items.length, 0)}칸`).join(' '));
