const assert = require('node:assert/strict');
const fs = require('node:fs');
const XLSX = require('xlsx');

(async () => {
  const {
    buildKstDayBounds,
    buildPurchaseOrderSheetModel,
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

  // 웹 등록 시 CreateID='admin'이고 OrderHistory.ChangeID='nenovaSD7'인 경우 본인 직접등록 매칭
  const webDirectRow = {
    odCreateId: 'admin',
    todayActorId: 'nenovaSD7',
    todayActorName: '박성수',
    custManager: '박성수',
  };
  assert.deepEqual(matchRowToStaff(webDirectRow, parkAccess), { matched: true, kind: 'direct' });

  // 영업지원(설연주)이 박성수 담당 거래처 주문을 당일 등록한 경우
  const assignedCustomerRow = {
    odCreateId: 'nenovaSS2',
    todayActorId: 'nenovaSS2',
    todayActorName: '설연주',
    custManager: '박성수',
    custManagerUserId: 'nenovaSD7',
    custManagerUserName: '박성수',
  };
  assert.deepEqual(matchRowToStaff(assignedCustomerRow, parkAccess), { matched: true, kind: 'assigned_customer' });

  // Near-miss: 타 담당자(조현욱 nenovaSD3) 당일 등록 건은 박성수에게 절대 매칭되지 않음
  const otherStaffRow = {
    odCreateId: 'nenovaSD3',
    todayActorId: 'nenovaSD3',
    todayActorName: '조현욱',
    custManager: '조현욱',
    custManagerUserId: 'nenovaSD3',
    custManagerUserName: '조현욱',
  };
  assert.deepEqual(matchRowToStaff(otherStaffRow, parkAccess), { matched: false, kind: null });

  // 영업지원(설연주) 로그인 시 본인이 직접 입력한 건은 매칭되고 조현욱 건은 매칭되지 않음
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

  // 4. 결정론적 주요 발주 내역 요약 포매터 검증 (사장님 샘플 3유형 모두 확인)
  // 4-1. 단일 품종
  assert.equal(
    summarizeCustomerOrderItems([{ category: '루스커스', detail: '-', qty: 1, unit: '박스' }]),
    '루스커스 1박스',
  );
  // 4-2. 소수 품종 (2~4종)
  assert.equal(
    summarizeCustomerOrderItems([
      { category: '수국', detail: '화이트', qty: 1, unit: '박스' },
      { category: '수국', detail: '다크 핑크 (진핑크)', qty: 1, unit: '박스' },
      { category: '수국', detail: '블루', qty: 1, unit: '박스' },
    ]),
    '수국(화이트 1, 진핑크 1, 블루 1)',
  );
  // 4-3. 다품종(5종 이상) + 단일 품종 복합
  const carnation11 = Array.from({ length: 11 }, (_, idx) => ({
    category: '카네이션',
    detail: `품종${idx + 1}`,
    qty: idx < 3 ? 2 : 1, // 2*3 + 1*8 = 14박스 (11종)
    unit: '박스',
  }));
  assert.equal(
    summarizeCustomerOrderItems([
      ...carnation11,
      { category: '프리덤', detail: '-', qty: 10, unit: '단' },
      { category: '루스커스', detail: '그린 40cm', qty: 2, unit: '박스' },
    ]),
    '카네이션 14박스(11종), 프리덤 10단, 루스커스 40cm 2박스',
  );

  // 5. 본표 그룹화·연속 중복 빈칸 처리·합계·엑셀(.xlsx) 셀 구조 100% 일치 검증
  const sampleInput = [
    { custName: '나원예', category: '수국', detail: '화이트', qty: 1, unit: '박스', remark: '' },
    { custName: '나원예', category: '수국', detail: '진핑크', qty: 2, unit: '박스', remark: '급건' },
    { custName: '가플라워', category: '루스커스', detail: '', qty: 1, unit: '박스', remark: '' },
    { custName: '가플라워', category: '카네이션', detail: '돈셀', qty: 3, unit: '박스', remark: '' },
    { custName: '가플라워', category: '카네이션', detail: '문라이트', qty: 2, unit: '박스', remark: '' },
    // 다른 거래처로 바뀔 때 이전 거래처의 마지막 품목과 같아도 품목명이 반드시 다시 출력되어야 함
    { custName: '다플라워', category: '수국', detail: '블루', qty: 5, unit: '단', remark: '' },
  ];

  const sheetModel = buildPurchaseOrderSheetModel(sampleInput, {
    staffName: '박성수',
    dateText: '2026-11-25',
  });

  assert.equal(sheetModel.filename, '화훼_발주_내역서_박성수_2026-11-25.xlsx');
  assert.equal(sheetModel.itemCount, 6);
  assert.equal(sheetModel.customerCount, 3);
  assert.equal(sheetModel.totalQty, 14);

  // 가플라워(3행) → 나원예(2행) → 다플라워(1행) 정렬 및 연속 셀 빈칸 검증
  assert.deepEqual(
    sheetModel.detailRows.map(r => [r.no, r.customerDisplay, r.categoryDisplay, r.detailDisplay, r.qty, r.unit, r.remark]),
    [
      [1, '가플라워', '루스커스', '-', 1, '박스', ''],
      [2, '', '카네이션', '돈셀', 3, '박스', ''],
      [3, '', '', '문라이트', 2, '박스', ''],
      [4, '나원예', '수국', '진핑크', 2, '박스', '급건'],
      [5, '', '', '화이트', 1, '박스', ''],
      [6, '다플라워', '수국', '블루', 5, '단', ''],
    ],
  );

  // 엑셀(.xlsx) 바이너리 생성 후 재파싱하여 모든 행/열 위치 검증
  const buffer = writePurchaseOrderWorkbookBuffer(sheetModel);
  assert(Buffer.isBuffer(buffer) && buffer.length > 1000);
  const wb = XLSX.read(buffer, { type: 'buffer' });
  assert.deepEqual(wb.SheetNames, ['화훼 발주 내역서']);
  const ws = wb.Sheets['화훼 발주 내역서'];
  const rowsAoA = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // 1행: 제목, 2행: 빈 줄, 3행: 본표 헤더
  assert.equal(rowsAoA[0][0], '화훼 발주 내역서');
  assert.deepEqual(rowsAoA[1].slice(0, 7), ['', '', '', '', '', '', '']);
  assert.deepEqual(rowsAoA[2].slice(0, 7), ['No.', '거래처', '품목(대분류)', '상세품종 / 규격', '수량', '단위', '비고']);

  // 본표 첫 행 & 연속 행
  assert.deepEqual(rowsAoA[3].slice(0, 7), [1, '가플라워', '루스커스', '-', 1, '박스', '']);
  assert.deepEqual(rowsAoA[4].slice(0, 7), [2, '', '카네이션', '돈셀', 3, '박스', '']);
  assert.deepEqual(rowsAoA[5].slice(0, 7), [3, '', '', '문라이트', 2, '박스', '']);

  // 본표 합계 행 (Row index 3 + 6 = 9)
  assert.equal(rowsAoA[9][0], '총 발주 품목 수 / 단순 수량 합계');
  assert.equal(rowsAoA[9][4], 14);
  assert.equal(rowsAoA[9][5], '총 6건');
  assert.equal(rowsAoA[9][6], '단위(박스/단/대/미지정) 상이함 유의');

  // 하단 거래처별 발주 요약 섹션
  assert.equal(rowsAoA[11][0], '거래처별 발주 요약');
  assert.deepEqual(rowsAoA[12].slice(0, 4), ['', '', '', '']);
  assert.deepEqual(rowsAoA[13].slice(0, 4), ['거래처', '품목 건수', '단순 수량 합계', '주요 발주 내역 요약']);
  assert.deepEqual(rowsAoA[14].slice(0, 4), ['가플라워', 3, 6, '루스커스 1박스, 카네이션(돈셀 3, 문라이트 2)']);
  assert.deepEqual(rowsAoA[15].slice(0, 4), ['나원예', 2, 3, '수국(진핑크 2, 화이트 1)']);
  assert.deepEqual(rowsAoA[16].slice(0, 4), ['다플라워', 1, 5, '수국 블루 5단']);
  assert.deepEqual(rowsAoA[17].slice(0, 4), ['합계', 6, 14, '총 3개 거래처']);

  // 6. SQL 및 API 보안·읽기전용 불변식 검사
  const sqlSource = fs.readFileSync('lib/dailyStaffPurchaseOrderSql.js', 'utf8');
  assert(!/\b(INSERT|UPDATE|DELETE|MERGE|EXEC|DROP|ALTER|CREATE)\b/i.test(sqlSource));
  assert(sqlSource.includes('om.OrderYear'));

  const apiSource = fs.readFileSync('pages/api/stats/daily-order-sheet.js', 'utf8');
  assert(apiSource.includes('withAuth'));
  assert(apiSource.includes("req.method !== 'GET'"));
  assert(apiSource.includes('status(403)'));

  console.log('dailyStaffPurchaseOrder: KST bounds, staff isolation, summary formatter, and XLSX layout passed');
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
