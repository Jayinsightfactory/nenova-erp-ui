const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const { parseKakaoFlightSchedule, buildBoxByCountry, normalizeAwb, normalizeWeekKey, fixCountryByFarm, BOX_COUNTRIES } = await import('../lib/incomingBoxByCountry.js');

  // --- 정규화
  assert.equal(normalizeAwb('160-9663 4915'), '16096634915');
  assert.equal(normalizeAwb('014-39586923'), '1439586923', 'AWB는 자릿수 비교를 위해 선행 0을 제거한다');
  assert.equal(normalizeWeekKey('1-2A'), '01-02');
  assert.equal(normalizeWeekKey('16-2'), '16-02');
  assert.equal(fixCountryByFarm('콜롬비아', 'Yunnan Melody'), '중국', '중국 농장이 콜롬비아 국가코드로 등록된 입고는 중국으로 정정');

  // --- 카톡 파서: 대괄호/무괄호 헤더, 분할 A/B, 연착 재공지, AWB 변경 중복, AWB 미기재 품목합
  const kakao = [
    '--------------- 2025년 12월 30일 화요일 ---------------',
    '[네노바 수입부] [오후 5:00] [01-1차 콜 수국]',
    '12월 31일 21:25 도착 예정',
    '(160-96634904 CX416 465 box)',
    '--------------- 2026년 1월 2일 금요일 ---------------',
    '[네노바 수입부] [오후 5:30] [주말 스케쥴 공유]',
    '',
    '[01-2A차 콜 카장]',
    '01월 04일 (일) 05:40 도착 예정',
    '(016-95111590 UA559 69 box)',
    '',
    '[01-2B차 콜 카장]',
    '01월 04일 (일) 16:10 도착 예정',
    '(014-39586923 AC063 217 box)',
    '',
    '[01-2차 네덜란드 홀렉스]',
    '01월 04일 (일) 16:40 도착 예정',
    '-> 기타정보 및 서류는 확인되는대로 공유드리겠습니다',
    '--------------- 2026년 1월 3일 토요일 ---------------',
    '[네노바 수입부] [오후 8:00] [01-2차 네덜란드 홀렉스]',
    '01월 04일 16:38 도착 예정',
    '(180-52107683 KE0926 72 box)',
    '[Teresa] [오후 9:00] 1-2 콜카장',
    '',
    '카네이션 156 박스',
    '장미 71 박스 / 710 단',
    '--------------- 2026년 1월 5일 월요일 ---------------',
    '[Teresa] [오전 9:00] ＊화요일＊',
    '2-1차 콜수국 (CATHAY)',
    '1월 6일(화) 13:55 도착 예정',
    '(160-96634926 CX410 379 BOX)',
    '',
    '2-1A차 콜카장 (MAS)',
    '1월 6일(화) 07:00 도착 예정',
    '(865-14703791 KJ281 427 BOX)',
    '',
    '카네이션 427 박스',
    '--------------- 2026년 1월 6일 화요일 ---------------',
    '[Teresa] [오전 10:00] 2-1차 콜수국 연결편 지연. 새로운 ETA',
    '2-1차 콜수국 (KOREAN AIR)',
    '1월 7일(수) 13:55 도착 예정',
    '(180-12063074 KE252 379 BOX)',
    '[네노바 수입부] [오후 2:00] [02-1차 태국 덴파레]',
    '01월 07일 06:35 도착 예정',
    '( 217-0774 5426 TG656  _ box)',
    '[네노바 수입부] [오후 9:00] [02-1차 태국 덴파레]',
    '01월 07일 06:35 도착 예정',
    '( 217-07745426 TG658 6 box)',
  ].join('\n');
  const parsed = parseKakaoFlightSchedule(kakao, { fromYear: 2026 });
  const live = parsed.shipments.filter(s => !s.duplicate);
  assert.equal(parsed.shipments.some(s => s.awbKey === '16096634904'), false, '2026년 이전 공지는 범위 밖');
  const holex = live.find(s => s.country === '네덜란드');
  assert.equal(holex.box, 72, 'AWB 없는 사전공지는 AWB 공지에 흡수되어 1건');
  assert.equal(live.filter(s => s.country === '네덜란드').length, 1);
  assert.deepEqual(live.filter(s => s.weekKey === '01-02' && s.country === '콜롬비아' && s.awbKey).map(s => s.box).sort((a, b) => a - b), [69, 217], '분할 A/B는 각각 1건');
  assert.equal(live.some(s => s.estimated), false, '같은 차수·국가·품목에 AWB 선적이 있으면 품목내역 요약은 추가하지 않는다');
  const dup = parsed.shipments.find(s => s.awbKey === '18012063074');
  assert.equal(dup.duplicate, true, '같은 차수·품목에 AWB가 다른데 박스수가 같으면 중복 의심(제외)');
  const thai = live.find(s => s.country === '태국');
  assert.equal(thai.box, 6, '"_ box" 미정 공지 뒤 확정 박스는 마지막 값 채택');
  assert.equal(thai.flight, 'TG658');
  const carn = live.find(s => s.awbKey === '86514703791');
  assert.deepEqual(carn.items, [{ name: '카네이션', box: 427 }]);

  // --- 최종 박스 규칙: 웹 박스 0(단 단위) → 카톡, 콜롬비아 장미 박스0 → 카톡, 웹만/카톡만, 국내 제외, 교차연도 격리
  const warehouse = [
    { weekKey: '01-02', awb: '014-39586923', farmName: 'Falcon Farms', country: '콜롬비아', boxQty: 217, roseNoBoxBunch: 0, lines: 10, inputDate: '2026-01-04' },
    { weekKey: '01-02', awb: '180-52107683', farmName: 'Holex', country: '네덜란드', boxQty: 0, roseNoBoxBunch: 0, lines: 40, inputDate: '2026-01-04' },
    { weekKey: '02-01', awb: '865-14703791', farmName: 'Maxiflores', country: '콜롬비아', boxQty: 322, roseNoBoxBunch: 1050, lines: 70, inputDate: '2026-01-06' },
    { weekKey: '02-01', awb: '16096634926', farmName: 'Antioquia', country: '콜롬비아', boxQty: 379, roseNoBoxBunch: 0, lines: 20, inputDate: '2026-01-06' },
    { weekKey: '02-01', awb: '99201677104', farmName: 'Ayura', country: '콜롬비아', boxQty: 914, roseNoBoxBunch: 0, lines: 30, inputDate: '2026-01-06' },
    { weekKey: '02-01', awb: '78468625561', farmName: 'Yunnan Melody', country: '콜롬비아', boxQty: 5, roseNoBoxBunch: 0, lines: 3, inputDate: '2026-01-06' },
    { weekKey: '02-01', awb: '', farmName: '국내 화훼', country: '국내', boxQty: 50, roseNoBoxBunch: 0, lines: 2, inputDate: '2026-01-06' },
  ];
  const kakaoRows = live.concat([{ year: 2026, weekKey: '02-01', subWeek: '2-1A', country: '콜롬비아', item: '카장', awbKey: '86514703791', awbRaw: '865-14703791', box: 427, arrival: '2026-01-06', items: [], flags: [], duplicate: false }]);
  // 같은 AWB 카톡행 2개가 들어와도(파서 결과+추가) 중복 집계되지 않도록 AWB 기준으로 1개만 남긴다
  const uniq = [...new Map(kakaoRows.filter(k => k.awbKey).map(k => [k.awbKey, k])).values()].concat(kakaoRows.filter(k => !k.awbKey));
  const report = buildBoxByCountry({ warehouse, kakao: uniq });
  const by = awb => report.rows.find(r => normalizeAwb(r.awb) === normalizeAwb(awb));
  assert.equal(by('014-39586923').finalBox, 217); assert.equal(by('014-39586923').source, '웹(전산)');
  assert.equal(by('016-95111590').source, '카톡(웹 미입고)'); assert.equal(by('016-95111590').needsCheck, true);
  assert.equal(by('180-52107683').finalBox, 72, '웹 입고는 있으나 박스 0(송이 단위) → 카톡 박스');
  assert.equal(by('865-14703791').finalBox, 427, '콜롬비아 장미 1050단 박스0 = 105박스 → 322+105≈427 카톡 채택');
  assert.equal(by('865-14703791').source, '카톡(웹 장미 박스 미입력 보정)');
  assert.equal(by('16096634926').finalBox, 379, '웹·카톡 동일');
  assert.equal(report.rows.some(r => normalizeAwb(r.awb) === '18012063074'), false, '중복 의심 AWB는 집계에서 제외');
  assert.equal(by('99201677104').source, '웹(카톡 공지 없음)');
  assert.equal(by('78468625561').country, '중국', '중국 농장 입고의 콜롬비아 국가코드 오분류 정정');
  assert.equal(report.rows.some(r => r.country === '국내'), false, '국내 입고는 비행 스케줄 대상이 아니므로 제외');
  assert.deepEqual(report.countries.slice(0, 2), ['콜롬비아', '네덜란드'], '국가 열은 총 박스 많은 순');
  const w0102 = report.byWeek.find(p => p.key === '01-02');
  assert.equal(w0102.byCountry['콜롬비아'], 217 + 69); assert.equal(w0102.byCountry['네덜란드'], 72); assert.equal(w0102.total, 358);
  assert.equal(report.byMajor.find(p => p.key === '02').byCountry['콜롬비아'], 427 + 379 + 914);
  assert.equal(report.grandTotal.total, report.rows.reduce((a, r) => a + r.finalBox, 0));

  // 교차연도: 2025년 입고 행은 호출자가 OrderYear로 격리해 넘기므로 섞어 넣어도 weekKey 기준으로만 집계된다 → API는 연도별로 따로 읽는다
  const yearIsolated = buildBoxByCountry({ warehouse: warehouse.filter(w => w.inputDate.startsWith('2026')), kakao: uniq.filter(k => k.year === 2026 || k.year == null) });
  assert.equal(yearIsolated.grandTotal.total, report.grandTotal.total);

  // --- 계약 파일 존재
  for (const file of ['pages/api/incoming/box-by-country.js', 'pages/incoming/box-by-country.js', 'pages/m/incoming-box.js', 'components/IncomingBoxByCountryTable.js', 'docs/contracts/incoming-box-by-country.json', 'docs/migrations/2026-10-07_web_flight_schedule_box.sql']) {
    assert.equal(fs.existsSync(file), true, `${file} 가 있어야 합니다.`);
  }
  const api = fs.readFileSync('pages/api/incoming/box-by-country.js', 'utf8');
  assert.match(api, /WebFlightScheduleBox/, '카톡 선적은 웹 전용 테이블에만 저장');
  assert.doesNotMatch(api, /INSERT\s+INTO\s+(?:WarehouseMaster|WarehouseDetail|OrderMaster|ShipmentMaster)/i, 'ERP 원장 쓰기 금지');
  assert.match(api, /isAdminUser\(req\.user\)/, '카톡 업로드는 관리자만');
  assert.match(fs.readFileSync('components/Layout.js', 'utf8'), /\/incoming\/box-by-country/, '메뉴 등록');
  assert.match(fs.readFileSync('pages/m/index.js', 'utf8'), /\/m\/incoming-box/, '대표 모바일 보고서 메뉴 등록');
  assert.equal(BOX_COUNTRIES.has('콜롬비아'), true);
  console.log('incomingBoxByCountry tests passed');
})().catch(error => { console.error(error); process.exit(1); });
