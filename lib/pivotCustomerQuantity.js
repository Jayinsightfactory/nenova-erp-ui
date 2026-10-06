/** Read a customer quantity by the stable ERP identity when available. */
export function pivotCustomerQuantity(row, customer) {
  const custKey = Number(customer?.custKey);
  if (row?.ordersByCustKey && Number.isSafeInteger(custKey) && custKey > 0) {
    return Number(row.ordersByCustKey[String(custKey)] || 0);
  }
  return Number(row?.orders?.[customer?.custName] || 0);
}
