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
const products=[{ProdKey:447,ProdName:'CARNATION Moon Light',FlowerName:'카네이션',CounName:'콜롬비아'},{ProdKey:2,ProdName:'Rose',FlowerName:'장미',CounName:'콜롬비아'},{ProdKey:3,ProdName:'Tulip NL',FlowerName:'튤립',CounName:'네덜란드'},{ProdKey:4,ProdName:'Rose CN',FlowerName:'장미',CounName:'중국'}];
for(const selection of [[], ['카네이션']]) {
  const states=[];
  let cursor=0;
  let source=fs.readFileSync('pages/master/products.js','utf8')
    .replace('useState([]);',`useState(${JSON.stringify(products)});`)
    .replace('useState(true);','useState(false);')
    .replace('const [selectedFlowers, setSelectedFlowers] = useState([]);',`const [selectedFlowers, setSelectedFlowers] = useState(${JSON.stringify(selection)});`)
    .replace('const [selectedCountry, setSelectedCountry] = useState(null);',`const [selectedCountry, setSelectedCountry] = useState('콜롬비아');`);
  const Page=load(source,name=>{
    if(name==='react')return {...React,useEffect:()=>{},useState:initial=>{
      const index=cursor++;
      if(!(index in states))states[index]=initial;
      return [states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;}];
    }};
    if(name.endsWith('/useApi'))return {apiGet:()=>{throw Error('No DB access')},apiPost:()=>{throw Error('No write')}};
    if(name.endsWith('/i18n'))return {useLang:()=>({t:s=>s})};
    if(name.endsWith('/displayName'))return {suggestDisplayName:s=>s,getDisplayName:p=>p.ProdName,filterProducts:p=>p};
    if(name.endsWith('/productSearchRanking'))return {rankProductSearchOptions:(_,p)=>p};
    if(name.endsWith('/exportUtils'))return {};
    if(name.endsWith('/ProductCatalogPhoto'))return {default:()=>null};
    if(name.endsWith('/ProductBulkEditor'))return {default:()=>null};
    if(name.endsWith('/ProductInputHistory'))return {default:()=>null};
    if(name.endsWith('/productCatalogFilter'))return policy;
    return require(name);
  }).default;
  const html=renderToStaticMarkup(React.createElement(Page));
  assert.match(html,/aria-label="품종 필터"/);
  assert.match(html,/CARNATION Moon Light 사진 관리/);
  assert.equal(html.includes('Rose 사진 관리'),selection.length===0);
  assert.match(html,/aria-pressed="true"/);
  assert.ok(html.includes('콜롬비아'));
  assert.ok(!html.includes('Rose CN 사진 관리'));
  assert.match(html,/콜롬비아 카네이션 품목 묶음/);
  function nodes(node) {
    if(!node || typeof node!=='object')return [];
    if(Array.isArray(node))return node.flatMap(nodes);
    return [node,...nodes(node.props?.children)];
  }
  function clickFlower(label, groupName='품종 필터') {
    cursor=0;
    const group=nodes(Page()).find(n=>n.props?.['aria-label']===groupName);
    const button=nodes(group).find(n=>n.type==='button' && (Array.isArray(n.props.children)?n.props.children[0]:n.props.children)===label);
    assert.ok(button,label);
    button.props.onClick();
    cursor=0;
    return renderToStaticMarkup(React.createElement(Page));
  }
  for(const label of ['카네이션','장미','장미']) {
    const result=clickFlower(label);
    assert.ok(result.includes(`콜롬비아 ${label} 품목 묶음`));
    assert.equal(result.includes('Rose 사진 관리'),label==='장미');
    assert.equal(result.includes('CARNATION Moon Light 사진 관리'),label==='카네이션');
    assert.equal((result.match(/aria-pressed="true"/g)||[]).length,2);
  }
  const all=clickFlower('전체 품종');
  assert.ok(all.includes('Rose 사진 관리')&&all.includes('CARNATION Moon Light 사진 관리'));
  const nl=clickFlower('네덜란드','국가 선택');
  assert.ok(nl.includes('Tulip NL 사진 관리')&&!nl.includes('Rose 사진 관리'));
  clickFlower('튤립');
  const cn=clickFlower('중국','국가 선택');
  assert.ok(cn.includes('Rose CN 사진 관리')&&!cn.includes('Tulip NL 사진 관리'));
  assert.ok(!cn.includes('튤립 ('));
  const every=clickFlower('전체 국가','국가 선택');
  for(const p of products) assert.ok(every.includes(`${p.ProdName} 사진 관리`));
  assert.ok(!every.includes('aria-label="품종 필터"'));
}
console.log('Product catalog actual-page SSR: filter controls, filtered rows and keyboard photo buttons passed');
