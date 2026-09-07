import { shillaHotelMatchKey, normalizeShillaHotelMatchText } from './shillaPnlHotelMatch.js';
import { shillaPnlProductMatchSnapshot } from './shillaPnlProductMatchState.js';

const MAX_GROUPS = 200;
const MAX_MEMBERS = 10000;

function error(message, statusCode = 400, code = 'INVALID_REQUEST') {
  const result = new Error(message);
  result.statusCode = statusCode;
  result.code = code;
  return result;
}

function positiveInteger(value, field) {
  if (!((typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && /^\d+$/.test(value.trim())))) {
    throw error(`${field}은(는) 양의 정수여야 합니다.`);
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw error(`${field}은(는) 양의 정수여야 합니다.`);
  return number;
}

function own(object, key) { return Object.prototype.hasOwnProperty.call(object || {}, key); }
function prodKeyOf(row) { return row?.prodKey ?? row?.ProdKey; }
function opaqueGroupKey(key) { return `shilla-v1:${encodeURIComponent(key)}`; }

function productMap(activeProducts) {
  if (activeProducts instanceof Map) return activeProducts;
  return new Map((activeProducts || []).map(product => [Number(product.prodKey ?? product.ProdKey), product]));
}

function memberSnapshot(row) {
  const snapshot = shillaPnlProductMatchSnapshot(row);
  return {
    pnlKey: positiveInteger(row.pnlKey ?? row.PnlKey, '결산서'),
    major: positiveInteger(row.major ?? row.MajorWeek, '차수'),
    ...snapshot,
  };
}

function compareMember(left, right) {
  return left.pnlKey - right.pnlKey || left.itemKey - right.itemKey;
}

function sameMember(left, right) {
  try {
    return JSON.stringify(memberSnapshot(left)) === JSON.stringify(memberSnapshot(right));
  } catch {
    return false;
  }
}

/** Browser-safe group DTO policy; SQL callers supply active Product rows only. */
export function buildShillaBulkMatchGroups(rows, activeProducts) {
  const products = productMap(activeProducts);
  const grouped = new Map();
  for (const row of rows || []) {
    const group = shillaHotelMatchKey(row);
    if (!group) continue;
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(memberSnapshot(row));
  }
  const result = [];
  for (const [key, members] of grouped) {
    const sortedMembers = [...members].sort(compareMember);
    const unmatchedCount = sortedMembers.filter(member => member.prodKey === null).length;
    if (!unmatchedCount) continue;
    const mapped = sortedMembers.filter(member => member.prodKey !== null).map(member => Number(member.prodKey));
    const distinct = [...new Set(mapped)];
    let suggestion = { status: 'none' };
    if (distinct.length) {
      const product = distinct.length === 1 ? products.get(distinct[0]) : null;
      suggestion = product
        ? { status: 'unique', product: {
          prodKey: Number(product.prodKey ?? product.ProdKey),
          prodName: product.prodName ?? product.ProdName ?? '',
          displayName: product.displayName ?? product.DisplayName ?? '',
          flowerName: product.flowerName ?? product.FlowerName ?? '',
          counName: product.counName ?? product.CounName ?? '',
          outUnit: product.outUnit ?? product.OutUnit ?? '',
        } }
        : { status: 'conflict' };
    }
    const anchor = sortedMembers[0];
    result.push({
      groupKey: opaqueGroupKey(key),
      label: normalizeShillaHotelMatchText(anchor.name),
      unit: normalizeShillaHotelMatchText(anchor.unit),
      majors: [...new Set(sortedMembers.map(member => member.major))].sort((left, right) => right - left),
      memberCount: sortedMembers.length,
      unmatchedCount,
      suggestion,
      expected: { members: sortedMembers },
    });
  }
  return result.sort((left, right) => left.label.localeCompare(right.label, 'ko') || left.unit.localeCompare(right.unit, 'ko'));
}

/** Rows without an exact name+unit identity are intentionally not guessed. */
export function countShillaBulkUngroupedRows(rows) {
  return (rows || []).filter(row => {
    const custom = row?.isCustom ?? row?.IsCustom;
    return !custom && prodKeyOf(row) === null && !shillaHotelMatchKey(row);
  }).length;
}

export function normalizeShillaBulkGetScope(raw = {}) {
  if (raw.partnerCode !== 'shilla') throw error('신라호텔 결산만 조회할 수 있습니다.');
  if (typeof raw.orderYear !== 'string' || !/^\d{4}$/.test(raw.orderYear.trim())) throw error('결산 연도는 네 자리로 지정해야 합니다.');
  return { partnerCode: 'shilla', orderYear: raw.orderYear.trim() };
}

function normalizeExpected(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.members) || !raw.members.length) {
    throw error('품목 그룹의 현재 행 기준이 필요합니다.');
  }
  const members = raw.members.map(member => {
    if (own(member, 'costPrice') || own(member, 'CostPrice')) throw error('매입단가는 품목 연결 기준에 포함할 수 없습니다.');
    try { return memberSnapshot(member); } catch (cause) { throw error(`품목 그룹 기준이 올바르지 않습니다: ${cause.message}`); }
  }).sort(compareMember);
  const ids = new Set();
  for (const member of members) {
    const id = `${member.pnlKey}:${member.itemKey}`;
    if (ids.has(id)) throw error('품목 그룹 기준에 중복 행이 있습니다.');
    ids.add(id);
  }
  return { members };
}

export function normalizeShillaBulkMatchRequest(raw = {}) {
  const scope = normalizeShillaBulkGetScope(raw);
  if (raw.action !== 'MATCH_SELECTED_GROUPS') throw error('선택 품목 일괄 연결 작업만 지원합니다.');
  if (raw.confirmed !== true) throw error('일괄 연결 확인이 필요합니다.');
  if (!Array.isArray(raw.groups) || !raw.groups.length) throw error('적용할 품목 그룹을 하나 이상 선택하세요.');
  if (raw.groups.length > MAX_GROUPS) throw error(`한 번에 최대 ${MAX_GROUPS}개 품목 그룹만 적용할 수 있습니다.`);
  let memberCount = 0;
  const keys = new Set();
  const groups = raw.groups.map(group => {
    if (!group || typeof group !== 'object' || typeof group.groupKey !== 'string' || !group.groupKey.trim()) {
      throw error('품목 그룹 식별자가 올바르지 않습니다.');
    }
    const groupKey = group.groupKey.trim();
    if (keys.has(groupKey)) throw error('같은 품목 그룹을 중복 적용할 수 없습니다.');
    keys.add(groupKey);
    const expected = normalizeExpected(group.expected);
    memberCount += expected.members.length;
    return { groupKey, prodKey: positiveInteger(group.prodKey, '전산 품목번호'), expected };
  });
  if (memberCount > MAX_MEMBERS) throw error(`한 요청에는 최대 ${MAX_MEMBERS}개 품목 행만 포함할 수 있습니다.`);
  return { ...scope, action: 'MATCH_SELECTED_GROUPS', confirmed: true, groups };
}

export function sameShillaBulkExpectedMembers(live, expected) {
  const left = [...(live || [])].sort(compareMember);
  const right = [...(expected?.members || [])].sort(compareMember);
  return left.length === right.length && left.every((member, index) => sameMember(member, right[index]));
}

export const SHILLA_BULK_LIMITS = { MAX_GROUPS, MAX_MEMBERS };
