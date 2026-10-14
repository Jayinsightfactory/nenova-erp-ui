const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const babel=require('next/dist/compiled/babel/core');
const source=fs.readFileSync(path.join(__dirname,'../components/import-tools/PackingProductMatchDialog.js'),'utf8');
const code=babel.transformSync(source,{filename:'PackingProductMatchDialog.js',presets:[require('next/dist/compiled/babel/preset-react')],plugins:[require('next/dist/compiled/babel/plugin-transform-modules-commonjs')],configFile:false,babelrc:false}).code;
test('saving modal traps Tab even with no enabled control and blocks Escape',()=>{
 const effects=[],React={createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:x=>[x,()=>{}],useRef:()=>({current:null}),useMemo:f=>f(),useEffect:f=>effects.push(f)};
 const modules={react:React,'../../lib/productSearchRanking.js':{scoreProductSearchOptions:()=>[]},'../../lib/importPackingErpMatches.js':{PACKING_COUNTRIES:{CN:'중국'}},'../../styles/PackingProductMatch.module.css':{}};
 const module={exports:{}};let closeCount=0,focused=0;
 new Function('require','module','exports','document',code)(key=>modules[key],module,module.exports,{activeElement:{}});
 const tree=module.exports.default({target:{description:'原文'},country:'CN',products:[],saving:true,onClose:()=>closeCount++});
 const section=tree.props.children[0];section.props.ref.current={querySelectorAll:()=>[],focus:()=>focused++};
 assert.equal(section.props.tabIndex,-1);assert.equal(section.props['aria-busy'],true);
 effects.forEach(f=>f());assert.equal(focused,1);
 for(const shiftKey of [false,true]){let prevented=false;tree.props.onKeyDown({key:'Tab',shiftKey,preventDefault(){prevented=true;}});assert(prevented);}
 tree.props.onKeyDown({key:'Escape',preventDefault(){}});assert.equal(closeCount,0);assert.equal(focused,3);
});

