// Read-only audit summary. No product/customer names, amounts or credentials.
export function summarizeProfitDutyCoverage(rows = []) {
  return rows.filter(row => row.templateDuty).map(row => {
    const failures = {};
    const count = code => { failures[code] = (failures[code] || 0) + 1; };
    for (const item of row.templateDuty.missing || []) {
      for (const code of item.diagnostic?.failed || ['UNCLASSIFIED_MISSING_BASIS']) count(code);
    }
    for (const boundary of ['begin','end']) {
      for (const code of row.inventoryValuation?.[boundary]?.dutyDiagnostic?.failed || []) count(`${boundary}:${code}`);
    }
    return { category: row.category, status: row.templateDuty.status,
      nullColumns: ['E','F','H','I','J','K'].filter(key => row.calc?.[key] == null),
      failures, inventoryHeld: row.templateDuty.inventoryHeld === true,
      storedSourceLines: (row.templateDuty.details || []).filter(detail => ['freight_snapshot','stored_or_historical'].includes(detail.source)).length,
      formulaLines: (row.templateDuty.details || []).filter(detail => detail.source === 'approved_template').length };
  });
}
