// 견적서/거래명세표 인쇄·Excel 공통 헤더 (수신처 + 회사정보)
// Phase 1: config/tenant.*.json → lib/tenant.js (청사진: docs/BLUEPRINT_WHITE_LABEL_ERP.md)

import { getCompany } from './tenant';

function companyBlock() {
  try {
    const c = getCompany();
    if (c?.legalName) {
      return {
        bizNo: c.bizNo || '',
        name: c.legalName,
        address: c.address || '',
        bizType: c.bizType || '',
        account: c.bankAccount || '',
        telFax: c.telFax || '',
      };
    }
  } catch { /* 서버/빌드 전 tenant 파일 없을 때 폴백 */ }
  return {
    bizNo: '134-86-94367',
    name: '(주)네노바 / 김원배',
    address: '서울 서초구 언남길 15-7, 102호',
    bizType: '도매 / 무역',
    account: '하나 630-008129-149',
    telFax: '02-575-8003 / 02-576-8003',
  };
}

/** 인쇄·Excel용 회사 블록 (tenant 설정 → 폴백) */
export function resolveCompanyBlock() {
  return companyBlock();
}

/** @deprecated resolveCompanyBlock() — 하위 호환 정적 객체 */
export const NENOVA_COMPANY = typeof window === 'undefined'
  ? companyBlock()
  : {
    bizNo: '134-86-94367',
    name: '(주)네노바 / 김원배',
    address: '서울 서초구 언남길 15-7, 102호',
    bizType: '도매 / 무역',
    account: '하나 630-008129-149',
    telFax: '02-575-8003 / 02-576-8003',
  };

export function numToKorean(n) {
  const num = Math.round(Math.abs(n || 0));
  if (num === 0) return '영원 정';
  const digits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const pos4 = ['', '십', '백', '천'];
  const bigUnit = ['', '만', '억', '조'];
  function fourDigit(v) {
    let s = '';
    const d = [Math.floor(v / 1000) % 10, Math.floor(v / 100) % 10, Math.floor(v / 10) % 10, v % 10];
    for (let i = 0; i < 4; i++) {
      if (!d[i]) continue;
      s += digits[d[i]] + pos4[3 - i];
    }
    return s;
  }
  const parts = [];
  let rem = num;
  for (let i = 0; i < 4; i++) {
    const chunk = rem % 10000;
    rem = Math.floor(rem / 10000);
    if (chunk > 0) parts.unshift(fourDigit(chunk) + bigUnit[i]);
  }
  return `${parts.join('')}원 정`;
}

/**
 * 인쇄 HTML 상단과 동일한 수신·공급자 정보 블록 (Excel용 aoa + merge 메타)
 */
export function buildPrintExcelHeaderAoa({
  title,
  custName,
  serialNo,
  printDate,
  bigoLabel,
  totalAmt,
  statementFormat = false,
  colCount = 10,
}) {
  const serialDisplay = serialNo || printDate || '';
  const greet2 = statementFormat
    ? '2. 하기와 같이 거래 명세를 전달드립니다.'
    : '2. 하기와 같이 견적드리오니 검토하기 바랍니다.';
  const c = resolveCompanyBlock();
  const split = Math.max(4, Math.floor(colCount / 2));

  const pad = (row) => {
    const next = [...row];
    while (next.length < colCount) next.push('');
    return next.slice(0, colCount);
  };

  const aoa = [];
  const merges = [];

  aoa.push(pad([title]));
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } });
  aoa.push(pad([]));

  const leftRight = (labelL, valL, labelR, valR) => {
    const row = new Array(colCount).fill('');
    row[0] = labelL;
    row[1] = valL;
    row[split] = labelR;
    row[split + 1] = valR;
    aoa.push(row);
  };

  leftRight('일련번호', serialDisplay, '사업자등록번호', c.bizNo);
  leftRight('수신', custName || '', '회사명/대표', c.name);
  leftRight('참조', '', '주소', c.address);
  leftRight('TEL/FAX', '', '업태/종목', c.bizType);
  leftRight('결제조건', '', '계좌번호', c.account);
  leftRight('유효기간', '', 'TEL/FAX', c.telFax);
  leftRight('비고', bigoLabel || '', '', '');

  const greetRow = aoa.length;
  aoa.push(pad(['1. 귀사의 일익 번창하심을 기원합니다.']));
  merges.push({ s: { r: greetRow, c: 0 }, e: { r: greetRow, c: colCount - 1 } });
  const greet2Row = aoa.length;
  aoa.push(pad([greet2]));
  merges.push({ s: { r: greet2Row, c: 0 }, e: { r: greet2Row, c: colCount - 1 } });

  const amtRow = aoa.length;
  aoa.push(pad([`금 액 : ${numToKorean(totalAmt)}`, `(W ${Number(totalAmt || 0).toLocaleString()}원) / VAT 포함`]));
  merges.push({ s: { r: amtRow, c: 0 }, e: { r: amtRow, c: colCount - 1 } });

  aoa.push(pad([]));

  return { aoa, merges, dataStartOffset: aoa.length };
}
