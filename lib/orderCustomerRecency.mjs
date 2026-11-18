// LastOrderDtm comes from the existing active-order customer lookup.
export function sortRecentOrderCustomers(customers = []) {
  const timestamp = customer => Date.parse(customer.LastOrderDtm) || 0;
  return [...customers].sort((a, b) =>
    timestamp(b) - timestamp(a) ||
    String(a.CustName || '').localeCompare(String(b.CustName || ''), 'ko') ||
    Number(a.CustKey) - Number(b.CustKey)
  );
}