test('candidate click saves immediately; native button activation shares the same write path',async()=>{
 const {scoreProductSearchOptions}=await import('../lib/productSearchRanking.js');
 const state=[],calls=[];let cursor=0;
 const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:x=>{const i=cursor++;if(!(i in state))state[i]=x;return[state[i],v=>state[i]=v];},useRef:()=>({current:null}),useMemo:f=>f(),useEffect:()=>{}};
 const modules={react:React,'../../lib/productSearchRanking.js':{scoreProductSearchOptions:(q,p,o)=>{calls.push({q,p,o});return scoreProductSearchOptions(q,p,o);}},'../../lib/importPackingErpMatches.js':{PACKING_COUNTRIES:{CN:'중국'}},'../../styles/PackingProductMatch.module.css':{}};
 const module={exports:{}};
 new Function('require','module','exports','document',code)(key=>modules[key],module,module.exports,{activeElement:{}});
 const products=[{ProdKey:1,ProdName:'Known Manual Target',country:'CN',selectable:true},{ProdKey:2,ProdName:'Moon Light 60cm',country:'CO',selectable:true},{ProdKey:3,ProdName:'Other Target',country:'CN',selectable:true}];
 const props={target:{description:'Supplier Moon Ligth 60cm'},country:'CN',products,matchEntries:[{country:'CN',description:'Supplier Moon Light 60cm',prodKey:1,prodName:'Known Manual Target'},{country:'CN',description:'Supplier Moon Light 60cm',prodKey:3,prodName:'STALE'}],onSave:k=>calls.push(k),onClose:()=>{},onReload:async()=>{}};
 const render=()=>{cursor=0;return module.exports.default(props);};
 const flatten=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(flatten):[n,...n.props.children.flatMap(flatten)];
 let nodes=flatten(render());
 assert.equal(calls[0].q,props.target.description);assert.equal(calls[0].o.packingSuggestions,true);
 assert.deepEqual(calls[0].p.map(p=>p.ProdKey),[1,3]);assert.deepEqual(calls[0].p[1].MappingAliases,[]);
 const tree=render(),section=tree.props.children[0],input=flatten(tree).find(n=>n.type==='input');let focused=0;
 input.props.ref.current={};section.props.ref.current={querySelectorAll:()=>[{focus:()=>focused++}]};
 tree.props.onKeyDown({key:'ArrowDown',target:input.props.ref.current,preventDefault(){}});assert.equal(focused,1);
 tree.props.onKeyDown({key:'ArrowDown',isComposing:true,target:input.props.ref.current,preventDefault(){throw Error('IME must be preserved');}});assert.equal(focused,1);
 const candidates=nodes.filter(n=>n.props['data-candidate']);assert.deepEqual(candidates.map(n=>n.props['data-candidate']),[1]);assert.equal(candidates[0].props['aria-pressed'],false);
 await candidates[0].props.onClick();assert.equal(calls.at(-1),1,'one candidate click writes without a second save button');
 assert.doesNotMatch(source,/packing-match-save|선택 품목 매칭 · 저장/,'the redundant save control is removed');
 // A 409 requires a fresh read even when the selected product is still valid.
 props.target={...props.target,requiresReload:true};nodes=flatten(render());
 assert.equal(nodes.find(n=>n.props['data-candidate']===1).props.disabled,true);
 assert.ok(nodes.some(n=>n.props.role==='alert'&&n.props.children.includes('전산·매칭 다시 조회 후 선택 재확인')));
 const savedCount=calls.filter(x=>x===1).length;await nodes.find(n=>n.props['data-candidate']===1).props.onClick();assert.equal(calls.filter(x=>x===1).length,savedCount,'stale CAS state never writes');
 // A successful refresh clears the internal selection; it does not confirm a recommendation.
 await nodes.find(n=>n.type==='button'&&n.props.children.includes('전산·매칭 다시 조회')).props.onClick();
 props.target={...props.target,requiresReload:false};nodes=flatten(render());
 await nodes.find(n=>n.props['data-candidate']===1).props.onClick();nodes=flatten(render());
 nodes.find(n=>n.type==='input').props.onChange({target:{value:'unrelatedzzzz'}});nodes=flatten(render());assert.equal(calls.at(-1).q,'unrelatedzzzz');assert.equal(nodes.filter(n=>n.props['data-candidate']).length,0);
 // Refresh invalidates an old selection; a stale key cannot be saved.
 props.products=products.filter(p=>p.ProdKey!==1);nodes=flatten(render());
 assert.ok(nodes.some(n=>n.props.role==='alert'&&n.props.children.some(x=>typeof x==='string'&&x.includes('선택한 품목이 최신 목록에서'))));
 for(const invalid of [{...products[0],selectable:false},{...products[0],country:'CO'}]) {
   props.products=[invalid,...products.slice(1)];nodes=flatten(render());
   const blocked=nodes.find(n=>n.props['data-candidate']===1);
   if(blocked) { assert.equal(blocked.props.disabled,true);await blocked.props.onClick(); }
   assert.ok(nodes.some(n=>n.props.role==='alert'&&n.props.children.some(x=>typeof x==='string'&&x.includes('유효한 품목을 다시 선택'))));
 }
});

test('failed save stays open, rapid activations save once, and retry is allowed',async()=>{
 const hooks=[];let cursor=0;
 const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:x=>{const i=cursor++;if(!(i in hooks))hooks[i]=x;return[hooks[i],v=>hooks[i]=v];},useRef:x=>{const i=cursor++;if(!(i in hooks))hooks[i]={current:x};return hooks[i];},useMemo:f=>f(),useEffect:()=>{}};
 const module={exports:{}};
 new Function('require','module','exports','document',code)(key=>({react:React,'../../lib/productSearchRanking.js':{scoreProductSearchOptions:(_,items)=>items.map(option=>({option}))},'../../lib/importPackingErpMatches.js':{PACKING_COUNTRIES:{CN:'중국'}},'../../styles/PackingProductMatch.module.css':{}})[key],module,module.exports,{activeElement:{}});
 let resolveSave, writes=0, closes=0;
 const props={target:{description:'원문'},country:'CN',products:[{ProdKey:7,ProdName:'Retry Product',country:'CN',selectable:true}],onClose:()=>closes++,onReload:async()=>{},onSave:()=>{writes++;return new Promise(resolve=>{resolveSave=resolve;});}};
 const flatten=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(flatten):[n,...n.props.children.flatMap(flatten)];
 const candidate=()=>{cursor=0;return flatten(module.exports.default(props)).find(n=>n.props['data-candidate']===7);};
 const first=candidate();const pending=first.props.onClick();await candidate().props.onClick();assert.equal(writes,1,'rapid click/native Enter or Space click events share an immediate ref lock');
 resolveSave();await pending;props.error='저장 실패';
 assert.equal(candidate().type,'button','a native button gives Enter and Space the same click-to-save behavior');
 assert.equal(closes,0,'a parent-reported failure leaves the dialog mounted for retry');
 candidate().props.onClick();assert.equal(writes,2,'the selected candidate can be retried after the failed request settles');
});
