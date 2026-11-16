const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {orderListModel,orderListPage,orderListCsv}=require('../lib/orderListPage.js');
const makeOrder=(id,count,offset=0)=>({id,date:'2026-11-15',week:id==='a'?'46-01':'46-02',custName:id,custArea:'연습',manager:'담당',orderCode:id,items:Array.from({length:count},(_,i)=>({prodName:`품목 ${offset+i+1}`,unit:'단',boxQty:1,bunchQty:2,steamQty:3,counName:'연습국가',flowerName:'장미'}))});
const orders=[makeOrder('a',120),makeOrder('b',81,120)];

test('overall totals retain original item accumulation order for decimals and legacy string quantities',()=>{
 const groups=[makeOrder('a',2),makeOrder('b',2)];
 const numbers=[1e16,1,-1e16,1],strings=['1','2','3','4'];
 groups.flatMap(o=>o.items).forEach((item,i)=>{item.boxQty=numbers[i];item.bunchQty=strings[i];item.steamQty=[.1,.2,.3,.4][i];});
 const before={totalBox:0,totalBunch:0,totalSteam:0};
 for(const order of groups)for(const item of order.items){before.totalBox+=item.boxQty||0;before.totalBunch+=item.bunchQty||0;before.totalSteam+=item.steamQty||0;}
 const after=orderListModel(groups);
 for(const key of Object.keys(before))assert.equal(after[key],before[key]);
 assert.equal(after.totalBox,1);assert.equal(after.totalBunch,'01234');
});

test('100-item boundaries preserve every group/item identity, sequence, full group subtotals and total',()=>{
 const model=orderListModel(orders),pages=[0,1,2].map(p=>orderListPage(model,p));
 assert.deepEqual(pages.map(p=>[p.start,p.end,p.groups.reduce((n,g)=>n+g.items.length,0)]),[[1,100,100],[101,200,100],[201,201,1]]);
 assert.deepEqual(pages.flatMap(p=>p.groups.flatMap(g=>g.items)),orders.flatMap(o=>o.items));
 assert.equal(pages[1].groups[0].order,orders[0]);assert.equal(pages[1].groups[0].itemStart,100);
 assert.deepEqual(pages[1].groups.map(g=>g.subtotal),[{box:120,bunch:240,steam:360},{box:81,bunch:162,steam:243}]);
 assert.deepEqual([model.totalCount,model.totalBox,model.totalBunch,model.totalSteam],[201,201,402,603]);
 for(const count of [0,1,99,100,101,200]){const m=orderListModel([makeOrder('x',count)]),p=orderListPage(m,999);assert.equal(p.pageCount,Math.max(1,Math.ceil(count/100)));assert(p.groups.flatMap(g=>g.items).length<=100);assert.equal(p.end,count);}
});

test('CSV remains byte-for-byte the original full filtered export, independent of page',()=>{
 const rows=[['주문일자','차수','거래처','지역','담당자','국가','꽃','품목명(색상)','단위','박스수량','단수량','송이수량','클라이언트코드']];
 orders.forEach(o=>o.items.forEach(i=>rows.push([o.date,o.week,o.custName,o.custArea,o.manager,i.counName,i.flowerName,i.prodName,i.unit,i.boxQty||0,i.bunchQty||0,i.steamQty||0,o.orderCode])));
 const before=rows.map(r=>r.map(v=>`"${v||''}"`).join(',')).join('\n');
 assert.equal(orderListCsv(orders),before);assert.equal(before.split('\n').length,202);assert(before.includes('품목 201'));
});

function mountResults(){
 const react=require('react'),states=[];let cursor=0;
 const fakeReact={...react,memo:component=>component,useMemo:fn=>fn(),useState:init=>{const slot=cursor++;if(!(slot in states))states[slot]=typeof init==='function'?init():init;return[states[slot],next=>{states[slot]=typeof next==='function'?next(states[slot]):next;}];}};
 const source=fs.readFileSync(path.join(__dirname,'../pages/orders/index.js'),'utf8');
 const {code}=require(`@next/swc-${process.platform}-${process.arch}${process.platform==='win32'?'-msvc':process.platform==='linux'?'-gnu':''}`).transformSync(source,false,Buffer.from(JSON.stringify({jsc:{target:'es2020',parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}})));
 const mod={exports:{}};new Function('require','module','exports',code+'\nexports.OrderResults=OrderResults;')(id=>id==='react'?fakeReact:id==='react/jsx-runtime'?require(id):id.includes('orderListPage')?{orderListModel,orderListPage,orderListCsv}:id.includes('i18n')?{useLang:()=>({t:x=>x})}:{},mod,mod.exports);
 return props=>{cursor=0;return mod.exports.OrderResults(props);};
}
function nodes(node){if(Array.isArray(node))return node.flatMap(nodes);if(!node||typeof node!=='object')return[];return[node,...nodes(node.props?.children)];}
const itemRows=tree=>nodes(tree).filter(n=>n.props?.['data-order-item']);
const button=(tree,text)=>nodes(tree).find(n=>n.type==='button'&&n.props.children===text);

test('actual result component renders only 100 items, preserves selection and numbering across pages, resets on filter/requery',()=>{
 const render=mountResults(),props={filteredOrders:orders,loading:false,showDate:true,resetKey:1};let tree=render(props);
 assert.equal(itemRows(tree).length,100);itemRows(tree)[99].props.onClick();tree=render(props);assert.equal(itemRows(tree)[99].props['aria-selected'],true);
 button(tree,'다음 100건').props.onClick();tree=render(props);assert.equal(itemRows(tree).length,100);assert.equal(itemRows(tree)[0].key,'item-a-100');assert(itemRows(tree).every(r=>!r.props['aria-selected']));
 const html=require('react-dom/server').renderToStaticMarkup(tree);assert(html.includes('101–200'));assert(html.includes('120'));assert(html.includes('603'));
 button(tree,'이전 100건').props.onClick();tree=render(props);assert.equal(itemRows(tree)[99].props['aria-selected'],true);
 button(tree,'다음 100건').props.onClick();tree=render({...props,filteredOrders:[{...orders[0],items:[orders[0].items[119]]}]});assert.equal(itemRows(tree)[0].props['aria-selected'],false);assert(button(tree,'이전 100건').props.disabled);
 tree=render({...props,resetKey:2});assert(button(tree,'이전 100건').props.disabled);assert.equal(itemRows(tree)[0].key,'item-a-0');
});

test('actual item rows support keyboard selection and arrow/Home/End focus',()=>{
 const render=mountResults(),props={filteredOrders:orders,loading:false,showDate:false,resetKey:0};let tree=render(props),rows=itemRows(tree),focused=-1;
 const dom=rows.map((_,i)=>({focus:()=>{focused=i;},closest:()=>({querySelectorAll:()=>dom})}));
 rows[0].props.onKeyDown({key:'ArrowDown',currentTarget:dom[0],preventDefault(){}});assert.equal(focused,1);
 rows[0].props.onKeyDown({key:'End',currentTarget:dom[0],preventDefault(){}});assert.equal(focused,99);
 rows[2].props.onKeyDown({key:'Enter',preventDefault(){}});tree=render(props);assert.equal(itemRows(tree)[2].props['aria-selected'],true);
});
