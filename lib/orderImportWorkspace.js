import { resolveImportCustomer } from './orderImportCustomerMatch.js';

// Stable visual grouping only; pricing authority remains the existing API contract.
export function groupImportPriceCustomers(customers = []) {
  const groups = new Map();
  for (const customer of customers) {
    const managerId = String(customer.managerId ?? '').trim();
    if (!groups.has(managerId)) {
      let hash = 0;
      for (const ch of managerId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
      const colors = ['#1d4ed8', '#047857', '#7e22ce', '#b45309', '#be185d', '#0e7490'];
      groups.set(managerId, { managerId, managerName: customer.managerName || '담당자 미지정', color: managerId ? colors[hash % colors.length] : '#475569', customers: [] });
    }
    groups.get(managerId).customers.push(customer);
  }
  return [...groups.values()].sort((a,b) => (!a.managerId)-(!b.managerId) || a.managerName.localeCompare(b.managerName, 'ko')).map(group => ({ ...group, customers: [...group.customers].sort((a,b) => a.custName.localeCompare(b.custName, 'ko')) }));
}

// Upload title label verified against the existing ERP customer and prior import logs.
// This alias does not alter the shared paste-customer mapping store.
export function resolveUploadCustomer(inputName, customers, options) {
  const token = String(inputName || '').normalize('NFKC').replace(/\s+/g, '');
  if (token === '남대문경원') {
    const exact = customers.filter(c => String(c.CustName || '').normalize('NFKC').replace(/\s+/g, '') === '경원원예');
    return exact.length === 1
      ? { custKey: Number(exact[0].CustKey), customerName: exact[0].CustName, confidence: 100, fromMapping: false, fromAlias: true }
      : { custKey: null, customerName: inputName, confidence: 0, fromMapping: false };
  }
  return resolveImportCustomer(inputName, customers, options);
}
