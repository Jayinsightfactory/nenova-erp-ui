// 2026-08-24 주차별 매출이익보고서 필수 입력 UX 개선 회귀 검증
// pages/sales/profit-report.js 가 다음을 지키는지 정적(source-order) 확인한다:
//   1) "입력·확인 필요" 요약(재고 매입단가/그외통관비/항공료/과세환율) 진입점이 존재하고
//      기존 상태(showCustoms/showForwarding/openPriceModal 등)를 그대로 재사용한다.
//   2) 사용자에게 보이는 JSX 텍스트에 내부 열 문자 표기(검증·입력, 과세환율(R), VERIFIED)를
//      직접 출력하지 않는다 — 소스 주석(//)이나 서버 데이터 문자열까지 금지하는 취약한
//      전체-소스 grep은 피하고, 줄 단위로 순수 주석 줄을 제외한 뒤 검사한다.
//   3) issue.columns 를 렌더링할 때 원문 코드(E/F/H/S/R) 그대로가 아니라
//      ISSUE_COLUMN_LABELS 로 변환한 한글을 사용한다.
//   4) 재고 매입단가 모달이 전용 table 스타일(priceModalTable)을 쓰고, 그 모달 블록 안에서는
//      공용 st.table(minWidth 1800)을 사용하지 않는다.
//
// 실행: node __tests__/profitReportRequiredInputUiContract.test.js
const fs = require('fs');
const path = require('path');

let failed = 0;
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

// 순수 주석 줄(트림 후 '//' 로 시작)만 제거 — 코드/문자열 안의 '//' 는 건드리지 않는다.
function stripCommentLines(source) {
  return source
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');
}

