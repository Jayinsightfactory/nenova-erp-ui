const assert = require('node:assert/strict');
const fs = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const suffix = process.platform === 'win32' ? '-msvc' : process.platform === 'linux' ? '-gnu' : '';
const { transformSync } = require(`@next/swc-${process.platform}-${process.arch}${suffix}`);
function load(source, localRequire = require) {
  const mod = {exports:{}};
  const {code} = transformSync(source, false, Buffer.from(JSON.stringify({jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}})));
  new Function('require','module','exports',code)(localRequire,mod,mod.exports);
  return mod.exports;
}
const policy=load(fs.readFileSync('lib/productCatalogFilter.js','utf8'));
const products=[{ProdKey:447,ProdName:'CARNATION Moon Light',FlowerName:'카네이션'},{ProdKey:2,ProdName:'Rose',FlowerName:'장미'}];
for(const selection of [[], ['카네이션']]) {
  let source=fs.readFileSync('pages/master/products.js','utf8')
    .replace('useState([]);',`useState(${JSON.stringify(products)});`)
    .replace('useState(true);','useState(false);')
    .replace('const [selectedFlowers, setSelectedFlowers] = useState([]);',`const [selectedFlowers, setSelectedFlowers] = useState(${JSON.stringify(selection)});`);
  const Page=load(source,name=>{
    if(name.endsWith('/useApi'))return {apiGet:()=>{throw Error('No DB access')},apiPost:()=>{throw Error('No write')}};
    if(name.endsWith('/i18n'))return {useLang:()=>({t:s=>s})};
    if(name.endsWith('/displayName'))return {suggestDisplayName:s=>s,getDisplayName:p=>p.ProdName,filterProducts:p=>p};
    if(name.endsWith('/productSearchRanking'))return {rankProductSearchOptions:(_,p)=>p};
    if(name.endsWith('/exportUtils'))return {};
    if(name.endsWith('/ProductCatalogPhoto'))return {default:()=>null};
    if(name.endsWith('/productCatalogFilter'))return policy;
    return require(name);
  }).default;
  const html=renderToStaticMarkup(React.createElement(Page));
  assert.match(html,/aria-label="품종 필터"/);
  assert.match(html,/CARNATION Moon Light 사진 관리/);
  assert.equal(html.includes('Rose 사진 관리'),selection.length===0);
  assert.match(html,/aria-pressed="true"/);
}
console.log('Product catalog actual-page SSR: filter controls, filtered rows and keyboard photo buttons passed');
