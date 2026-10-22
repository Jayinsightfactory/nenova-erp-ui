'use strict';
// Merge scripts/ecount-verify-values.mjs output into data/ecount-workbench/button-matches.json.
// 조회 버튼(Search(F3)/검색(F8))만 대상: 조회값 대조 결과를 queryValues 에, 동작(function)은 '조회 결과가 원천과 같은 자료로 렌더됨'으로,
// 새창(window)은 원본·대상 모두 같은 화면 안에서 결과를 그리는 버튼(새창 없음)일 때만 일치로 둔다.
// 기간 프리셋·인쇄·Excel 등 다른 버튼은 이 대조로 판정하지 않는다(미검증 유지). 데이터 연결이 없는 조사 셸 화면은 queryValues 불일치(미구현)로 기록.
// Usage: node scripts/ecount-merge-value-evidence.cjs <value-parity.json> [--shell E040723,E060403,...]
const fs=require('fs');const path=require('path');
const root=path.join(__dirname,'..');
const args=process.argv.slice(2);const file=args[0];
const shell=(args.includes('--shell')?args[args.indexOf('--shell')+1]:'').split(',').filter(Boolean);
// --source-grid: 원본 화면 직접 읽기 요약(evidence/*-source-grid.json). 원본이 0건이면 셸 화면의 빈 표와 행수 0=0 은 일치로 기록한다(자료 연결은 여전히 미구현).
const gridFile=args.includes('--source-grid')?args[args.indexOf('--source-grid')+1]:null;
const grid=gridFile?JSON.parse(fs.readFileSync(gridFile,'utf8')):null;const gridRel=gridFile?path.relative(root,path.resolve(gridFile)).split(path.sep).join('/'):null;
const parity=JSON.parse(fs.readFileSync(file,'utf8'));const rel=path.relative(root,path.resolve(file)).replace(/\\/g,'/');
const reportPath=path.join(root,'data/ecount-workbench/button-matches.json');
const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
const QUERY=/^(Search\(F3\)|검색\(F8\))$/;
const summary={};
const st=(o,status,ev)=>{o.status=status;if(ev&&!o.evidence.includes(ev))o.evidence.push(ev);};
for(const page of report.pages){
  const r=parity.results.find(x=>x.program===page.program);const isShell=shell.includes(page.program);
  if(!r&&!isShell)continue;
  const s=summary[page.program]={title:page.title,buttons:page.buttons.length,queryButtons:0,verdict:isShell?'불일치':r.verdict,cause:isShell?'미구현(대상 화면에 자료 연결 없음: 조사 셸)':r.cause,verified:0};
  for(const b of page.buttons){
    if(!QUERY.test(String(b.source.label).trim()))continue;
    const d=b.target.domState;if(!d?.present)continue;
    s.queryButtons++;const ev=`${rel}#${page.program}`;const qv=b.comparisons.queryValues;
    qv.queryApplicable=true;
    b.verification={observedOn:parity.observedOn,verdict:s.verdict,cause:s.cause||null,evidence:[ev]};
    if(isShell){const g=grid?.results?.[page.program];if(g&&g.rowCount===0){const gev=`${gridRel}#${page.program}`;st(qv,'미검증',gev);st(qv.rowCount,'일치',gev);qv.rowCount.source=0;qv.rowCount.target=0;b.verification.cause='원본 0건(등록된 데이터 없음) = 대상 빈 표. 자료 연결은 미구현이라 값 있는 날의 동작은 미검증';b.verification.evidence.push(gev);}else{st(qv,'불일치',ev);st(qv.rowCount,'불일치',ev);qv.rowCount.source=g?g.rowCount:null;qv.rowCount.target=0;}st(b.comparisons.function,'불일치',ev);continue;}
    if(r.verdict==='미확인'){st(qv,'미검증',ev);continue;} // 상태 어휘는 미검증/일치/불일치 뿐(check-ecount-button-matches.cjs). 미확인 사유는 b.verification 에 남긴다.
    const srcRows=r.webVsLatest?.rowCountLatest??r.webVsSource.rowCountSource;
    st(qv.rowCount,r.webVsLatest?.sameSnapshot||r.webVsSource.rowCountWeb===srcRows?'일치':'불일치',ev);qv.rowCount.source=srcRows;qv.rowCount.target=r.webVsSource.rowCountWeb;
    const latest=r.webVsLatest?.sameSnapshot?r.webVsSource:r.webVsLatest;
    st(qv.totals,latest.totalsMismatch.length?'불일치':'일치',ev);qv.totals.comparedFieldCount=r.webVsSource.totalsFields;qv.totals.mismatchCount=latest.totalsMismatch.length;
    st(qv.rows,latest.mismatchRows?'불일치':'일치',ev);Object.assign(qv.rows,{matchingRule:'row order (RowKey) × numeric fields',comparedRows:latest.comparedRows,comparedFields:latest.comparedFields,mismatchCount:latest.mismatchRows,rawValuesStored:false});
    st(qv,r.verdict,ev);
    // 동작: 웹 결과가 그 원천 스냅샷과 행·필드 100% 같으면 조회 동작은 원본 자료를 그대로 낸다.
    const faithful=!r.webVsSource.mismatchRows&&!r.webVsSource.totalsMismatch.length&&r.webVsSource.rowCountWeb===r.webVsSource.rowCountSource;
    st(b.comparisons.function,faithful?'일치':'불일치',ev);
    st(b.comparisons.window,b.target.domState.inDialog?'미검증':'일치',ev);
    if(b.comparisons.window.status==='일치')b.comparisons.window.note='원본·대상 모두 같은 화면 안에 결과 표시(새창 없음)';
    Object.assign(b.conditions,{status:'일치',sourceObservedAt:r.latestTakenAt||r.web.sourceTakenAt,targetObservedAt:r.observedAt,sameSnapshotVerified:!!r.webVsLatest?.sameSnapshot});
    const all=['function','window','queryValues'].every(k=>b.comparisons[k].status==='일치');
    // 버튼 전체 상태 '일치'는 검증기 기준(원본·대상 캡처, 전체 조건 프로파일, 제한사항 0)이 더 엄격하다. 캡처가 없으므로 비교 항목만 일치로 두고 버튼 상태는 올리지 않는다.
    b.status=r.verdict==='불일치'?'불일치':'미검증';if(all){s.verified++;b.verification.note='기능·새창·조회값 일치(값 대조). 원본·대상 캡처 미확보로 버튼 상태는 미검증 유지';}
    b.conditions.evidence.includes(ev)||b.conditions.evidence.push(ev);
  }
  
}
fs.writeFileSync(reportPath,JSON.stringify(report,null,1)+'\n');
console.log(JSON.stringify(summary,null,1));
