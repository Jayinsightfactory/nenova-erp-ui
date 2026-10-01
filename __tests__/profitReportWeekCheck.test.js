// 새 차수 자동 점검 — 반차수별 위험 판정(자동처리됨/입력 필요/확인 필요)
// 실행: node __tests__/profitReportWeekCheck.test.js
let failed = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed += 1; }
};

async function main() {
  const { buildWeekCheck } = await import('../lib/profitReportWeekCheck.js');
  const flower = (o) => ({ WarehouseKey: o.wh || 1, OrderWeek: o.wk || '40-01', AWB: o.awb || 'A1', FarmName: o.farm || 'Apollo', masterGW: 0, masterCW: 0,
    ProdKey: 'pk' in o ? o.pk : 100, BoxQuantity: o.box ?? 10, BunchQuantity: 0, SteamQuantity: 0, OutQuantity: o.box ?? 10, EstQuantity: o.est ?? 10, TPrice: o.tp ?? 100,
    ProdName: 'name' in o ? o.name : 'Rose Freedom', FlowerName: o.flower || '장미', CounName: o.coun || '콜롬비아',
    P_BoxWeight: o.pw ?? null, P_BoxCBM: o.pc ?? null, F_BoxWeight: 'fw' in o ? o.fw : 8, F_BoxCBM: 'fc' in o ? o.fc : 10 });
  const weightRow = (o) => ({ ...flower({ ...o, name: o.kind === 'cw' ? 'Chargeable weight' : 'Gross weight', flower: '', coun: '', fw: null, fc: null, tp: 0 }),
    BoxQuantity: o.kg, OutQuantity: o.kg });
  const sources = {
    inbound: [
      flower({ awb: 'MIX1', flower: '장미' }),
      flower({ awb: 'MIX1', flower: '수국', name: 'Hydrangea White', fw: null, fc: null }),
      flower({ awb: 'CN1', coun: '중국', flower: '기타', fw: null, fc: null, wh: 2, name: 'China Mix' }),
      flower({ awb: 'CN1', coun: '중국', flower: '기타2', est: 0, wh: 2, name: 'Zero Est', fw: 1, fc: 1 }),
      { ...flower({ wh: 3, awb: 'ORPH', pk: null, name: '', flower: '', coun: '', tp: 0 }) },
      weightRow({ wh: 4, awb: 'G1', kind: 'gw', kg: 1420 }), weightRow({ wh: 4, awb: 'G1', kind: 'cw', kg: 1000 }),
      weightRow({ wh: 5, awb: 'G2', kind: 'gw', kg: 1420 }),
      flower({ wk: '40-02', awb: 'B2', flower: '장미' }),
      flower({ wk: '40-02', awb: 'B2', flower: '희귀꽃', name: 'Odd Flower', fw: null, fc: null }),
    ],
    arrival: [{ OrderWeek: '40-1', CountryName: '콜롬비아', n: 3, fxRows: 3, fxMin: 1450, fxMax: 1450 }],
    arrivalPrevCountries: ['콜롬비아'],
    recentPurchasedProdKeys: new Set([100]),
    shipped: [{ ProdKey: 999, ProdName: 'Old Rose', CounName: '콜롬비아', OutQty: 5, Amount: 5000 }],
    recentMajors: ['40', '39', '38', '37', '36'],
  };
  const colombiaWeeks = [
    { orderWeek: '40-01', gw: 19304, total: 10089840, inbound: true, gwSource: 'erp_inbound', saved: false,
      erpWeight: { GW: 19304, CW: 20686, sources: [{ awb: 'MIX1', farm: 'Apollo', pooledWithHydrangea: true }] } },
    { orderWeek: '40-02', gw: 0, total: 0, inbound: true, gwSource: 'missing', saved: false, erpWeight: null },
  ];
  const report = {
    rows: [
      { category: '콜롬비아 장미', auto: { Q: 100 }, calc: { R: 1358.72 }, source: { R: 'kcs_api' } },
      { category: '베트남', auto: { Q: 10 }, calc: { R: 1343 }, source: { R: 'carried_taxable_rate' } },
      { category: '일본', auto: { Q: 5 }, calc: { R: null }, source: { R: 'missing' } },
    ],
    audit: { issues: [
      { severity: 'error', code: 'FORWARDING_SCOPE_MISSING', category: '포워딩 자동분류', message: 'x', detail: { summary: '항공료 누락 40-01', fix: { href: '/sales/forwarding-clearance?year=2026&week=40&focus=40-01', label: '항공료 연결 확인 열기' } } },
      { severity: 'error', code: 'CUSTOMS_INCOMPLETE', category: '콜롬비아 4품목', message: 'dup' },
    ] },
  };
  const out = buildWeekCheck({ orderYear: '2026', major: '40', sources, colombiaWeeks, report });
  const find = (sub, topic, status) => out.rows.filter((r) => r.subWeek === sub && r.topic === topic && (!status || r.status === status));

  check('40-01 콜롬비아 그외통관비 전산 자동(Apollo) = 표시 안 함', find('40-01', '그외통관비(콜롬비아)').length === 0);
  check('40-02 콜롬비아 그외통관비 누락 = 입력 필요 + 반차수 링크', find('40-02', '그외통관비(콜롬비아)', 'input').some((r) => /focus=40-02/.test(r.link?.href || '')));
  check('원가자료 표 적용(정상 경로) = 표시 안 함', find('40-01', '박스당 무게/CBM').length === 0);
  check('중국 기타 잔여 역산(정상 경로) = 표시 안 함', find('40-01', '중국 박스(단)당 무게').length === 0);
  check('표에 없는 콜롬비아 꽃 + 마스터 없음 = 입력 필요', find('40-02', '박스당 무게/CBM', 'input').some((r) => /희귀꽃/.test(r.text)));
  check('EstQuantity 0 + 박스 = 확인 필요', find('40-01', '입고 입력 형태', 'review').some((r) => /EstQuantity/.test(r.text)));
  check('품목 없는 0원 행(자동 제외) = 표시 안 함', !out.rows.some((r) => /0원 상세행/.test(r.text)));
  check('GW>CW(콜롬비아 clamp 아님) = 확인 필요', find('40-01', '입고 입력 형태', 'review').some((r) => /GW > CW/.test(r.text) && /G1/.test(r.text)));
  check('같은 GW 1420 두 AWB 반복 = 확인 필요', find('40-01', '입고 입력 형태', 'review').some((r) => /1,420kg × 2건/.test(r.text)));
  check('콜카장수국 혼적 AWB(정상 풀) = 표시 안 함', !find('40-01', '혼적 AWB 구성').some((r) => /MIX1/.test(r.text)));
  check('원가자료 환율 있음 = 표시 안 함', find('40-01', '환율(원가자료)').length === 0);
  check('40-02 콜롬비아 원가자료 없음 = 입력 필요', find('40-02', '환율(원가자료)', 'input').some((r) => /콜롬비아/.test(r.text)));
  check('과세환율 이월값 = 확인 필요', find('대차수', '과세환율(R)', 'review').some((r) => /베트남/.test(r.text)));
  check('과세환율 없음 = 입력 필요', find('대차수', '과세환율(R)', 'input').some((r) => /일본/.test(r.text)));
  check('항공료 전표 누락 = 입력 필요 + PR #815 링크', find('대차수', '항공료 전표', 'input').some((r) => /forwarding-clearance/.test(r.link?.href || '')));
  check('콜롬비아 4품목 CUSTOMS 경고는 반차수 행과 중복 표시 안 함', !out.rows.some((r) => r.text.includes('dup')));
  check('최근 4주 매입 없는 출고 품목 = 확인 필요', find('대차수', '최근 4주 매입 없음', 'review').some((r) => /Old Rose/.test(r.text)));
  check('정렬: 반차수 먼저, 대차수 나중', out.rows.at(-1).subWeek === '대차수' && out.rows[0].subWeek === '40-01');
  check('요약 = 입력/확인만, 자동·정상 없음', out.summary.input >= 4 && out.summary.review >= 3 && !out.summary.auto && !out.summary.ok && out.rows.every((r) => r.status === 'input' || r.status === 'review'), JSON.stringify(out.summary));
  const clean = buildWeekCheck({ orderYear: '2026', major: '40', sources: { ...sources, inbound: [], arrival: [], arrivalPrevCountries: [], shipped: [] }, colombiaWeeks: [], report: { categoryRows: [], audit: { issues: [] } } });
  check('문제 없는 차수 = 행 0', clean.rows.length === 0, JSON.stringify(clean.rows.slice(0, 2)));

  if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
  console.log('\nall passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
