// 라움/초이문 손익계산서 — 같은 화면·같은 기능, 거래처만 분리.
// 결산 저장 키는 OrderYear + MajorWeek + PartnerCode.
// 전산 조회는 Customer.CustName LIKE 로 거래처를 고르며 OrderWeek 단독 조회는 하지 않는다.
import { evaluateRaumPnlImportReview } from './raumPnlImportReview.js';

export const PNL_PARTNERS = Object.freeze({
  shilla: {
    code: 'shilla', label: '신라호텔', custName: '신라호텔',
    defaultBranch: '신라호텔', sheetMode: 'shilla', erpSync: false,
    custLikeSql: '1=0', custLookupSql: '1=0',
  },
  raum: {
    code: 'raum',
    label: '라움',
    custName: '라움',
    defaultBranch: null,
    sheetMode: 'branches',
    custLikeSql: `(c.CustName LIKE N'%라움%' OR c.CustName LIKE N'%트라움%')`,
    custLookupSql: `(CustName LIKE N'%트라움%' OR CustName LIKE N'%라움%')`,
  },
  choimun: {
    code: 'choimun',
    label: '초이문',
    custName: '초이문',
    defaultBranch: '초이문',
    sheetMode: 'single',
    custLikeSql: `(c.CustName LIKE N'%초이문%')`,
    custLookupSql: `(CustName LIKE N'%초이문%')`,
  },
});

for (const partner of Object.values(PNL_PARTNERS)) Object.freeze(partner);
const RESERVED_CUSTOM_HOTEL_LABELS = new Set(['신라', '신라호텔', '라움', '트라움', '초이문']);

function normalizeLabel(value) {
  const raw = String(value == null ? '' : value);
  // Validate before whitespace collapse: otherwise a newline could become a
  // harmless-looking space in a descriptor that is later trusted by the UI.
  if (/[\u0000-\u001f\u007f-\u009f]/.test(raw)) return null;
  const label = raw.normalize('NFKC').replace(/[\s\u00a0]+/g, ' ').trim();
  if (!label || label.length > 80 || RESERVED_CUSTOM_HOTEL_LABELS.has(label.toLowerCase())) return null;
  return label;
}

/**
 * Turn an active WebPnlHotel row into the intentionally limited P&L partner
 * descriptor.  This is pure so server code can load a row once and every
 * caller receives the same non-ERP capabilities.
 */
export function customPnlHotelDescriptor(row) {
  const databaseCode = row?.PartnerCode ?? row?.partnerCode;
  const descriptorCode = row?.code;
  const dbKey = databaseCode == null ? '' : String(databaseCode).trim().toLowerCase();
  const descriptorKey = descriptorCode == null ? '' : String(descriptorCode).trim().toLowerCase();
  // A UI descriptor must carry its own exact code.  DB rows are adapted by
  // the registry with an explicit kind before entering this pure resolver.
  if (dbKey && descriptorKey && dbKey !== descriptorKey) return null;
  const code = descriptorKey || dbKey;
  const label = normalizeLabel(row?.Name ?? row?.name ?? row?.label);
  const kind = row?.kind ?? row?.Kind;
  if (!/^hotel_[0-9a-f]{12}$/.test(code) || kind !== 'custom-hotel' || !label) return null;
  return {
    code,
    kind: 'custom-hotel',
    label,
    custName: label,
    defaultBranch: label,
    sheetMode: 'single',
    erpSync: false,
    custLikeSql: '1=0',
    custLookupSql: '1=0',
    customHotel: true,
  };
}

export function resolvePnlPartner(code, customDescriptor = null) {
  const key = String(code == null || code === '' ? 'raum' : code).trim().toLowerCase();
  const partner = Object.prototype.hasOwnProperty.call(PNL_PARTNERS, key) ? PNL_PARTNERS[key] : null;
  if (partner) return { ...partner };
  const custom = customPnlHotelDescriptor(customDescriptor);
  if (custom && custom.code === key) return custom;
  throw new Error('거래처는 라움 또는 초이문, 신라호텔 또는 등록된 호텔만 선택할 수 있습니다.');
}

export function defaultPnlTitle(partnerCode, major, suffix = '', customDescriptor = null) {
  const partner = resolvePnlPartner(partnerCode, customDescriptor);
  const n = Number(major);
  const week = Number.isFinite(n) && n > 0 ? `${n}차` : '?차';
  return `${partner.label} ${week}${suffix}`;
}

export function isRaumBranch(branch) {
  return branch === '강남' || branch === '건대';
}

/** 선택한 거래처 견적서 시트만 받는다. 라움 파일과 초이문 파일을 섞지 않는다. */
export function acceptQuoteSheet(parsed, partner) {
  if (!parsed?.major) return { ok: false, reason: 'no-major' };
  if (partner.code === 'raum') {
    if (isRaumBranch(parsed.branch)) return { ok: true };
    if (parsed.partnerHint === 'choimun' || parsed.branch === '초이문') {
      return { ok: false, reason: 'choimun-file' };
    }
    return { ok: false, reason: 'not-branch' };
  }
  if (isRaumBranch(parsed.branch) || parsed.partnerHint === 'raum') {
    return { ok: false, reason: 'raum-file' };
  }
  return { ok: true };
}

export function sheetRejectWarning(sheetName, reason) {
  if (reason === 'no-major') return `${sheetName}: 시트명에서 차수를 찾지 못해 제외했습니다. (예: 27차강남양식 또는 32차)`;
  if (reason === 'choimun-file') return `${sheetName}: 초이문 견적서 시트입니다. 상단에서 초이문을 선택한 뒤 다시 올려주세요.`;
  if (reason === 'raum-file') return `${sheetName}: 강남/건대 라움 시트입니다. 상단에서 라움을 선택한 뒤 다시 올려주세요.`;
  return `${sheetName}: 선택한 거래처 견적서 시트가 아니어서 제외했습니다.`;
}

export function emptyWorkbookWarning(partner) {
  return partner.code === 'choimun'
    ? '초이문 견적서 시트를 찾지 못했습니다. 시트명이 32차처럼 차수만 있고 비고에 초이문이 있는지 확인하세요.'
    : '강남/건대 라움 견적서 시트를 찾지 못했습니다.';
}

/** 합계 검증 통과 + 기존 저장본 덮어쓰기 없음 → 업로드 직후 목록에 남겨도 된다. */
export function canAutoCommitRaumPnlImport(batches) {
  if (!Array.isArray(batches) || batches.length === 0) return false;
  // Missing partnerCode is the pre-registry Raüm import shape, whose default
  // remains raum.  Any explicit custom/unknown partner is manual-save only.
  if (batches.some(batch => !['raum', 'choimun'].includes(String(batch?.partnerCode ?? 'raum').trim().toLowerCase()))) return false;
  const decision = evaluateRaumPnlImportReview(batches);
  if (!decision.allowAuto) return false;
  return !batches.some(batch => batch?.existingDiff?.hasChanges);
}
