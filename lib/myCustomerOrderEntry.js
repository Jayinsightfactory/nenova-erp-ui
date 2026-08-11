export function sortCustomerProducts(rows = []) {
  const flowerUsage = new Map();
  for (const row of rows) {
    const flower = String(row.FlowerName || '기타');
    flowerUsage.set(flower, (flowerUsage.get(flower) || 0) + Number(row.UsageCount || 0));
  }
  return [...rows].sort((a, b) => {
    const af = String(a.FlowerName || '기타');
    const bf = String(b.FlowerName || '기타');
    return (flowerUsage.get(bf) || 0) - (flowerUsage.get(af) || 0)
      || af.localeCompare(bf, 'ko')
      || Number(b.UsageCount || 0) - Number(a.UsageCount || 0)
      || Number(b.LastOrderYear || 0) - Number(a.LastOrderYear || 0)
      || String(b.LastOrderWeek || '').localeCompare(String(a.LastOrderWeek || ''))
      || String(a.DisplayName || a.ProdName || '').localeCompare(String(b.DisplayName || b.ProdName || ''), 'ko');
  });
}

export function quantitiesMatch(expected, actual, epsilon = 0.0001) {
  return Math.abs(Number(expected || 0) - Number(actual || 0)) <= epsilon;
}
