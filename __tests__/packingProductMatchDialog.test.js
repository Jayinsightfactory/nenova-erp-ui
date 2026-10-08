const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const babel=require('next/dist/compiled/babel/core');
const source=fs.readFileSync(path.join(__dirname,'../components/import-tools/PackingProductMatchDialog.js'),'utf8');
const code=babel.transformSync(source,{filename:'PackingProductMatchDialog.js',presets:[require('next/dist/compiled/babel/preset-react')],plugins:[require('next/dist/compiled/babel/plugin-transform-modules-commonjs')],configFile:false,babelrc:false}).code;
test('saving modal traps Tab even with no enabled control and blocks Escape',()=>{
 const effects=[],React={createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:x=>[x,()=>{}],useRef:()=>({current:null}),useMemo:f=>f(),useEffect:f=>effects.push(f)};
 const modules={react:React,'../../lib/productSearchRanking.js':{rankProductSearchOptions:()=>[]},'../../lib/importPackingErpMatches.js':{PACKING_COUNTRIES:{CN:'중국'}},'../../styles/PackingProductMatch.module.css':{}};
 const module={exports:{}};let closeCount=0,focused=0;
 new Function('require','module','exports','document',code)(key=>modules[key],module,module.exports,{activeElement:{}});
 const tree=module.exports.default({target:{description:'原文'},country:'CN',products:[],saving:true,onClose:()=>closeCount++});
 const section=tree.props.children[0];section.props.ref.current={querySelectorAll:()=>[],focus:()=>focused++};
 assert.equal(section.props.tabIndex,-1);assert.equal(section.props['aria-busy'],true);
 effects.forEach(f=>f());assert.equal(focused,1);
 for(const shiftKey of [false,true]){let prevented=false;tree.props.onKeyDown({key:'Tab',shiftKey,preventDefault(){prevented=true;}});assert(prevented);}
 tree.props.onKeyDown({key:'Escape',preventDefault(){}});assert.equal(closeCount,0);assert.equal(focused,3);
});
