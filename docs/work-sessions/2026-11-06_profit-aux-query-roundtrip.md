# 분석·원천시트 차수 왕복 자동조회 누락 보완

질문: 명시조회44→45선택→44복귀하면 기존 aux query intent로 자동조회되는가?

답변/근거: 부모는 aux intent를 year/range/view 변경에서만 폐기했다. week변경으로 자식은 unmount되지만 intent44는 남아 복귀시 remount되며 자식 mount effect가 분석/원천시트 GET을 실행한다. 원래 '선택만으로 금융GET0' 계약 위반이지 별도개선은 아니다.

승인범위/기준표: 기존 `[reportYear,weekInput.value,viewMode]` effect에 `setQueriedAuxScope(null)` 한줄. 모든 선택변경은 aux intent폐기, 과거scope복귀도 새조회전미마운트; 명시조회클릭만현재 year/week 자식마운트허용. 주문/출고/입고/재고/Estimate/ShipmentDate/ShipmentDetail.Amount/Vat/isFix/WebProfitReport/확정revision 전부보존, SQL·정책·수식변경0. 기존 dnSpy+SELECT 근거는 profit-frozen-explicit-query 계획/계약을 재사용하며 이번범위는 웹상태만, 추가운영query금지.

검증: production effectbody를 실행한 두탭×2025/2026 왕복회귀 등6PASS. 실제 localhost1920×1080/100% Chrome paced dry-run, 모든API합성/운영쓰기0. 기존4chapter동일흐름 통과 후 별도 aux회귀에서 분석/원천시트 각각44조회→45→44 GET증가0/자식미마운트, 다시조회만두번째GET. 진입금융0/조건변경0/추가reload0/총financial20(기존16+aux4), 오류0. `.verify/profit-aux-{0,1}-roundtrip-empty.png` 합성증거.

메뉴기준선: 적용—기존shell/크기/스크롤/키보드/비고·출력 선택 그대로; 해당없음—업로드/매칭/ERP저장 변경; 필수대기—UI sourcehash가 바뀌어 기존4chapter 실제가이드재촬영/재생검사. chapter확대 없이 aux회귀는 recorder.stop 이후 수행한다.

부모가녹화/PR/CI/배포 소유. sourcefreeze 준비, output500 별도 로컬원인진단 후 필요한 backendfix와 함께 정식gate1회예정. 현재최종영상/fullgate/배포는 미검증.

검색어: aux scope roundtrip queriedAuxScope 44 45 44 explicit-query guide4chapters synthetic

최종녹화: 최초93777은동작PASS이나최근44합성snapshot이fresh/snapshot으로교육배너모순이있어fixture만live/live/needsRefreshfalse로정정. 앱추가변경0. 재촬영97144는4chapter·aux2왕복·20GET·진입0·선택0·추가reload0 PASS, 부모중간22초live배너와끝42저장배너시각QA정상. MP4/VTT/proof/ready registry실제갱신완료, 다음은builtplayer/fullgate검증이다.

운영현상: cacheclear배포후main44 HTTP200/89.6초/선택scope일치/출력활성 및연이은output중PM2추가재시작0. output은1회HTTP500였으나oldworktree로컬동일pipeline PASS26.164초/1413SELECT/쓰기0, 단독42181336112 context200/1.071초→output200/85.888초로재현안됨. 정확원인은미확정이며해결했다고표현하지않는다. bodyCode:null은filteredSQLcode일수있어codePresent+knownSQL진단보강, GET-onlyprobe는main기본/output선택+context후target1GET만허용. 앱/인증/notes/backend추가수정0.

모든소스freeze/문서commit준비, 부모PR/CI와정식fullverify+singleworkerbuild 및builtUI/player병행예정. 최종배포후실UI main+실파일전체1회검증이남았으며현재미검증이다.
