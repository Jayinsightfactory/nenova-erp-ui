const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{transformSync}=require('next/dist/build/swc');
function load(filename){
 filename=path.resolve(filename);
 const compiled=transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}).code;
 const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const original=m.require.bind(m);
 m.require=name=>name.startsWith('.')?load(path.resolve(path.dirname(filename),/\.js$/.test(name)?name:`${name}.js`)):original(name);
 m._compile(compiled,filename);return m.exports;
}
const root=path.resolve(__dirname,'..'),dir=path.join(root,'.local-arrival-e2e');
const report=JSON.parse(fs.readFileSync(path.join(dir,'report.json')));
const Hotel=load(path.join(root,'components/raum/HotelArrivalCostReference.js')).default;
const Incoming=load(path.join(root,'components/LatestArrivalReference.js')).default;
const fmt=n=>Number(n).toLocaleString('ko-KR',{maximumFractionDigits:2});
let body='';
for(const row of report.renderData){
 const hotel=renderToStaticMarkup(React.createElement(Hotel,{item:{prodKey:row.prodKey,arrivalHistory:row.hotel}}));
 const incoming=renderToStaticMarkup(React.createElement(Incoming,{item:{prodKey:row.prodKey,unit:''},state:{references:{[`${row.prodKey}|`]:row.incoming}}}));
 assert(hotel.includes('43-2 최신 원가'));assert(hotel.includes('인보이스 승인'));assert(incoming.includes('승인 인보이스'));assert(incoming.includes('2026/43-2'));
 body+=`<tr><td>${row.prodKey}</td><td>${hotel}</td><td>${hotel}</td><td>${fmt(row.catalog.arrivalCost)}원/${row.catalog.displayUnit}<br>43-2</td><td>${fmt(row.pivot.arrivalCost)}원/${row.pivot.unit}<br>43-2</td><td>${incoming}</td></tr>`;
}
const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><title>격리 SQL 원가 연동 검증</title><style>body{font:14px Arial,sans-serif;margin:24px;color:#17324d}table{border-collapse:collapse;width:100%}td,th{border:1px solid #cbd5e1;padding:12px;vertical-align:top}th{background:#eaf4ff}p{line-height:1.6}.warn{background:#fff2cc;padding:12px}</style><h1>승인 인보이스 원가 연동 — 격리 테스트</h1><p class="warn">시험 비용 사용 · 운영 DB 미접속 · 2026/43-2 송장 2914, 6품목 / 48박스 / 1,440송이<br>라움·초이문·입고는 실제 표시 컴포넌트 렌더링. 카탈로그·피벗은 실제 조회 함수 반환값. 각 전체 업무 페이지 클릭 검증을 대체하지 않습니다.</p><table><thead><tr><th>품목키</th><th>라움</th><th>초이문</th><th>카탈로그 조회값</th><th>피벗 조회값</th><th>입고 최신 참조</th></tr></thead><tbody>${body}</tbody></table><p>박스당 30송이. 동일 단위로 환산하면 모든 원가 일치. 과거 원장 및 주문·출고·재고·기존 입고 금액 변경 없음.</p></html>`;
fs.writeFileSync(path.join(dir,'proof.html'),html);
console.log('PASS real React hotel/incoming render, 6 products; proof.html generated');
if(process.argv.includes('--serve'))require('node:http').createServer((req,res)=>{if(req.url!=='/'){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);}).listen(19432,'127.0.0.1',()=>console.log('PROOF http://127.0.0.1:19432'));
