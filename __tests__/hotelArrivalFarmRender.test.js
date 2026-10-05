const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('next/dist/build/swc');
function load(relative) {
  const filename = path.resolve(__dirname, relative);
  const compiled = transformSync(fs.readFileSync(filename, 'utf8'), { filename,
    jsc: { parser: { syntax:'ecmascript',jsx:true }, target:'es2022', transform:{react:{runtime:'automatic'}} }, module:{type:'commonjs'} }).code;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = loaded.require.bind(loaded);
  loaded.require = name => name.startsWith('.') ? load(path.resolve(path.dirname(filename), /\.js$/.test(name) ? name : `${name}.js`)) : original(name);
  loaded._compile(compiled,filename);
  return loaded.exports;
}
const Component = load('../components/raum/HotelArrivalCostReference.js').default;
const item = {prodKey:2330,costPrice:8280,arrivalReferences:[
  {referenceKey:'arrival:1',week:'40-1',farm:'MELODY',cost:11450.7,unit:'단',rawCost:11450.7,rawUnit:'단',sourceSheet:'해상',sourceRow:42,isNextHotelWeek:true},
  {referenceKey:'arrival:2',week:'40-1',farm:'MELODY',cost:9796.8,unit:'단',rawCost:9796.8,rawUnit:'단',sourceSheet:'95%기준',sourceRow:46},
  {referenceKey:'arrival:3',week:'38-2',farm:'',cost:8641.4,unit:'단',rawCost:8641.4,rawUnit:'단',isFallback:true},
]};
const before=JSON.stringify(item);
const html=renderToStaticMarkup(React.createElement(Component,{item}));
for (const text of ['농장별 원가','3건','MELODY','11,450.7','9,796.8','8,641.4','농장 미기재','이전 최신','호텔 다음 1차','95%기준','46행']) assert.ok(html.includes(text),text);
assert.equal((html.match(/<b style="color:#0369a1">/g)||[]).length,3);
assert.equal(JSON.stringify(item),before);
console.log('Farm arrival reference real React render preserves all source prices and stored cost');