async function main() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'pages', 'sales', 'profit-report.js'),
    'utf8'
  );
  const codeOnly = stripCommentLines(source);
  // 변환 규칙 자체에는 금지할 원문이 반드시 들어간다. 사용자에게 렌더되는 JSX 문자열만
  // 검사하도록 순수 변환 함수 본문은 제외한다.
  const visibleCode = codeOnly.replace(/function humanizeAuditMessage[\s\S]*?\r?\n}\r?\n/, '');

  console.log('=== 1) "입력·확인 필요" 요약 진입점이 기존 상태/핸들러를 재사용함 ===');
  check('재고 매입단가 입력 버튼이 기존 openPriceModal 핸들러를 사용',
    /입력·확인 필요[\s\S]*?onClick=\{openPriceModal\}/.test(source));
  check('그외통관비 입력 버튼이 기존 showCustoms 상태를 사용',
    /입력·확인 필요[\s\S]*?onClick=\{\(\) => setShowCustoms\(v => !v\)\}/.test(source));
  check('항공료 연결 확인 버튼이 기존 showForwarding 상태를 사용',
    /입력·확인 필요[\s\S]*?onClick=\{\(\) => setShowForwarding\(v => !v\)\}/.test(source));
  check('과세환율 입력 필요 안내가 기존 validationRateRows(needsRateInput 기반) 개수를 사용',
    /입력·확인 필요[\s\S]*?validationRateRows\.length > 0/.test(source));
  check('과세환율 전용 입력표가 환율·신고 기준일·근거를 받아 기존 saveTaxableRate 액션으로 저장',
    source.includes('saveRequiredRate') && source.includes("action: 'saveTaxableRate'")
      && source.includes('통관 신고 기준일') && source.includes('환율 근거'));
  check('기타 미분류 품목은 대상 분류를 명시적으로 선택한 뒤 전용 서버 액션으로 저장',
    source.includes('saveProductClassification') && source.includes("action: 'classifyUnclassifiedProduct'")
      && source.includes('올바른 분류 선택') && source.includes('보고서 분류 저장'));
  check('미분류 저장 안내는 전산 품목마스터 보존을 명시',
    source.includes('전산 품목마스터의 국가·화종은 바꾸지 않습니다'));
  check('확정 보고서에서는 환율·품목 분류 저장 버튼이 모두 비활성',
    /disabled=\{data\.confirmed \|\| rateBusy/.test(source)
      && /disabled=\{data\.confirmed \|\| classificationBusy/.test(source));
  check('미분류 경고가 있으면 상세 품목 수가 0이어도 처리 영역과 원인을 표시',
    source.includes('{validationUnclassified && (')
      && source.includes('unclassifiedProducts.length || (validationUnclassified ? 1 : 0)')
      && source.includes('연결된 품목마스터 상세를 찾지 못했습니다'));
  check('확정본에서는 확정 취소 후 입력 가능하다는 안내를 표시',
    source.includes('아래 분류 입력과 저장 버튼이 활성화됩니다'));
  check('CustomsClearancePanel 이 기존 week/year/onSaved=load props 그대로 사용됨',
    /<CustomsClearancePanel week=\{weekInput\.value\} year=\{reportYear\} onSaved=\{load\} \/>/.test(source));
  check('ForwardingClearancePanel 이 기존 week/year/onSaved=load props 그대로 사용됨',
    /<ForwardingClearancePanel week=\{weekInput\.value\} year=\{reportYear\} onSaved=\{load\} \/>/.test(source));

  console.log('\n=== 1-1) 보고서 확정 상태가 현재 차수와 차수별 목록에 항상 보임 ===');
  check('현재 차수 상단에 확정됨/미확정 배지와 revision을 표시',
    source.includes("data.confirmed ? `✓ 확정됨 · R${data.confirmed.revisionNo}` : '● 미확정'")
      && source.includes('보고서 상태:'));
  check('차수별 목록에 별도 보고서 상태 열과 확정됨/미확정 배지를 표시',
    source.includes('<th style={st.th}>보고서 상태</th>')
      && source.includes("w.confirmed ? '✓ 확정됨' : '● 미확정'"));
  check('보고서 확정 상태가 출고 확정과 별개임을 화면 도움말에 명시',
    source.includes('출고 확정 상태와는 별개입니다.'));

  console.log('\n=== 2) 사용자에게 보이는 JSX 텍스트에 내부 표기를 직접 출력하지 않음 ===');
  check('렌더 코드(주석 제외)에 "검증·입력" 문자열이 없음(상세 확인 내역으로 교체됨)',
    !visibleCode.includes('검증·입력'));
  check('렌더 코드(주석 제외)에 "과세환율(R)" 문자열이 없음(과세환율로 교체됨)',
    !visibleCode.includes('과세환율(R)'));
  check('렌더 코드(주석 제외)에 "VERIFIED" 문자열이 없음(확인된 값으로 교체됨)',
    !visibleCode.includes('VERIFIED'));
  check('렌더 코드(주석 제외)에 "C/D/I/J/K" 원문 표기가 없음(한글 라벨로 교체됨)',
    !visibleCode.includes('C/D/I/J/K'));
  check('렌더 코드(주석 제외)에 "C·D·I·J·K" 원문 표기가 없음(한글 라벨로 교체됨)',
    !visibleCode.includes('C·D·I·J·K'));
  check('"상세 확인 내역" 제목이 존재함(검증·입력 대체)', codeOnly.includes('상세 확인 내역'));
  check('"과세환율 입력 필요" 안내 문구가 존재함(과세환율(R) 대체)', codeOnly.includes('과세환율 입력 필요'));

  console.log('\n=== 3) issue.columns 를 원문 열 문자 대신 ISSUE_COLUMN_LABELS 로 렌더링 ===');
  check('ISSUE_COLUMN_LABELS 매핑이 정의됨', /const ISSUE_COLUMN_LABELS = \{/.test(source));
  check('issue.columns 렌더링이 ISSUE_COLUMN_LABELS 를 통해 변환됨',
    /ISSUE_COLUMN_LABELS\[col\] \|\| col/.test(source));
  check('issue.columns.join(\'/\') 원문 그대로 렌더링하는 옛 코드가 남아있지 않음',
    !/\{issue\.columns\.join\('\/'\)\}/.test(source));
  check('서버 감사 메시지도 humanizeAuditMessage를 거쳐 한글 업무 용어로 표시됨',
    /humanizeAuditMessage\(issue\.message\)/.test(source));
  check('감사 메시지 변환기가 VERIFIED와 기초·기말 내부 표기를 변환함',
    /function humanizeAuditMessage/.test(source)
      && /replace\(\/VERIFIED\/g, '확인된'\)/.test(source)
      && source.includes(".replace(/E 최종값/g, '기초상품재고액')")
      && source.includes(".replace(/F 최종값/g, '기말상품재고액')"));
  check('감사 메시지의 H/GW2/Gross weight 내부 용어를 업무 문장으로 변환함',
    source.includes('그외통관비 입력값이 없어 0원으로 계산했습니다.')
      && source.includes('두 번째 입고의 총중량이 0')
      && source.includes(".replace(/Gross weight\\(또는 입고 마스터 GW\\)/g, '입고 총중량')"));
  check('상세 확인 구분이 원천/참고 대신 자동 연결 확인/안내로 표시됨',
    source.includes('자동 연결 확인 필요') && source.includes("['안내', noticeIssues"));

  console.log('\n=== 4) 재고 매입단가 모달이 전용 table 스타일을 쓰고 공용 st.table 을 쓰지 않음 ===');
  check('priceModalTable 전용 스타일이 정의됨(tableLayout fixed)',
    /priceModalTable: \{[^}]*tableLayout: 'fixed'/.test(source));
  check('모달이 st.priceModalTable 을 사용함', /<table style=\{st\.priceModalTable\}>/.test(source));

  const modalStart = source.indexOf('{priceModal && (');
  const modalEnd = source.indexOf('\n      )}', modalStart);
  check('모달 블록 파싱', modalStart !== -1 && modalEnd !== -1 && modalEnd > modalStart);
  const modalBlock = source.slice(modalStart, modalEnd);
  check('모달 블록 안에서 공용 st.table 을 사용하지 않음(가로 스크롤 방지)',
    !/style=\{st\.table\}/.test(modalBlock));
  check('모달 헤더가 전용 헤더 스타일(priceModalTh)을 사용함', /st\.priceModalTh/.test(modalBlock));
  check('모달의 매입단가 입력칸이 최소 140px 폭을 지정함', /minWidth: 140/.test(modalBlock));
  check('모달 카드 크기가 min(1320px, 98vw) 폭 규칙을 사용함(공용 modalCard 스타일)',
    /modalCard: \{ width: 'min\(1320px, 98vw\)'/.test(source));
  check('모달 카드 높이가 92vh 규칙을 사용함', /modalCard: \{[^}]*height: '92vh'/.test(source));
  check('모달에 "입력 필요 N건"/"입력한 값 N건" 요약이 표시됨',
    /입력 필요 \{priceInputRows\.length\}건/.test(modalBlock) && /입력한 값 \{Object\.keys\(priceEdits\)\.length\}건/.test(modalBlock));
  check('모달 상단에도 매입단가 근거 저장 버튼이 있음(하단 버튼과 별개)',
    (modalBlock.match(/onClick=\{savePrices\}/g) || []).length >= 2);
  check('긴 설명이 접힌 "계산 기준 보기"로 분리됨', /계산 기준 보기/.test(modalBlock));
  check('중복된 긴 "입력 사유" 열이 제거됨', !/입력 사유/.test(modalBlock));
  check('열 구성이 재고 기준/국가·품종/품목명/재고수량/환산수량/매입단가(원) 순서를 따름',
    /재고 기준[\s\S]*?국가·품종[\s\S]*?품목명[\s\S]*?재고수량[\s\S]*?환산수량[\s\S]*?매입단가\(원\)/.test(modalBlock));

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
