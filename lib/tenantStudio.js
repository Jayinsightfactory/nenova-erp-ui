import { MENU_ITEMS } from '../components/Layout';
import { cloneTenantConfig } from './tenantDefaults';

/** 메뉴 항목 ↔ 기능 플래그 */
const MENU_FEATURE_MAP = {
  '/orders/paste': 'ordersPaste',
  '/orders/kakao-audit': 'ordersKakaoAudit',
  '/catalog': 'catalogPptx',
  '/sales/revenue-management': 'salesRevenueManagement',
  '/ecount/dashboard': 'ecount',
  '/automation': 'automation',
  '/admin/chat-audit': 'mobileChat',
  '/shipment/fix-status': 'shipmentExeReconcile',
};

export function companyBlockFromTenant(tenant) {
  const c = tenant?.company || {};
  return {
    bizNo: c.bizNo || '',
    name: c.legalName || '',
    address: c.address || '',
    bizType: c.bizType || '',
    account: c.bankAccount || '',
    telFax: c.telFax || '',
  };
}

export function isFeatureOn(tenant, key) {
  return tenant?.features?.[key] !== false;
}

export function filterMenuForTenant(tenant) {
  const features = tenant?.features || {};
  const integrations = tenant?.integrations || {};

  return MENU_ITEMS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      const feat = MENU_FEATURE_MAP[item.href];
      if (feat === 'ecount') return integrations.ecount?.enabled !== false && features[feat] !== false;
      if (feat === 'automation') return integrations.n8n?.enabled !== false && features.automation !== false;
      if (!feat) return true;
      return features[feat] !== false;
    }),
  })).filter((g) => g.items.length > 0);
}

export function buildTenantJson(tenant) {
  const { requirements, ...exportable } = tenant;
  return {
    $schema: './tenant.schema.json',
    ...exportable,
    _requirementsNote: requirements || undefined,
  };
}

export function applyRequirementsHints(tenant, requirementsText) {
  const next = cloneTenantConfig(tenant);
  next.requirements = requirementsText;
  const t = String(requirementsText || '').toLowerCase();

  if (/exe|전산|레거시/.test(t) && /없|미사용|안/.test(t)) {
    next.legacyAdapter = { ...next.legacyAdapter, enabled: false };
    next.features = { ...next.features, shipmentExeReconcile: false };
  }
  if (/이카운트|ecount/.test(t) && /없|미연동|안/.test(t)) {
    next.integrations = { ...next.integrations, ecount: { enabled: false } };
  }
  if (/카톡|카카오|붙여넣기/.test(t) && /필요|사용|포함/.test(t)) {
    next.features = { ...next.features, ordersPaste: true, ordersKakaoAudit: true };
  }
  if (/카탈로그|ppt|파워포인트/.test(t)) {
    next.features = { ...next.features, catalogPptx: true };
  }
  if (/챗봇|모바일/.test(t)) {
    next.features = { ...next.features, mobileChat: true };
  }
  if (/자동화|n8n/.test(t)) {
    next.features = { ...next.features, automation: true };
    next.integrations = { ...next.integrations, n8n: { enabled: true, baseUrl: next.integrations?.n8n?.baseUrl || '' } };
  }
  if (/꽃|화훼|flower/.test(t)) {
    next.industry = { ...next.industry, vertical: 'flower-import', timeBucketLabel: next.industry?.timeBucketLabel || '차수' };
  }
  if (/주차|week/.test(t) && !/차수/.test(t)) {
    next.industry = { ...next.industry, timeBucketLabel: '주차' };
  }

  return next;
}

export const FEATURE_LABELS = [
  { key: 'ordersPaste', label: '붙여넣기 주문등록' },
  { key: 'ordersKakaoAudit', label: '카톡 변경 검증' },
  { key: 'shipmentExeReconcile', label: '출고확정·exe 정합' },
  { key: 'catalogPptx', label: '거래처 카탈로그/PPTX' },
  { key: 'mobileChat', label: '모바일·챗봇' },
  { key: 'salesRevenueManagement', label: '영업매출관리' },
  { key: 'automation', label: 'n8n 자동화' },
];

export const INTEGRATION_LABELS = [
  { key: 'ecount', label: '이카운트' },
  { key: 'googleSheets', label: 'Google Sheets(카톡)' },
  { key: 'anthropic', label: 'AI(Anthropic)' },
  { key: 'n8n', label: 'n8n' },
];
