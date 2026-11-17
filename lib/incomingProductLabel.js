export function incomingProductLabel(row) {
  if (!row) return '';
  const name = [row.matchedProductDbName, row.matchedProductName, row.colorName, row.productName]
    .find(value => typeof value === 'string' && value.trim());
  return [row.countryName?.trim(), name?.trim() || '품명 미확인'].filter(Boolean).join(' · ');
}
export function incomingOutputProductLabel(row) {
  const full = incomingProductLabel(row);
  const country = row?.countryName?.trim();
  const name = country ? full.slice(country.length + 3) : full;
  const prefix = ({ '콜롬비아': '콜', '중국': '중' })[country] || country;
  const short = name.replace(/^(SPRAY ROSE|ROSE|Hydrangea|Ruscus|CARNATION)\b/i,
    token => ({ 'SPRAY ROSE': '스프레이장미', ROSE: '장미', HYDRANGEA: '수국', RUSCUS: '루스커스', CARNATION: '카네이션' })[token.toUpperCase()])
    .replace(/\s+CHINA\b/ig, '').replace(/\s*\/\s*/g, ' ')
    .replace(/\bBlue\s*\(블루[)）]/ig, '블루').replace(/\bBlue\b/ig, '블루');
  return [prefix, short].filter(Boolean).join(' ');
}
