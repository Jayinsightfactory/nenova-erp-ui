// New NL invoice/native preview only. Do not change historical freightCalc.
const RULES = Object.freeze([
  ['Eryngium',.25],['Clematis',.25],['Grevillea',.08],
  ['Kangoroo paw Red',.25],['Kangaroo paw Red',.25],
  ['Delphinium no NL',.25],['Cordyline',.08],
  ['Colombia',.25],['Africa',.25],['Israel',.08],['Sanguisorba',.25],
]);

export function nlInvoiceTariffRate(name, origin = '') {
  const text = `${name || ''} ${origin || ''}`.toLowerCase().replace(/\s+/g,' ');
  return RULES.find(([pattern]) => text.includes(pattern.toLowerCase()))?.[1] ?? 0;
}
