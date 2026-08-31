// evaluateImportRowFixBlock 단위 테스트
// node __tests__/shipmentFixScope.test.js

const fs = require('fs');
const path = require('path');

const assert = (label, cond) => {
  if (!cond) {
    console.error(`  FAIL ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`  PASS ${label}`);
  }
};

async function main() {
  const { evaluateImportRowFixBlock, buildImportFixBlockedAlert } = await import('../lib/shipmentFixScopeCore.js');

  const catFixed = new Map([
    ['네덜란드', { status: 'FULLY_FIXED', fixedLines: 10, unfixedLines: 0 }],
    ['콜롬비아카네이션', { status: 'UNFIXED', fixedLines: 0, unfixedLines: 3 }],
  ]);
  const lineFixed = new Map([
    ['1|100', { lineFixed: true, masterFixed: true }],
  ]);

  console.log('\n=== 품종 전체 확정 → 차단 ===');
  {
    const r = evaluateImportRowFixBlock({
      orderWeek: '24-02',
      countryFlower: '네덜란드',
      prodName: 'Rose Red',
      custKey: 5,
      prodKey: 200,
      categoryFixStates: catFixed,
      lineFixStates: lineFixed,
    });
    assert('blocked', r.fixBlocked === true);
    assert('reason mentions 품종', (r.fixBlockReason || '').includes('품종'));
  }

  console.log('\n=== 미확정 품종 → 허용 ===');
  {
    const r = evaluateImportRowFixBlock({
      orderWeek: '24-02',
      countryFlower: '콜롬비아카네이션',
      prodName: 'Carnation',
      custKey: 9,
      prodKey: 300,
      categoryFixStates: catFixed,
      lineFixStates: lineFixed,
    });
    assert('not blocked', r.fixBlocked === false);
  }

  console.log('\n=== 확정된 출고라인 → 차단 ===');
  {
    const r = evaluateImportRowFixBlock({
      orderWeek: '24-02',
      countryFlower: '콜롬비아카네이션',
      prodName: 'Carnation',
      custKey: 1,
      prodKey: 100,
      categoryFixStates: catFixed,
      lineFixStates: lineFixed,
    });
    assert('line blocked', r.fixBlocked === true);
  }

  console.log('\n=== 검증 버튼 확정차단 알림 ===');
  {
    const none = buildImportFixBlockedAlert({ orderYear: 2026, week: '35-01', fixBlockedRows: [] });
    assert('미확정이면 알림 없음', none === '');

    const message = buildImportFixBlockedAlert({
      orderYear: 2026,
      week: '35-01',
      fixBlockedRows: [
        { custName: '남대문 청화', prodName: 'ROSE Red Panther', reason: '35-01차 장미 품종은 확정되어 수정할 수 없습니다.' },
        { custName: '주광농원', prodName: 'ROSE Red Panther', reason: '이미 확정된 출고라인입니다.' },
      ],
    });
    assert('연도·세부차수 표시', message.includes('2026-35-01'));
    assert('차단 건수 표시', message.includes('2건'));
    assert('대상 업체·품목 표시', message.includes('남대문 청화 / ROSE Red Panther'));
    assert('확정취소 후 재검증 안내', message.includes('확정취소한 뒤 다시 검증'));

    const pageSource = fs.readFileSync(path.join(process.cwd(), 'pages/shipment/distribute-import.js'), 'utf8');
    assert('검증 성공 직후 공용 알림 helper 사용', pageSource.includes('buildImportFixBlockedAlert({'));
    assert('확정차단 결과를 별도 알림으로 표시', pageSource.includes('if (fixedAlert) window.alert(fixedAlert)'));
  }

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
