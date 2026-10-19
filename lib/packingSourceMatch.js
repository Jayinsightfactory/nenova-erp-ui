// Source row identity takes precedence over a name that may occur many times.
export function packingSourceMatchedName(invoices, invoiceIndex, sourceRow) {
  const rows = (invoices || []).filter(invoice =>
    (invoice?.sourceInvoiceIdentity?.sourceInvoiceIndex ?? invoice?.sourceInvoiceIndex) === invoiceIndex)
    .flatMap(invoice => invoice.products || []);
  const indexed = Number.isInteger(sourceRow?.lineIndex)
    ? rows.filter(row => row.sourceLineIndex === sourceRow.lineIndex) : [];
  const candidates = indexed.length ? indexed : rows.filter(row =>
    row.sourceName === sourceRow?.description || row.matchingDescription === sourceRow?.description);
  const nameOf = row => row.matchedName || row.name;
  if (!candidates.length || candidates.some(row => row.unmatched || !nameOf(row))) return null;
  const names = new Set(candidates.map(nameOf));
  return names.size === 1 ? nameOf(candidates[0]) : null;
}
