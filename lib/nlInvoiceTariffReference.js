// New NL invoice/native preview only. Do not change historical freightCalc.
export const EU_ORIGIN_CODES = Object.freeze(new Set([
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','EL','HU','IE',
  'IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','EU',
]));

const RULES = Object.freeze([
  ['Eryngium',.25],['Clematis',.25],['Grevillea',.08],
  ['Kangoroo paw Red',.25],['Kangaroo paw Red',.25],
  ['Delphinium no NL',.25],['Cordyline',.08],
  ['Colombia',.25],['Africa',.25],['Israel',.08],['Sanguisorba',.25],
]);

const FOLIAGE_8PCT_RE = /\b(?:grevillea|cordyline|eucalyptus|ruscus|acacia|acasia|pittosporum|leucothoe|cotinus|fagus|salal|fern|foliage)\b|그레빌레아|코딜라인|코르딜리네|유칼립투스|루스커스|아카시아/i;

export function normalizeNlOriginCode(value) {
  const s = String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : '';
}

export function isNlFoliageTariffItem(name) {
  return FOLIAGE_8PCT_RE.test(String(name ?? ''));
}

export function nlInvoiceTariffRate(name, origin = '') {
  const iso = normalizeNlOriginCode(typeof origin === 'object' && origin !== null ? origin.org : origin);
  if (iso) {
    if (EU_ORIGIN_CODES.has(iso)) {
      return /\bno\s+nl\b/i.test(String(name ?? '')) ? .25 : 0;
    }
    if (iso === 'IL' || isNlFoliageTariffItem(name)) return .08;
    return .25;
  }
  const text = `${name || ''} ${typeof origin === 'string' ? origin : ''}`.toLowerCase().replace(/\s+/g,' ');
  return RULES.find(([pattern]) => text.includes(pattern.toLowerCase()))?.[1] ?? 0;
}

export function nlOriginTariffBucket(name, origin = '') {
  const iso = normalizeNlOriginCode(origin);
  if (!iso) return 'DEFAULT';
  const rate = nlInvoiceTariffRate(name, iso);
  return EU_ORIGIN_CODES.has(iso) && rate === 0 ? 'EU_0' : `NON_EU_${rate}_${iso}`;
}
