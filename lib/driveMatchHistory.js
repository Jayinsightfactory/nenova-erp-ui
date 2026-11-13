// 업무드라이브 원가자료(도착원가 자동반영)로 이미 저장된 "원문 품명 → 전산 품목" 이력.
// 읽기 전용(SELECT). 국가가 맞는 연결만 쓴다 — 줄의 나라와 품목의 나라가 다른 이력은 틀린 연결일 수 있어 제외한다.
const COUNTRY_NAME = { CO: '콜롬비아', CN: '중국', NL: '네덜란드', EC: '에콰도르', TH: '태국', VN: '베트남', AU: '호주', US: '미국' };
export const historyKey = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export async function loadDriveMatchHistory({ queryFn, types, country }) {
  const countryName = COUNTRY_NAME[String(country || '').toUpperCase()];
  if (!countryName) throw Object.assign(new Error('나라를 확인하세요.'), { statusCode: 400 });
  const type = (name, ...args) => typeof types[name] === 'function' ? types[name](...args) : types[name];
  const result = await queryFn(`/* drive-match-history:readonly */ SELECT TOP (20000) l.ProductNameRaw AS raw, l.ProdKey AS prodKey, COUNT(*) AS n, MAX(l.OrderWeek) AS lastWeek
    FROM dbo.WebArrivalCostLine l JOIN dbo.Product p ON p.ProdKey=l.ProdKey
    WHERE l.IsCurrent=1 AND l.ProdKey IS NOT NULL AND ISNULL(p.isDeleted,0)=0 AND l.CountryName=@country AND p.CounName=@country
      AND NULLIF(LTRIM(RTRIM(l.ProductNameRaw)),'') IS NOT NULL
    GROUP BY l.ProductNameRaw, l.ProdKey`, { country: { type: type('NVarChar', 20), value: countryName } });
  const byName = {};
  for (const row of result.recordset || []) {
    const key = historyKey(row.raw);
    if (!key) continue;
    (byName[key] ||= []).push({ prodKey: Number(row.prodKey), count: Number(row.n), lastWeek: row.lastWeek });
  }
  return { country: String(country).toUpperCase(), names: Object.keys(byName).length, byName };
}
