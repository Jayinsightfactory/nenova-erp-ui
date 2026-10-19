const assert=require('node:assert/strict'),fs=require('node:fs'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const suffix=process.platform==='win32'?'-msvc':'-gnu';
const {transformSync}=require(`@next/swc-${process.platform}-${process.arch}${suffix}`);
function load(file,req=require){const m={exports:{}};const {code}=transformSync(fs.readFileSync(file,'utf8'),false,Buffer.from(JSON.stringify({jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}})));new Function('require','module','exports',code)(req,m,m.exports);return m.exports;}
const policy=load('lib/productBulkEdit.js');
let states=[],cursor=0,refs=[],refCursor=0;
const Component=load('components/catalog/ProductBulkEditor.js',name=>{
  if(name==='react')return {...React,useEffect:()=>{},useRef:initial=>{const i=refCursor++;return refs[i]??(refs[i]={current:initial});},useState:initial=>{const index=cursor++;if(!(index in states))states[index]=initial;return[states[index],v=>states[index]=typeof v==='function'?v(states[index]):v];}};
  if(name==='next/router')return {useRouter:()=>({})};
  if(name.endsWith('/productBulkEdit'))return policy;
  if(name.endsWith('.css'))return {default:{}};
  return require(name);
}).default;
const products=[1,2,3].map(ProdKey=>({ProdKey,ProdName:`품목${ProdKey}`,CounName:'네덜란드',FlowerName:'튤립',BunchOf1Box:10,SteamOf1Bunch:5,SteamOf1Box:50,BoxWeight:null,BoxCBM:null,TariffRate:null}));
let saved=null;const props={rows:products.slice(1),products,onSaved:r=>saved=r,onClose:()=>{}};
function tree(){cursor=0;refCursor=0;return Component(props);}
function nodes(n){if(!n||typeof n!=='object')return [];if(Array.isArray(n))return n.flatMap(nodes);return[n,...nodes(n.props?.children)];}
function find(predicate){const node=nodes(tree()).find(predicate);assert.ok(node);return node;}
function button(label){return find(n=>n.type==='button'&&n.props.children===label);}
function cell(value){return find(n=>n.props?.['data-cell']===value);}
cell('0-2').props.onPointerDown({button:0,preventDefault(){},currentTarget:{focus(){}},shiftKey:false});
find(n=>n.type==='td'&&nodes(n).some(c=>c.props?.['data-cell']==='1-2')).props.onPointerEnter({buttons:1});
find(n=>n.props?.['aria-label']==='박스무게 일괄 입력').props.onChange({target:{value:'0.125'}});
button('선택 영역에 입력').props.onClick();
assert.equal(states[0][2].BoxWeight,'0.125');assert.equal(states[0][3].BoxWeight,'0.125');assert.equal(states[0][1],undefined);
find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children[0]==='변경 확인 · ').props.onClick();
assert.equal(states[6],true);
const html=renderToStaticMarkup(tree());assert.match(html,/빈칸 → 0.125/);assert.match(html,/확인한 변경값 저장/);
const oldFetch=global.fetch;
global.fetch=async(url,options)=>{assert.equal(url,'/api/master/products-bulk');const {changes}=JSON.parse(options.body);assert.deepEqual(changes.map(c=>c.prodKey),[2,3]);return {ok:true,json:async()=>({success:true,verifiedCount:2,saved:changes.map(c=>({...c,after:policy.productAfterValues(c.expected,c.values)}))})};};
(async()=>{try{await button('확인한 변경값 저장').props.onClick();assert.equal(saved.length,2);assert.deepEqual(states[0],{});assert.match(renderToStaticMarkup(tree()),/저장 및 대조 완료/);}finally{global.fetch=oldFetch;}
const source=fs.readFileSync('pages/import/tools.js','utf8');assert.match(source,/\['history'.*\['products','품목관리'/);assert.match(source,/productsVisited&&<Products embedded/);
console.log('productBulkUi: filtered drag, input, preview, explicit save and readback UI passed');})().catch(e=>{console.error(e);process.exitCode=1;});
