const assert=require('node:assert/strict'),fs=require('node:fs'),React=require('react');
const suffix=process.platform==='win32'?'-msvc':'-gnu';
const {transformSync}=require(`@next/swc-${process.platform}-${process.arch}${suffix}`);
function load(file,req=require){const m={exports:{}};const {code}=transformSync(fs.readFileSync(file,'utf8'),false,Buffer.from(JSON.stringify({jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}})));new Function('require','module','exports',code)(req,m,m.exports);return m.exports;}
const policy=load('lib/productMasterPolicy.js'),filter=load('lib/productCatalogFilter.js');
let states=[],cursor=0,captured;
const Page=load('pages/master/products.js',name=>{
 if(name==='react')return {...React,useEffect:()=>{},useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];}};
 if(name.endsWith('/useApi'))return {apiPost:async(url,body)=>{captured=body;},apiGet:async()=>({data:[]})};
 if(name.endsWith('/i18n'))return {useLang:()=>({t:s=>s})};
 if(name.endsWith('/displayName'))return {suggestDisplayName:()=>'',getDisplayName:p=>p.ProdName,filterProducts:p=>p};
 if(name.endsWith('/productSearchRanking'))return {rankProductSearchOptions:(_,p)=>p};
 if(name.endsWith('/exportUtils'))return {};
 if(name.endsWith('/productMasterPolicy'))return policy;
 if(name.endsWith('/productCatalogFilter'))return filter;
 if(/ProductCatalogPhoto|ProductBulkEditor|ProductInputHistory/.test(name))return {default:()=>null};
 return require(name);
}).default;
function nodes(n){if(!n||typeof n!=='object')return[];if(Array.isArray(n))return n.flatMap(nodes);return[n,...nodes(n.props?.children)];}
function tree(){cursor=0;return Page();}
function find(fn){const n=nodes(tree()).find(fn);assert.ok(n);return n;}
tree();
states[1]=false;
states[0]=[{ProdKey:1,ProdName:'original',CounName:'중국',FlowerName:'장미',CountryFlower:'중국',Cost:10,OutUnit:'박스',EstUnit:'단',BunchOf1Box:15,SteamOf1Bunch:20,SteamOf1Box:0,BoxWeight:2,BoxCBM:0.1,TariffRate:0.08}];
find(n=>n.type==='tr'&&n.props.onDoubleClick).props.onDoubleClick();
find(n=>n.type==='input'&&n.props.value==='original').props.onChange({target:{value:'changed'}});
assert.ok(find(n=>n.type==='input'&&n.props.value==='changed'));
assert.equal(find(n=>n.props?.['aria-label']==='1박스 당 송이수').props.value,0);
const save=find(n=>n.type==='button'&&String(n.props.children).includes('저장')&&n.props.disabled===false);
(async()=>{await save.props.onClick();assert.deepEqual(captured.values,{ProdName:'changed'});assert.equal(captured.expected.ProdName,'original');assert.equal(captured.expected.SteamOf1Box,0);console.log('Product modal real handlers: visible edited name matches saved patch; unchanged independent box stems preserved PASS');})().catch(e=>{console.error(e);process.exitCode=1;});
