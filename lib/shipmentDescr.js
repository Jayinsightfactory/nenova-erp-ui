// lib/shipmentDescr.js
// 전산(nenova.exe) ShipmentDetail.Descr(비고) 표기 규칙.
//
//  Descr = [사용자 직접 입력 메모] + [수량변동 운영 로그 최근 N건]
//  - 사용자 메모: 견적서 적요에만 표시 (lib/estimateInvariants.sanitizeDescrTextForPrint)
//  - 운영 로그: "담당자+이전>이후" 형식, 최근 MAX_DESCR_ENTRIES건만 유지 (분배 화면용)
//  - SqlClient/트리거 감사줄은 절대 보존하지 않는다
//
//  ⚠️ 전체 변경 이력은 ShipmentHistory 테이블(웹/DB)에 별도 보존된다.

import { isOperationalEstimateDescr, isSqlAuditDescrLine } from './estimateInvariants.js';

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

/** Descr 문자열을 사용자 메모 / 운영 로그로 분리 */
export function splitDescrParts(existing) {
  return String(existing || '')
    .split(/[\r\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !isSqlAuditDescrLine(s));
}

export function partitionDescrParts(parts) {
  const userMemos = [];
  const operational = [];
  (parts || []).forEach((p) => {
    if (isOperationalEstimateDescr(p)) operational.push(p);
    else userMemos.push(p);
  });
  return { userMemos, operational };
}

/** SqlClient·트리거 감사줄만 제거. 사용자 메모와 재용3>2 형식은 유지 */
export function stripSqlAuditFromDescr(existing) {
  const parts = splitDescrParts(existing);
  return parts.join(',');
}

// 기존 비고 + 새 운영 항목 → 사용자 메모는 유지, 운영 로그만 최근 max건.
// SqlClient 감사줄은 버리고, 짧은 "담당자이전>이후"만 남긴다.
export function appendDescr(existing, entry, max = MAX_DESCR_ENTRIES) {
  const { userMemos, operational } = partitionDescrParts(splitDescrParts(existing));
  if (entry && !isSqlAuditDescrLine(entry)) operational.push(entry);
  const tailOps = operational.slice(-max);
  return [...userMemos, ...tailOps].join(',');
}
