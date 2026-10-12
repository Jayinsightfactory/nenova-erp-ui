const REQUIRED_CONFIRMED_FIELDS = [
  'confirmedBy', 'confirmedAt', 'custKey', 'country', 'sourceText', 'prodKey',
];

function text(value) { return String(value ?? '').trim(); }
function positiveInt(value) { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : null; }

export function normalizeProductMatchEvidence(input = {}) {
  return {
    evidenceId: text(input.evidenceId),
    sourceType: text(input.sourceType || 'unknown'),
    sourceRef: text(input.sourceRef),
    sourceText: text(input.sourceText),
    prodKey: positiveInt(input.prodKey),
    custKey: positiveInt(input.custKey),
    customerName: text(input.customerName),
    country: text(input.country),
    flower: text(input.flower),
    color: text(input.color),
    unit: text(input.unit),
    orderYear: positiveInt(input.orderYear),
    orderWeek: text(input.orderWeek),
    confirmedBy: text(input.confirmedBy),
    confirmedAt: text(input.confirmedAt),
    explicitUserConfirmation: input.explicitUserConfirmation === true,
    autoSelected: input.autoSelected === true,
    prodKeyChanged: input.prodKeyChanged === true,
    customerOnlyChanged: input.customerOnlyChanged === true,
    provenanceConflict: input.provenanceConflict === true,
  };
}

export function classifyProductMatchEvidence(input = {}) {
  const row = normalizeProductMatchEvidence(input);
  const missingConfirmedFields = REQUIRED_CONFIRMED_FIELDS.filter((field) => !row[field]);
  const blockers = [];
  if (!row.country) blockers.push('COUNTRY_MISSING');
  if (row.autoSelected) blockers.push('AUTO_SELECTED');
  if (row.provenanceConflict) blockers.push('PROVENANCE_CONFLICT');
  if (!row.prodKey) blockers.push('PROD_KEY_MISSING');

  const confirmed = row.explicitUserConfirmation
    && !row.autoSelected
    && !row.provenanceConflict
    && missingConfirmedFields.length === 0;

  if (confirmed) return { ...row, status: 'CONFIRMED_TRAINING_SAMPLE', confidence: 1, blockers, missingConfirmedFields };

  let confidence = 0.25;
  if (row.explicitUserConfirmation) confidence = 0.82;
  else if (row.sourceType === 'defect-correction' && row.prodKeyChanged && !row.customerOnlyChanged) confidence = 0.78;
  else if (row.sourceType === 'paste-manual') confidence = 0.68;
  else if (row.sourceType === 'erp-final-save') confidence = 0.62;
  else if (row.sourceType === 'paste-unknown') confidence = 0.35;
  if (row.autoSelected) confidence = Math.min(confidence, 0.15);
  if (row.provenanceConflict) confidence = Math.min(confidence, 0.1);

  return {
    ...row,
    status: blockers.includes('COUNTRY_MISSING') || blockers.includes('AUTO_SELECTED') || blockers.includes('PROVENANCE_CONFLICT')
      ? 'QUARANTINED'
      : 'LEARNING_CANDIDATE',
    confidence,
    blockers,
    missingConfirmedFields,
  };
}

export function buildProductMatchReviewQueue(evidenceRows = []) {
  return evidenceRows.map(classifyProductMatchEvidence).sort((a, b) =>
    (a.status === 'CONFIRMED_TRAINING_SAMPLE' ? -1 : 0) - (b.status === 'CONFIRMED_TRAINING_SAMPLE' ? -1 : 0)
      || b.confidence - a.confidence
      || a.sourceText.localeCompare(b.sourceText, 'ko'));
}

export function pasteMappingToEvidence([sourceText, mapping]) {
  const manual = mapping?.manual === true;
  const auto = mapping?.auto === true;
  return normalizeProductMatchEvidence({
    evidenceId: `paste:${sourceText}`,
    sourceType: manual && !auto ? 'paste-manual' : auto && !manual ? 'paste-auto' : 'paste-unknown',
    sourceRef: 'data/order-mappings.json',
    sourceText,
    prodKey: mapping?.prodKey,
    country: mapping?.counName,
    flower: mapping?.flowerName,
    color: mapping?.displayName || mapping?.prodName,
    confirmedAt: mapping?.savedAt,
    autoSelected: auto,
    // legacy `manual` has no confirmer/customer/save action proof, so it is a candidate only.
    explicitUserConfirmation: false,
    provenanceConflict: manual && auto,
  });
}

