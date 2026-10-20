const fs=require('node:fs');
const path=require('node:path');
const c=require('../lib/ecountWorkbench.cjs');
const lines=['# ECOUNT 탭별 전체 메뉴 목록','','2026-10-20 로그인된 계정의 사이트맵 기준. 8개 탭, 537개 메뉴 경로, 423개 말단 메뉴.','','모든 메뉴는 /ecount/workbench에서 조회하며, 화면·저장 계획은 기능군별 개발 초안이다. 원본 기능 동등성은 검증 전이다. 외부 API 기능도 포함하고 실제 연동만 실행하지 않는다.'];
for(const tab of c.TABS){
  lines.push('','## '+tab.label,'','| 경로 | 프로그램 | 구분 | 화면 유형 | 외부 연결 |','|---|---|---|---|---|');
  for(const m of c.MENUS.filter(m=>m.tab===tab.id&&m.depth>1)){const f=c.getFeature(m.id);lines.push('| '+[m.path.slice(1).join(' > '),m.program,f.mode==='folder'?'분류':f.mode==='report'?'조회 초안':'입력 초안',f.schema.label,f.external?.label||'없음'].map(x=>x.replace(/\|/g,'/')).join(' | ')+' |');}
}
const output=lines.join('\n')+'\n';
const target=path.join(__dirname,'../docs/ecount-migration/menu-inventory.md');
if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==output)throw Error('Menu inventory needs regeneration');}
else fs.writeFileSync(target,output);
console.log('ECOUNT inventory: 537 menu paths');
