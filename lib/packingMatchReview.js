import { erpMatchReview, resolveUniqueProdKey } from './importPackingReceiptAdapter.js';
import { needsInvoiceAllocation } from './invoiceProductAllocation.js';

// Display policy only: reuse receipt eligibility without changing quantities or mappings.
export function packingMatchReview(product, products, country) {
  const matching = String(product?.matchingDescription || product?.sourceName || '').trim();
  const original = String(product?.sourceName || matching).trim();
  if (needsInvoiceAllocation(country, original)) return { status:'ALLOCATION', needsReview:true, label:'파일별 품목·입고량 분류 필요', prodKey:null };
  const matchedName = String(product?.matchedName || product?.name || '').trim();
  const prodKey = resolveUniqueProdKey(matchedName, products, country);
  if (product?.unmatched || !prodKey) return { status: 'UNMATCHED', needsReview: true, label: 'DB 미매칭', prodKey: null };
  const review = erpMatchReview(product, { description: matching, source_description: original }, matchedName, prodKey);
  if (!review.confirmed) return { status: 'REVIEW', needsReview: true, label: '유사 매칭 · 확인 필요', prodKey };
  return { status: review.method === 'MANUAL' ? 'MANUAL' : 'EXACT', needsReview: false,
    label: review.method === 'MANUAL' ? '수동 확인 완료' : '정확 매칭', prodKey };
}
