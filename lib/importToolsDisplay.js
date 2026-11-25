// Presentation only: never rename workbook fields, country IDs or shared record keys.
const countries={Colombia:'콜롬비아',Netherlands:'네덜란드',Ecuador:'에콰도르',Australia:'호주',Thailand:'태국',China:'중국',Vietnam:'베트남',NewZealand:'뉴질랜드',Japan:'일본',USA:'미국',Israel:'이스라엘',Ethiopia:'에티오피아'};
const countryCodesByCaseFold = Object.fromEntries(Object.keys(countries).map(code => [code.toLowerCase(),code]));
const units={bunches:'단',stems:'송이',boxes:'박스',cajas:'박스'};
export const importCountryLabel=value=>countries[value]||value;
export function canonicalImportCountry(value) {
 const label = String(value ?? '').normalize('NFKC').trim().toLowerCase();
 return countries[countryCodesByCaseFold[label]] || label;
}
export const importUnitLabel=value=>units[value]||value;
export function importColumnLabel(value){
 const labels={Variedad:'품목',Name:'품목',Bunches:'수량(단)',Boxes:'박스',Tallos:'수량(송이)',Stems:'수량(송이)',Cajas:'박스','Pedido inicial':'최초 주문','Pedido final':'최종 주문',Cambios:'변경량',Total:'합계','Cajas Total':'총 박스'};
 if(labels[value])return labels[value];
 const total=String(value).match(/^Total \((bunches|stems|boxes)\)$/);
 return total?`합계(${importUnitLabel(total[1])})`:value;
}
