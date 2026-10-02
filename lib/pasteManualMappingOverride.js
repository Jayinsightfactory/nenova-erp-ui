import { productReviewAllowed } from './pasteAiMatchReview.js';
import { isFreightMismatch, isMixBoxMismatch, normalizePasteToken } from './pasteLocalMapping.js';

/**
 * A reviewed row may be corrected only by an exact, explicitly saved server alias.
 * Pass the mappings returned by GET /api/orders/mappings, never a browser/session merge.
 * inputName is the exact alias key; safetyContext is the full matchName (when
 * available), including headers that carry country/family/cm constraints.
 * This only resolves the target; the caller owns the row and must preserve its
 * quantity, unit, action, year and week when applying the correction.
 *
 * @returns {{ product: object, mapping: { key: string, value: object } } | null}
 */
export function resolveManualMappingOverride(inputName, serverMappings, products, safetyContext = inputName) {
  const normalized = normalizePasteToken(inputName);
  if (!normalized || !serverMappings || !Array.isArray(products)) return null;

  // No compact/fuzzy lookup. Duplicate normalized aliases are ambiguous, even if
  // one happens to be manual; fail closed instead of depending on object order.
  const exact = Object.entries(serverMappings).filter(([key]) => normalizePasteToken(key) === normalized);
  if (exact.length !== 1) return null;
  const [key, value] = exact[0];
  const prodKey = Number(value?.prodKey);
  if (value?.manual !== true || value?.auto === true || !Number.isSafeInteger(prodKey) || prodKey <= 0) return null;

  // Never build a synthetic Product from cached names. The active master list is
  // the only authority for a persisted ProdKey and its current safety metadata.
  const product = products.find(p => Number(p?.ProdKey) === prodKey
    && Number(p?.isDeleted ?? p?.IsDeleted ?? 0) === 0);
  if (!product) return null;
  if (!productReviewAllowed(safetyContext, product)
    || isMixBoxMismatch(safetyContext, product)
    || isFreightMismatch(safetyContext, product)) return null;

  return { product, mapping: { key, value } };
}
