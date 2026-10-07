const assert = require('node:assert/strict');
const fs = require('node:fs');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const suffix = process.platform === 'win32' ? '-msvc' : process.platform === 'linux' ? '-gnu' : '';
const {transformSync} = require(`@next/swc-${process.platform}-${process.arch}${suffix}`);
const source = fs.readFileSync('pages/shipment/distribute-import.js','utf8');
const start = source.indexOf('function UnmatchedMatchingModal(');
const end = source.indexOf('\nfunction ',start+10);
const component = source.slice(start,end < 0 ? source.indexOf('\nconst st =',start) : end);
const code = transformSync(component+'\nmodule.exports=UnmatchedMatchingModal;',false,
 Buffer.from(JSON.stringify({jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}))).code;
const mod={exports:{}};
const ignore='__IGNORE_CUSTOMER__';
let picks=[];
function search(props){return React.createElement('select',{value:props.value,onChange:props.onChange},React.createElement('option',{value:''},props.placeholder));}
new Function('require','module','exports','useRef','useEffect','isImportIgnoreCustomerValue','IMPORT_IGNORE_CUSTOMER_VALUE','CustomerSearchSelect','ProductSearchSelect','MatchKindBadge','st',code)
 (require,mod,mod.exports,() => ({current:null}),() => {},value=>value===ignore,ignore,search,search,()=>null,{});
const Modal=mod.exports;
const props={open:true,matchTab:'customer',onTabChange:()=>{},customerItems:[{label:'주광 선출고',count:3}],productItems:[],customerOptions:[],productOptions:[],custOverrides:{},prodOverrides:{},onPickCustomer:(...args)=>picks.push(args),onPickProduct:()=>{},onReverify:()=>{},onClose:()=>{},loading:false,custPending:1,prodPending:0};
const render=overrides=>renderToStaticMarkup(React.createElement(Modal,{...props,custOverrides:overrides}));
assert.match(render({}),/분배 안 함/);
assert.match(render({}),/이전 차수에 반영/);
assert.match(render({}),/다른 업체열은 유지/);
assert.match(render({'주광 선출고':ignore}),/제외됨\(이번 차수 분배 안 함\)/);
assert.match(render({'주광 선출고':ignore}),/제외 취소 · 업체 연결/);
assert.match(source,/분배 제외 수량행/);
assert.match(source,/변경 선택\(재검증 필요\)/);
assert.ok(source.indexOf('verifiedOverridesRef.current = submittedOverrides') > source.indexOf("if (!data.success) throw"));
assert.match(source,/event.key === 'Escape'/);
console.log('Customer upload choice UI fixture passed');

function buttons(node) {
 if (!node || typeof node!=='object') return [];
 const children=React.Children.toArray(node.props?.children);
 return [...(node.type==='button'?[node]:[]),...children.flatMap(buttons)];
}
buttons(Modal(props)).find(node=>node.props.children==='분배 안 함').props.onClick();
assert.deepEqual(picks.pop(),['주광 선출고',ignore]);
buttons(Modal({...props,custOverrides:{'주광 선출고':ignore}})).find(node=>node.props.children==='제외 취소 · 업체 연결').props.onClick();
assert.deepEqual(picks.pop(),['주광 선출고','']);
assert.equal(props.customerItems[0].label,'주광 선출고');
