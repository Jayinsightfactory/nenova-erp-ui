// lib/shipmentDescr.js
// 전산(nenova.exe) ShipmentDetail.Descr(비고) 표기 규칙.
//
//  목적: 전산 비고는 "보기 쉽게" 최신화 — 맨 뒤 2건만 콤마로 표기.
//        형식: 담당자 + 이전수량 > 새수량   예) "임16>12,임12>14"
//
//  ⚠️ 전체 변경 이력은 ShipmentHistory 테이블(웹/DB)에 별도 보존된다.
//     비고(Descr)는 그 요약(최근 2건)일 뿐이므로 누적/무한증가시키지 않는다.
//
//  규칙 2(환산필드)와 무관 — 이 파일은 Descr 문자열 표기만 담당.

export const MAX_DESCR_ENTRIES = 2;

// 정수면 정수로, 소수면 불필요한 0 제거.
export function fmtQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  if (Math.abs(n - Math.round(n)) < 0.0001) return String(Math.round(n));
  return n.toFixed(3).replace(/\.?0+$/, '');
}

// 담당자 표기: 이름 그대로(공백 제거). 비어있으면 'web'.
export function manager(name) {
  return String(name || '').trim().replace(/\s+/g, '') || 'web';
}

// 단일 변경 항목 한 개: "임16>12"
export function changeEntry(name, before, after) {
  return `${manager(name)}${fmtQty(before)}>${fmtQty(after)}`;
}

// 기존 비고 + 새 항목 → 맨 뒤 max개만 콤마로 이어붙인다.
//  - 기존 데이터가 줄바꿈(CHAR(10))·콤마 혼용/옛 형식이어도 분해 후 정리.
//  - 비어있으면 새 항목만.
export function appendDescr(existing, entry, max = MAX_DESCR_ENTRIES) {
  const prev = String(existing || '')
    .split(/[,\n\r]+/)
    .map(s => s.trim())
    .filter(Boolean);
  if (entry) prev.push(entry);
  return prev.slice(-max).join(',');
}
