const assert = require('node:assert/strict');
const fs = require('node:fs');
const XLSX = require('xlsx');

(async () => {
  const {
    buildKstDayBounds,
    buildPurchaseOrderSheetModel,
    formatOrderRemarkWithWeek,
    formatOrderWeekLabel,
    kstDateString,
    matchRowToStaff,
    resolveStaffOrderAccess,
    splitProductCategoryAndDetail,
    summarizeCustomerOrderItems,
  } = await import('../lib/dailyStaffPurchaseOrder.js');
  const { writePurchaseOrderWorkbookBuffer } = await import('../lib/dailyStaffPurchaseOrderWorkbook.js');

  // 1. KST 당일 경계 검증 (UTC 자정 전후 KST 날짜 보존)
  const kstFromUtcEarly = kstDateString(new Date('2026-11-24T16:30:00Z')); // KST 2026-11-25 01:30
  assert.equal(kstFromUtcEarly, '2026-11-25');
  const bounds = buildKstDayBounds('2026-11-25');
  assert.equal(bounds.dateText, '2026-11-25');
  assert.equal(bounds.startDtm, '2026-11-25 00:00:00.000');
  assert.equal(bounds.endDtm, '2026-11-26 00:00:00.000');

  // 2. 로그인 계정 권한·매칭 검증 (양성 fixture + 타 담당자 near-miss 차단)
  const parkAccess = resolveStaffOrderAccess({ userId: 'nenovaSD7', userName: '박성수', authority: 6 });
  assert.equal(parkAccess.isAdmin, false);
  const adminAccess = resolveStaffOrderAccess({ userId: 'admin', userName: '관리자', authority: 1 });
  assert.equal(adminAccess.isAdmin, true);

  const webDirectRow = {
    odCreateId: 'admin',
    todayActorId: 'nenovaSD7',
    todayActorName: '박성수',
    custManager: '박성수',
  };
  assert.deepEqual(matchRowToStaff(webDirectRow, parkAccess), { matched: true, kind: 'direct' });

  const assignedCustomerRow = {
    odCreateId: 'nenovaSS2',
    todayActorId: 'nenovaSS2',
    todayActorName: '설연주',
    custManager: '박성수',
    custManagerUserId: 'nenovaSD7',
    custManagerUserName: '박성수',
  };
  assert.deepEqual(matchRowToStaff(assignedCustomerRow, parkAccess), { matched: true, kind: 'assigned_customer' });

  const otherStaffRow = {
    odCreateId: 'nenovaSD3',
    todayActorId: 'nenovaSD3',
    todayActorName: '조현욱',
    custManager: '조현욱',
    custManagerUserId: 'nenovaSD3',
    custManagerUserName: '조현욱',
  };
  assert.deepEqual(matchRowToStaff(otherStaffRow, parkAccess), { matched: false, kind: null });

  const supportAccess = resolveStaffOrderAccess({ userId: 'nenovaSS2', userName: '설연주', authority: 2 });
  assert.deepEqual(matchRowToStaff(assignedCustomerRow, supportAccess), { matched: true, kind: 'direct' });
  assert.deepEqual(matchRowToStaff(otherStaffRow, supportAccess), { matched: false, kind: null });

  // 3. 품목(대분류) / 상세품종·규격 분리 검증
  assert.deepEqual(
    splitProductCategoryAndDetail({ flowerName: '카네이션', prodName: 'CARNATION Doncel', displayName: '카네이션 돈셀' }),
    { category: '카네이션', detail: '돈셀' },
  );
  assert.deepEqual(
    splitProductCategoryAndDetail({ flowerName: '수국', prodName: 'Hydrangea White (화이트)', displayName: '수국 화이트 (화이트)' }),
    { category: '수국', detail: '화이트' },
  );
  assert.deepEqual(
    splitProductCategoryAndDetail({ flowerName: '수국', prodName: 'HYDRANGEA', displayName: '수국' }),
    { category: '수국', detail: '-' },
  );
  assert.deepEqual(
    splitProductCategoryAndDetail({ flowerName: '장미', prodName: 'ROSE / Freedom 50cm', displayName: '장미 / 프리덤 50CM' }),
    { category: '장미', detail: '프리덤 50cm' },
  );
  assert.deepEqual(
    splitProductCategoryAndDetail({ flowerName: '기타', prodName: 'Lisianthus CHINA / 샴페인 600g', displayName: '리시안셔스 CHINA / 샴페인 600G' }),
    { category: '리시안셔스', detail: '샴페인 600g' },
  );
  assert.deepEqual(
    splitProductCategoryAndDetail({ flowerName: '안시리움', prodName: 'Anthurium Graciosa 15cm', displayName: '안스리움 GRACIOSA 15CM' }),
    { category: '안시리움', detail: 'GRACIOSA 15cm' },
  );

  // 4. 차수 라벨 및 비고 차수 결합 포맷 검증
  assert.equal(formatOrderWeekLabel('2026', '48-01', '2026-11-25'), '48-01차');
  assert.equal(formatOrderWeekLabel('2027', '01-01', '2026-12-28'), '2027-01-01차');
  assert.equal(formatOrderWeekLabel('', '', '2026-11-25'), '');

  assert.equal(formatOrderRemarkWithWeek('2026', '48-01', '', '2026-11-25'), '48-01차');
  assert.equal(formatOrderRemarkWithWeek('2026', '48-01', '중국(해상)', '2026-11-25'), '48-01차 / 중국(해상)');
  // 이미 동일 차수가 적힌 비고는 중복 삽입하지 않음
  assert.equal(formatOrderRemarkWithWeek('2026', '48-01', '48-01차 / 중국(해상)', '2026-11-25'), '48-01차 / 중국(해상)');

  // 5. 결정론적 주요 발주 내역 요약 포매터 검증 (단일/소수/다품종 + 단일차수/복수차수)
  assert.equal(
    summarizeCustomerOrderItems([{ category: '루스커스', detail: '-', qty: 1, unit: '박스' }]),
    '루스커스 1박스',
  );
  assert.equal(
    summarizeCustomerOrderItems([
      { category: '수국', detail: '화이트', qty: 1, unit: '박스' },
      { category: '수국', detail: '다크 핑크 (진핑크)', qty: 1, unit: '박스' },
      { category: '수국', detail: '블루', qty: 1, unit: '박스' },
    ]),
    '수국(화이트 1, 진핑크 1, 블루 1)',
  );
  const carnation11 = Array.from({ length: 11 }, (_, idx) => ({
    category: '카네이션',
    detail: `품종${idx + 1}`,
    qty: idx < 3 ? 2 : 1,
    unit: '박스',
    orderYear: '2026',
    orderWeek: '49-02',
  }));
  assert.equal(
    summarizeCustomerOrderItems(
      [
        ...carnation11,
        { category: '프리덤', detail: '-', qty: 10, unit: '단', orderYear: '2026', orderWeek: '49-02' },
        { category: '루스커스', detail: '그린 40cm', qty: 2, unit: '박스', orderYear: '2026', orderWeek: '49-02' },
      ],
      { referenceDateText: '2026-11-25' },
    ),
    '[49-02차] 카네이션 14박스(11종), 프리덤 10단, 루스커스 40cm 2박스',
  );

  // 복수 차수 요약 분리 검증
  assert.equal(
    summarizeCustomerOrderItems(
      [
        { category: '카네이션', detail: '돈셀', qty: 2, unit: '박스', orderYear: '2026', orderWeek: '49-01' },
        { category: '카네이션', detail: '돈셀', qty: 3, unit: '박스', orderYear: '2026', orderWeek: '49-02' },
        { category: '알스트로', detail: 'NADYA', qty: 16, unit: '단', orderYear: '2026', orderWeek: '49-02' },
      ],
      { referenceDateText: '2026-11-25' },
    ),
    '[49-01차] 카네이션 돈셀 2박스 / [49-02차] 카네이션 돈셀 3박스, 알스트로 NADYA 16단',
  );

  // 6. 본표 그룹화·차수별 행 분리·비고 차수 표시·엑셀(.xlsx) 셀 구조 100% 일치 검증
  const sampleInput = [
    { custName: '나원예', orderYear: '2026', orderWeek: '48-02', category: '수국', detail: '화이트', qty: 1, unit: '박스', remark: '' },
    { custName: '나원예', orderYear: '2026', orderWeek: '48-02', category: '수국', detail: '진핑크', qty: 2, unit: '박스', remark: '중국(해상)' },
    { custName: '가플라워', orderYear: '2026', orderWeek: '48-01', category: '루스커스', detail: '', qty: 1, unit: '박스', remark: '' },
    // 동일 거래처·동일 품종(카네이션 돈셀)이라도 차수(49-01 vs 49-02)가 다르면 별도 행으로 분리되어야 함!
    { custName: '가플라워', orderYear: '2026', orderWeek: '49-02', category: '카네이션', detail: '돈셀', qty: 2, unit: '박스', remark: '' },
    { custName: '가플라워', orderYear: '2026', orderWeek: '49-01', category: '카네이션', detail: '돈셀', qty: 3, unit: '박스', remark: '' },
    // 다른 거래처로 바뀔 때 이전 거래처의 마지막 품목과 같아도 품목명이 다시 출력되어야 함
    { custName: '다플라워', orderYear: '2027', orderWeek: '01-01', category: '수국', detail: '블루', qty: 5, unit: '단', remark: '선발주' },
  ];

  const sheetModel = buildPurchaseOrderSheetModel(sampleInput, {
    staffName: '박성수',
    dateText: '2026-11-25',
  });

  assert.equal(sheetModel.filename, '화훼_발주_내역서_박성수_2026-11-25.xlsx');
  assert.equal(sheetModel.itemCount, 6);
  assert.equal(sheetModel.customerCount, 3);
  assert.equal(sheetModel.totalQty, 14);
  assert.deepEqual(sheetModel.includedWeeks, ['48-01차', '48-02차', '49-01차', '49-02차', '2027-01-01차']);

  assert.deepEqual(
    sheetModel.detailRows.map(r => [r.no, r.customerDisplay, r.categoryDisplay, r.detailDisplay, r.qty, r.unit, r.remark]),
    [
      [1, '가플라워', '루스커스', '-', 1, '박스', '48-01차'],
      [2, '', '카네이션', '돈셀', 3, '박스', '49-01차'],
      [3, '', '', '돈셀', 2, '박스', '49-02차'],
      [4, '나원예', '수국', '진핑크', 2, '박스', '48-02차 / 중국(해상)'],
      [5, '', '', '화이트', 1, '박스', '48-02차'],
      [6, '다플라워', '수국', '블루', 5, '단', '2027-01-01차 / 선발주'],
    ],
  );

  // 엑셀(.xlsx) 바이너리 생성 후 재파싱하여 모든 행/열 위치 검증
  const buffer = writePurchaseOrderWorkbookBuffer(sheetModel);
  assert(Buffer.isBuffer(buffer) && buffer.length > 1000);
  const wb = XLSX.read(buffer, { type: 'buffer' });
  assert.deepEqual(wb.SheetNames, ['화훼 발주 내역서']);
  const ws = wb.Sheets['화훼 발주 내역서'];
  const rowsAoA = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  assert.equal(rowsAoA[0][0], '화훼 발주 내역서');
  assert.deepEqual(rowsAoA[1].slice(0, 7), ['', '', '', '', '', '', '']);
  assert.deepEqual(rowsAoA[2].slice(0, 7), ['No.', '거래처', '품목(대분류)', '상세품종 / 규격', '수량', '단위', '비고']);

  assert.deepEqual(rowsAoA[3].slice(0, 7), [1, '가플라워', '루스커스', '-', 1, '박스', '48-01차']);
  assert.deepEqual(rowsAoA[4].slice(0, 7), [2, '', '카네이션', '돈셀', 3, '박스', '49-01차']);
  assert.deepEqual(rowsAoA[5].slice(0, 7), [3, '', '', '돈셀', 2, '박스', '49-02차']);
  assert.deepEqual(rowsAoA[6].slice(0, 7), [4, '나원예', '수국', '진핑크', 2, '박스', '48-02차 / 중국(해상)']);

  // 본표 합계 행 (Row index 3 + 6 = 9)
  assert.equal(rowsAoA[9][0], '총 발주 품목 수 / 단순 수량 합계');
  assert.equal(rowsAoA[9][4], 14);
  assert.equal(rowsAoA[9][5], '총 6건');
  assert.equal(rowsAoA[9][6], '단위(박스/단/대/미지정) 상이함 유의');

  // 하단 거래처별 발주 요약 섹션
  assert.equal(rowsAoA[11][0], '거래처별 발주 요약');
  assert.deepEqual(rowsAoA[12].slice(0, 4), ['', '', '', '']);
  assert.deepEqual(rowsAoA[13].slice(0, 4), ['거래처', '품목 건수', '단순 수량 합계', '주요 발주 내역 요약']);
  assert.deepEqual(
    rowsAoA[14].slice(0, 4),
    ['가플라워', 3, 6, '[48-01차] 루스커스 1박스 / [49-01차] 카네이션 돈셀 3박스 / [49-02차] 카네이션 돈셀 2박스'],
  );
  assert.deepEqual(rowsAoA[15].slice(0, 4), ['나원예', 2, 3, '[48-02차] 수국(진핑크 2, 화이트 1)']);
  assert.deepEqual(rowsAoA[16].slice(0, 4), ['다플라워', 1, 5, '[2027-01-01차] 수국 블루 5단']);
  assert.deepEqual(rowsAoA[17].slice(0, 4), ['합계', 6, 14, '총 3개 거래처']);

  // 7. SQL 및 API 보안·읽기전용 불변식 검사
  const sqlSource = fs.readFileSync('lib/dailyStaffPurchaseOrderSql.js', 'utf8');
  assert(!/\b(INSERT|UPDATE|DELETE|MERGE|EXEC|DROP|ALTER|CREATE)\b/i.test(sqlSource));
  assert(sqlSource.includes('om.OrderYear'));

  const apiSource = fs.readFileSync('pages/api/stats/daily-order-sheet.js', 'utf8');
  assert(apiSource.includes('withAuth'));
  assert(apiSource.includes("req.method !== 'GET'"));
  assert(apiSource.includes('status(403)'));

  console.log('dailyStaffPurchaseOrder: KST bounds, staff isolation, week-in-remark, multi-week split, and XLSX layout passed');
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
