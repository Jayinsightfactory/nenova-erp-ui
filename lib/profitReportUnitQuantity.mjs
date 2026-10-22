// Report-only denominator. Stored Box/Bunch/Steam quantities are alternative units,
// never additive. EstQuantity has no historical unit label, so it is not evidence.
export function reportUnitQuantity(row = {}) {
  const unit = String(row.estUnit || '').trim().toUpperCase();
  const kind = ['박스','BOX','BX'].includes(unit) ? 'box'
    : ['단','BUNCH','BUN'].includes(unit) ? 'bunch'
      : ['송이','스팀','대','STEM','STEAM','EA'].includes(unit) ? 'steam' : null;
  if (!kind) return null;
  const direct = Number(row[`${kind}Quantity`]);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const box = Number(row.boxQuantity);
  const factor = Number(kind === 'bunch' ? row.bunchOf1Box : row.steamOf1Box);
  return kind !== 'box' && box > 0 && Number.isFinite(factor) && factor > 0 ? box * factor : null;
}

export function reportUnitQuantitySql(alias) {
  if (!['sd','wd'].includes(alias)) throw new Error('Unsupported report quantity alias');
  const positive = expression => `CASE WHEN ${expression}>0 THEN ${expression} ELSE NULL END`;
  return `CASE UPPER(LTRIM(RTRIM(ISNULL(p.EstUnit,N''))))
    ${['박스','BOX','BX'].map(u => `WHEN N'${u}' THEN ${positive(`${alias}.BoxQuantity`)}`).join('\n')}
    ${['단','BUNCH','BUN'].map(u => `WHEN N'${u}' THEN COALESCE(${positive(`${alias}.BunchQuantity`)}, ${positive(`${alias}.BoxQuantity`)} * ${positive('p.BunchOf1Box')})`).join('\n')}
    ${['송이','스팀','대','STEM','STEAM','EA'].map(u => `WHEN N'${u}' THEN COALESCE(${positive(`${alias}.SteamQuantity`)}, ${positive(`${alias}.BoxQuantity`)} * ${positive('p.SteamOf1Box')})`).join('\n')}
    ELSE NULL END`;
}

// A partial denominator must not be divided into the full amount.
export function completeReportQuantitySumSql(expression) {
  return `CASE WHEN COUNT(*)=COUNT(${expression}) THEN SUM(${expression}) ELSE NULL END`;
}
