// Browser/server shared invoice-header rule. Never use substring matching.
export const normalizeNlInvoiceCustomerCode = value => String(value ?? '').replace(/\s+/g, '').toUpperCase();
export const isNlInvoiceOwnCode = value => ['CL2', 'YCL2'].includes(normalizeNlInvoiceCustomerCode(value));
