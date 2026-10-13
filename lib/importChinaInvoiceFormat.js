// File format identity, not confidence or permission to save into ERP.
export const isModernChinaInvoice = format => ['china_invoice_xlsx', 'china_invoice_pdf'].includes(format);
export const isStructuredChinaInvoice = format => isModernChinaInvoice(format) || format === 'china_legacy_invoice_reviewed';
