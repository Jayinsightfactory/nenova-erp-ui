import { normalizeCustomerMappingKey } from './normalizeCustomerToken.js';

export function pasteCustomerMappingKey(inputName) {
  return normalizeCustomerMappingKey(inputName);
}

export function resolveCachedPasteCustomer(inputName, cache = {}, customers = []) {
  const key = pasteCustomerMappingKey(inputName);
  const saved = key ? cache[key] : null;
  if (!saved?.custKey) return null;
  return customers.find((item) => Number(item.CustKey) === Number(saved.custKey)) || null;
}

export function applyPasteCustomerMappings(orders = [], cache = {}, customers = []) {
  return orders.map((order) => {
    const customer = resolveCachedPasteCustomer(order.custName, cache, customers);
    if (!customer) return order;
    return {
      ...order,
      custMatch: customer,
      custFromMapping: true,
      custMappingKey: pasteCustomerMappingKey(order.custName),
    };
  });
}
