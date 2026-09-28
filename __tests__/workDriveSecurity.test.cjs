const assert = require('node:assert/strict'), fs = require('fs'), path = require('path'), Module = require('module');
const filename = path.resolve(__dirname,'../lib/workDriveSecurity.js');
const m = new Module(filename,module); m.filename=filename;
m._compile(fs.readFileSync(filename,'utf8').replace(/export function /g,'function ')+'\nmodule.exports={isKakaoInbound,securityEvent,securityRows,securityCounts};',filename);
const {isKakaoInbound,securityEvent,securityRows,securityCounts}=m.exports;
const incoming = [
  {kind:'copy',destKind:'kakao-in'},
  {kind:'copy',destKind:'kakao',dest:'C:\\Users\\USER\\Documents\\카카오톡 받은 파일\\a.xlsx'},
  {kind:'copy',destKind:'kakao',dest:'C:/Users/USER/KakaoTalk Downloads/a.xlsx'},
];
const outgoing = [
  {kind:'copy',destKind:'usb',path:'C:\\카카오톡 받은 파일\\a.xlsx',dest:'E:\\a.xlsx'},
  {kind:'copy',destKind:'usb',dest:'E:\\카카오톡 받은 파일\\a.xlsx'},
  {kind:'kakao',destKind:'kakao',dest:'업무방'},
  {kind:'copy',destKind:'kakao',dest:'C:\\보낸 파일\\a.xlsx'},
  {kind:'copy',destKind:'kakao',dest:'C:\\받은 파일 아님\\a.xlsx'},
  {kind:'email',destKind:'kakao-in'},
  {kind:'copy'},
];
incoming.forEach(r=>{assert(isKakaoInbound(r));assert.equal(securityEvent(r).group,'reference');assert.equal(securityEvent(r).note,'수신 저장 · 유출 아님');});
outgoing.forEach(r=>{assert(!isKakaoInbound(r));assert.equal(securityEvent(r).group,'review');});
const rows=Object.freeze([...incoming,...outgoing,{kind:'download'},{kind:'upload'}].map(Object.freeze));
const before=JSON.stringify(rows);
assert.equal(securityRows(rows).length,outgoing.length);
assert.equal(securityRows(rows,'reference','inbound').length,incoming.length);
assert.equal(securityRows(rows,'all','copy').length,5);
assert.equal(securityRows(rows,'all').length,rows.length);
const counts=securityCounts(rows);assert.equal(counts.all,counts.review+counts.reference);assert.equal(counts.inbound,incoming.length);
assert.equal(JSON.stringify(rows),before);
console.log('work-drive security: inbound/outbound separation, legacy paths, USB copy of received file, preserved records and counts passed');
