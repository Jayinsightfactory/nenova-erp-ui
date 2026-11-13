# 작업 기록

## 2026-11-05 /pm 3D(베타) 품질 총개선 — 체형 교정·클레이 렌더·배경 밀도 + 브리지 page/scroll (PR #1534)
- 지시1 체형: build_char_kaykit.py 에 HEAD_K=0.55(머리 축소) + NECK_Z=1.17/BODY_K=1.1(목 아래 리그·메시 세로 스트레치, 머리는 평행이동) — 바인딩 전 변형이라 클립 9종 무손상, 머리:전신 1:2.2→≈1:4(레퍼런스 Kenney Protagonists·KayKit Rogue). sit 힙 0.48→0.52(SEAT_Y 보정), 서기 머리끝 1.94→1.78, CHAR_SCALE 0.95→1.1(화면 90~110px 테스트 유지). build_wearables.py 에도 같은 재매핑(head=이동+축소, chest=상승, hand=새 리그 좌표라 무수정) — 한쪽만 하면 착용물이 공중부양.
- 지시2 렌더(QUALITY_RECIPE.md): 전역 shadowMap OFF→접지 블롭 평면, kit AO 베이크(신규 scripts/pm3d/bake_kit_ao.py: 모듈을 격자로 벌려 상호차폐 방지→공동 Smart UV 1024 아틀라스→Cycles AO→kit_ao.jpg+TEXCOORD_1 재export), 캐릭터 MeshToonMaterial 5단 파스텔 램프(NearestFilter), RoomEnvironment 1회+dispose, ACES 노출 1.05(1.2는 파스텔 날아감), 배경 그라데이션+fog+포말 띠. 토큰=PM3D.RENDER.
- 추가지시 배경밀도: 신규 lib/pm3dDecor.js beachDecor — 오두막3~4·야자군락·산포물, 둘레 링+복도(z=±2)+좌석+책상+스테이션+허브 이격 보증(__tests__/pm3dDecor.test.js, 링 실경로 샘플링). ★함정: 복도 교차는 ringDistance 만으론 못 잡음 — corrX(책상·스테이션 x범위) 세그먼트 거리 별도 검사.
- 지시3: ai-bridge page/scroll(selector→scrollIntoView / y, 읽기성·차단 없음) + MCP page_scroll + 테스트 + AI_BRIDGE.md.
- ★함정(rebase): rebase 중 'git checkout --theirs'는 내 커밋 쪽(= merge 와 반대). glb 바이너리는 origin/master 로 명시 복원 후 재빌드가 정답. 또 블렌더 체인 실행 중 git checkout 으로 glb 를 건드리면 레이스로 산출물이 덮임 — 체인 한 커맨드로 직렬 실행.
- 검증: 로컬 next dev(터보팩, webpack dev 는 instrumentation→mssql 번들 오류)+dev JWT 쿠키로 /pm 3D 실렌더. 전/후 nenova-pm/pm3d/shots/web-I-v12-quality-{before,after}.jpg, 체형 web-I-v12-char-before-after.jpg. fps 는 브라우저 패널 백그라운드 스로틀(1Hz)로 로컬 실측 불가 — 그림자 패스 제거로 라이브 20fps 보다 가벼움, 배포 후 스탯 라인 확인.
- 지시1 설계변경(선택형 체형): 한 char.glb(늘씬 1:4 베이크)로 런타임 본 스케일 3프리셋 — BODY_TYPES(cute 1:2.7·balance 1:3.4 기본·slim 1:4) = head 본 스케일+전체 스케일. 모자·안경·종족은 head 본 스키닝이라 소켓 자동 추종, 좌석은 bodyMetrics.seatY, 블롭도 s 추종. ★함정: glTF 익스포트가 상수 scale 채널을 깔아 믹서가 본 스케일을 되돌림 → 로드 시 .scale 트랙 제거 필수. 저장=pmAvatars PM_BASE.bodyType(무료), 꾸미기 UI 3D 체형 행, 상점 미리보기는 render_shop 체형별 레이어 세트(.cute/.slim 접미사). 검증 __tests__/pm3dBody.test.js(비율·좌석 0오차·소켓·scale 채널).
- 검색어: HEAD_K 머리 축소 비율 교정 bake_kit_ao AO 베이크 아틀라스 toon 램프 블롭 그림자 RoomEnvironment beachDecor 배경 밀도 오두막 page_scroll rebase theirs glb

## 2026-11-05 /pm 상점 잔여 에셋 전량 3D 제작 — 소품 43종 + 종족 9종 전용 모델 (PR #1532)
- #1528 잔여 손그림 43종(모자16·안경6·손10·배지7·책장4)과 임시 종족 9종을 전부 블렌더 자체 모델링으로 교체. 남은 임시(temp) 0.
- 신규 scripts/pm3d/build_wearables.py: 기존 char.glb 를 import 해 착용 48메시(hat_*/gls_*/hnd_*/bdg_*/race_*)를 head/chest/hand.r 본 리지드 스키닝으로 추가 후 재-export — KayKit 베이크·춤 리타게팅 재실행 없이 안전(클립 9종 유지, pmProps3d 가 회귀 검사). 신규 build_shelves.py: kit.glb 에 shelf_* 4종 append(import→추가→재-export = import_furniture.py 선례).
- lib: pm3dLayout.wearMesh('hat.beret'→'hat_beret')/shelfModel, look3d 에 glasses/hand/badge/shelf/raceMesh. pmThemes RACES = 프리미티브 attach 삭제→전용 메시(mesh:'race_*'), 전원 temp:false. Scene3D 는 attach 블록 삭제+이름 토글+책장 배치만(허브/라인/주행 무변경).
- ★함정1(render_shop): 착용 메시 재질명 w_* 가 몸 재질 알파 토글에 휘말려 전부 alpha 0 → 빈 렌더(620B webp). w_* 는 토글 제외.
- ★함정2(Scene3D): 다중 재질 메시는 GLTFLoader 가 그룹(이름 유지)+자식 메시(데이터명)로 분해 → 메시 단위 이름 검사로는 영영 안 숨겨져 "모든 착용물이 머리에 블롭"으로 겹침. 그룹 수준(isMesh 불문 o.name) 토글이 정답. 옛 모자 3종은 단일 재질이라 이 버그가 없었던 것.
- 상점 렌더 160장 0.79MB(상한 6MB), glb 총 2.80MB(상한 8MB). 착용 카드=소품만 evaluated bbox 확대, 레이어=종족 베이스와 같은 카메라(미리보기 겹침에 안경·손·배지 추가, PmTheme).
- 검증: test:pm 전체(+신규 __tests__/pmProps3d.test.js: glb 노드 실재·look3d 경유·temp 0·클립 유지·용량 상한, pmShopArt 전수 확장) + 로컬 dev 실측(시드 pm-avatars.json·work-feature-pm-office.json 은 미커밋 dev 전용) — 3D에서 왕관·선글라스·풍선·책장·펭귄 부리 실표시 확인. 시트·스크린샷 C:\Users\USER\nenova-pm\pm-shots\props-*-2026-11-05.jpg, 3d-장착확인-2026-11-05.jpg, 상점-모자탭-2026-11-05.jpg.
- 검색어: build_wearables build_shelves wearMesh shelfModel race_ 메시 토글 그룹 분해 w_ 알파 상점 소품 43종 임시 0 pmProps3d

## 2026-11-04 /pm 상점 그림 3D 렌더 전면 교체 + 종족 복원 + 탈것 경로 고정 (PR #1528)
- 사장님 피드백 3건: 손그림 상점 그림 → 3D 장면 glb(char/kit/mounts) 블렌더 렌더로 교체(상점 모습=사무실 모습), 탈것 적용 점검, PR 1520 KayKit 교체로 유실된 종족 디자인 복원.
- 파이프라인: node scripts/pm3d/dump_shop_spec.mjs(lib look3d/PM3D.RACES 를 JSON 으로) → blender -b -P scripts/pm3d/render_shop.py(Blender 5.2, 소프트클레이 조명·3/4·투명 webp 512) → public/pm/shop/ 80장 0.43MB → node scripts/pm3d/apply_shop_renders.mjs(manifest src 77종 교체). 몸이 메시 1개+재질 7슬롯이라 보이기/색은 재질 단위(알파 토글), 렌더 출력경로는 반드시 절대경로(상대경로면 조용히 미출력).
- 종족 복원: lib/pmThemes PM3D.RACES 한 표(색+부속 귀/더듬이/부리/화관, 전용모델 없음=temp 임시) — look3d 가 char 반영, Scene3D 가 head 본에 부속 부착(hex 금지라 색표는 pmThemes 에만). ★버그: look3d hair 해시 (h>>3) 부호 쉬프트 → 음수 인덱스 → 머리색 undefined — >>> 로 수정.
- 탈것: 구매→items.mount→look3d→Scene3D 노드 경로는 15종 전부 정상(노드명 공식 'mount_'+id.replace(-,_) = glb 루트와 일치). 끊긴 곳은 상점 표시(이모지뿐)여서 mounts.glb 썸네일 연결 + 왼쪽 미리보기에 탈것 표시. __tests__/pmMounts3d.test.js 가 노드 매핑 표·extras(seatZ/pose)·경유·썸네일을 고정.
- 왼쪽 미리보기: 같은 카메라 고정 렌더의 베이스+옷 레이어+모자 레이어 겹침(Render3DPreview, PIL 합성으로 정합 검증). 기존그림 유지 43종=모자16·안경6·손10·배지7·책장4(3D 모델 없음).
- 함정: 주석의 #1520 도 pmNoHexColor 가 hex 로 오탐(PR 1520 으로 표기). 워크트리 node_modules junction 은 Turbopack/webpack 둘 다 깨짐(실설치 필요). next dev 는 instrumentation→mssql 번들 오류 — 로컬 확인은 build+start.
- 검색어: render_shop shop_spec PM3D.RACES look3d hair >>> 탈것 노드매핑 pmMounts3d pmShopArt 상점 렌더 임시 종족

## 2026-11-04 판매 예정(/pm) 코드 ↔ 사내 전산 경계 자동 검사기(CI)
- PR #1525 머지. /pm(PM 사무실)은 나중에 nowlink 판매 저장소로 이식 예정 → 사내 모듈 직접 import 가 늘지 않게 CI에서 새 위반만 차단(선례 mgmtBoundary 구조 재사용).
- 구성: lib/pmSaleBoundary.js(PM 소유=pages/pm*, pages/api/pm/, components/pm·pm3d/, lib/pm* / 허용=같은 판매군+MenuBackButton·styles+npm 패키지 / 금지=lib/db·lib/auth 등 사내 lib·사내 API 핸들러 직접 import, 서버 데이터는 fetch 경유), config/pm-boundary-allowlist.json(기존 위반 31건 동결 — 대부분 pages/api/pm/* → lib/auth·orbitReportAccess·workFeatureData), __tests__/pmBoundary.test.js(단위+전수 스캔), npm run test:pm-boundary(test:pm 체인 맨 앞), erp-contract.yml verify 단계 추가.
- 함정: lib/pm* 패턴은 preShipment* 와 충돌 없음(/^lib\/pm[A-Z0-9]/). 동결 목록에서 사라진 항목은 실패 아닌 안내만.
- 검색어: pmSaleBoundary pm-boundary-allowlist test:pm-boundary 판매예정 경계 nowlink 이식 동결 31건

## 2026-11-04 PM 자동업무: 기술 레이더 "바로 시험" 자동 파일럿(+시험함 배지)
- owner PC nenova-pm/pm-radar-pilot.js 신설(pm.js 루프에서 호출, 백업 pm.js.bak-1104c): 최신 회차 action='바로 시험'&pilotResult 없음 → 대장(ledger) 등록 → 조사관(claude -p)이 radar-pilot/<slug>/ 전용 폴더에서 로컬 설치·실데이터 시험 → REPORT.md+PILOT_RESULT JSON → tech-radar.json pilotResult{score,summary,reportPath,testedAt} 반영 → radar.js --upload-only 재업로드. 채택은 자동 아님: 대장 needs-approval 승인 대기.
- 코드 관문: 전용 폴더·디스크 10GB·회차당 2건·시도 5회·동시 1개(pm/staff 조사관 포함)·quota-hold/pm-mode·공격성 저장소 차단·external 표시(수동 파일럿 MinerU/docling) 건너뜀. 감시: watchdog.js radar-pilot-stale(7일+ 미완). 드라이런 검증: 후보 9건 선발·대장 등록·프롬프트 생성 OK(pm.log 기록).
- 이 PR(#1514): /pm/radar 카드에 pilotResult 있으면 🧪 시험함 배지+상세 수치(var(--pm-ok-*) 토큰만, 데이터 없으면 렌더 변화 0).
- 검색어: radar-pilot pilotResult 시험함 바로시험 파일럿 needs-approval radar-pilot-stale pm-radar-pilot

## 2026-11-04 /pm SOFT CLAY 디자인 시스템 토큰 반영(+기준 문서)
- PR #1503: radar 칩 한 덩어리 분리(이모지 아이콘·이름·★·점수 N/10 별 요소), 배지 전부 UI 키트 Badge(.radar 스코프 재정의, 전역 .badge 불변). PR #1506: design-system.png 실측 → 테마 B 토큰 교체(민트 A0E0C5·크림 FFFDF5/FFF8E7·코랄 FF9E8B·노랑 FFE085·라벤더 D5C2F1·비활성 E0E0E5), 키트 버튼 호버/눌림/비활성 상태(accentHover/Down·errHover/Down·disBg/Ink, 타테마 color-mix 파생), radar 링크 클레이 밑줄(호버 코랄).
- 기준 고정: docs/pm-design-standard.md(유일 기준·생성이미지 금지·/pm 전용 범위) + public/pm/design/ 축소 사본 2장. 범위 검증=globals.css 무변경+선택자 전부 .pm/.radar 접두+pm* 테스트 20종 통과.
- 함정: 주석에 쓴 <button·#hex 도 pmTechRadar/pmNoHexColor 가 잡음. 배포런 STALE_RELEASE 는 뒤 머지에 추월된 것(실패 아님).
- 검색어: SOFT CLAY design-system pm-design-standard 테마B A0E0C5 FF9E8B accentDown disBg pmk-primary-down 링크밑줄

## 2026-11-04 /pm/radar 기술 레이더 클레이 파스텔 재구성
- PR #1498: Gemini 시안(nenova-pm/github-radar/design/radar-ui-A.png)대로 재구성 — 헤더(회차 배지·우리관심/전체트렌드 탭·주제/추천/점수 필터칩), 왼쪽 "바로 시험" 큰 카드 3장(이게 뭐예요/빗대면/용어풀이/자세히 보기), 가운데 작은 카드 그리드(클릭 펼침, 12건 "더 보기" — 수집량 20~40건 대비), 오른쪽 사이드바(점수분포 막대 최상/상/중/하·주제별 개수 파스텔 칩·지난 회차). 집계는 전부 클라이언트, API 불변.
- 색은 lib/pmThemes.js 테마 B 토큰 var(--pm-*)만(hex 0), themeCss(themeById('B')) 주입 + data-theme="B". 버튼류는 components/pm/ui 키트만(SelectCard 는 styled-jsx 밖 컴포넌트라 :global(.hit) 필요).
- 배포: 내 커밋 배포런은 STALE_RELEASE(직후 머지 #1499~#1501에 추월) 2회 중단 후 #1501 배포런에 포함되어 성공. /pm/radar 307→login 확인.
- 검색어: 기술레이더 radar 클레이 파스텔 radar-ui-A 점수분포 BigCard SmallCard STALE_RELEASE themeCss

## 2026-10-22 ECOUNT 검증 2~3차(자동 갱신·원본 대조·수집 추가)
- PR #1241: 수집 직후 웹 작업본 자동 갱신(RED 건너뜀, 기준시각·검사상태 표시) + 채무 RED 오판(원 단위 반올림 2원 차, 허용폭 1원) 수정 → 허용폭 max(1,0.5×행수). 배포 후 채무 911 GREEN·작업본 자동 갱신 확인.
- PR #1242: 원본 화면 직접 읽기(부모 세션 브라우저) — 채권·채무·계좌 웹=최신 스냅샷=원본 합계 → 검증 0→8. 원본 0건 7화면, 회계거래조회 10/20 원본 12 vs 웹 업로드 9(시차).
- 판매조회(saleQuery)·회계거래조회(journal) 매일 수집 추가(기본 기간 F8→Excel), 자동 갱신 대상 포함.
- 검색어: ECOUNT 자동갱신 refreshFromLatest RED 반올림 허용폭 source-grid saleQuery journal 매일수집

## 2026-10-22 ECOUNT 검증 1차(우선순위 화면)
- 운영 DOM 크롤 15화면: 미관측 170→101, 구현 1,677·미구현 1,940. 조회값 코드 대조(scripts/ecount-verify-values.mjs): 웹 변환은 원천 스냅샷과 100% 일치.
- 판매현황 조회 2버튼 기능·새창·값 일치(검증 0→2, 캡처 없어 버튼상태 미검증 유지). 채권·채무·계좌 = 웹 작업본 10/20 고정 데이터 시차. 채권조회 등 8화면 자료 미연결. PR #1238.
- 검색어: ECOUNT 검증 value-parity 데이터시차 E040214 E040309 E010205 E040207 verify-values

## 2026-10-22 ECOUNT 원본 조사 마무리(관찰 사용 화면만)
- 사장님 결정: 남은 128화면 중 직원 관찰(9/18~10/14, 210건)에서 쓴 8화면만 조사(채권조회·채권거래내역·채권현황·채무현황·계획전표조회/현황·수입비용전표검색·전표별회계반영(비용) 조회만) + 선행 5화면. 나머지 120 미사용·미조사, 위험 10 열지 않음(scope-decisions.json). 구현 대상 제외.
- 결과: 버튼 목록 243/373, 관측 3,867, 구현 1,649, 검증 0. 새 124 버튼은 대상 DOM 크롤 전이라 미관측. PR #1234.
- 검색어: ECOUNT 미사용 120 위험제외 scope-decisions 채권조회 E060403 E060814 계획전표 survey-used-p040-p047

## 2026-10-19 인보이스 직접 입력 보완
- 관세율 퍼센트 입력, 직접 입력 필요행 필터, 서버 승인 저장/복원 안내. 빈칸과0 구분, ERP writer/계산식 불변.
- 실제41-02/1214205: 웹 revision3 입고일 저장 후 기존7662 원가연결 COMMITTED. native85행 동일, 활성입고1건. 실제 원가승인·다운로드는 레우코취2관세율 필요로 미검증.
- 격리SQL 원가저장/재조회/엑셀/ERP보존 통과. 상세 docs/work-sessions/2026-10-19_invoice-manual-cost.md.
- 검색어: 인보이스 직접입력 관세율 퍼센트 LINK_EXISTING_COST 7662

## 2026-10-19 전체 분배 교체 누락 방지
- 현재 최종 분배에서 양재동 카네이션 6품목 제외가 맞다. 주문을 복원하지 않는다.
- 서버 서명으로 전체교체 행 누락/변조 차단, 주문 없는 기존 분배도 원본 Shipment 기준 재검증, 저장 직전 확정 변경 시 전체 중단.
- 운영 DB 수정/보정/마이그레이션/재계산 없이 코드만 배포한다.
- 전체 ERP 회귀검사, 빌드, 계약 및 쓰기 범위 검사 통과. 운영 실제 저장은 미검증(금지 범위).
- 상세: docs/plans/distribution-replacement-2026-10-19.md. 배포 결과는 PR/Actions에서 확인.
- 검색어: 양재동 36-01 카네이션 전체교체 누락 분배 replacementPlan coverage
## 2026-10-19 네덜란드 패킹 미매칭·원문 검산
- 실제 `41-2 NL H CI.pdf`의 Y2 주문코드로 Holex 로컬 파서가 중단되던 원인 수정. 146행, 16,251송이, EUR31,141.91, 소계/CBS/총액 검산 통과.
- source invoice/line identity로 반복 품명 미매칭 오표시 수정. NL 품종/규격 후보를 미리보기·생성에 공유. 후보는 수동 승인 상태 유지.
- 검산 완료한 로컬 Holex만 일회용 원문 증명으로 행별 체크 생략. AI 또는 변경된 행은 그대로 검토 대상.
- 실제 dnSpy ExcelLoadingPackingList 조회. SELECT로 송장1214205는2026/41-02 WarehouseKey7662에 이미 입고된 점 확인. 신규 입고/매칭/재고/원가 운영 쓰기 없음.
- 기존 저장 GW2296.5/CW2553과 PDF2298.3/2555 차이 확인. 기존 입고 보정은 이번 범위에 포함하지 않음. WebInvoiceCostRevision 해당WarehouseKey 0건. 도착원가 실제 저장은 미검증.
- 검색어: Holex Y2 1214205 Aisha Casablanca packingSourceMatchedName LOCAL_NL_HOLEX_VERIFIED_V1
- 2026-10-19 배포39190519519는 이전 빌드의 generated JSON2개/package-lock.json 변경 때문에 안전 중단. 이 세 파일만 원본+binary patch 백업 후 HEAD로 복원하여 ff-only 진행하도록 보완. 다른 tracked/staged 변경은 중단, untracked 운영 파일은 보존. DB 쓰기 없음. 검색어: BUILD_OUTPUTS_BACKED_UP DEPLOY_CHECKOUT_DIRTY

## 2026-10-19 Holex 후속 검증
- 운영 3df9f1c0 배포 확인. 35개 공용 매칭 보정 후 146/146, 패킹82행/16251송이 생성 확인. 기존 Warehouse7662 재등록 안 함.
- rawMetadata 382420bytes가 기존256KiB 제한에 막힘을 실제 PDF로 재현. 문서 감사근거만1MiB 허용, 행256KiB/전체2MiB 유지. 상세 docs/work-sessions/2026-10-19_nl-packing-finish.md.
- 사용자 허용: 업로드 시 네이버 환율, 유사 과거 통관비 추정. 현재 조회 EUR1493.64, 비용 저장은 아직 안 함. 기존native입고와 웹 원가 연결 경로 미완료/실저장 미검증.
- 검색어: rawMetadata 382420 1214205 7662 추정통관비

## 2026-10-19 Claude 인수: 출고 견적 누락 방지 #1076
- 사용자 결정: 주문을 먼저 등록해야 분배 가능. 기존 같은 트랜잭션 주문생성→분배 계약 유지.
- #1076 검토 중 금액정렬의 NULL 수량 재쓰기 재현/수정, 혼합단가 보존, 신규 DELETE API 제외.
- 기존67+회귀4=71검사 통과, 운영 SELECT 골든10검사 통과. 전체 ERP/빌드 통과, 미배포·운영저장 미검증.
- 상세 docs/work-sessions/2026-10-19_claude-handoff-guard.md. #1085 원가연결은 별도 작업.
- 검색어: Claude 인수 1076 주문먼저 EstQuantity NULL 혼합단가 DELETE CRLF

## 2026-10-19 기존 입고 보존 원가 연결
- LINK_EXISTING_COST 웹 전용 연결: 원문 다대일 합계 검증, 전체 입고 스냅샷 보존, 이후 native 입고 변경 경로 차단.
- 추정 비용 근거 저장/복원/엑셀 표시, 다운로드 시트명 연도·세부차수. 분리 SQL fixture에서 링크/재시도/원가 저장·조회/엑셀 및 ERP 보존 통과.
- 운영 7662는 원문 146행/상품82행/16251송이. 매칭3건(20/25/113행)을 기존 입고와 대조하여 웹 초안 revision2로 보정. 입고 미변경.
- 사용자 '추가해줘' 승인으로 웹 CHECK 허용값만 추가, 신뢰/활성 상태 및 입고 전후 동일 확인. 배포·운영 원가 저장·실제 다운로드 최종 대조는 아직 미검증.
- 검색어: LINK_EXISTING_COST 7662 1214205 추정통관비 차수시트

## 2026-10-19 품목관리 품종 버튼·카탈로그 사진
- 품종은 사용자 확인대로 목록 복수선택 필터이며 ERP 활성상태 변경 없음.
- 품목명 hover/focus 사진, 클릭/Enter 기존 공용 이미지 관리. 같은 ProdKey/이미지 ID 사용, 카탈로그 복귀 재조회 및 변경시각 URL로 캐시 갱신.
- 운영 GET: Product3350개, ProdKey447과 대표사진1 대조. 운영 이미지/ERP 쓰기 없음. 실제 교체 미검증. verify:erp-change(빌드 포함), test:ui-layout 통과. 로컬 브라우저 필터/사진/키보드 검증 통과. 배포 진행 중.
- 검색어: ProductCatalogPhoto productCatalogFilter 품종 버튼 공용 사진

## 2026-10-19 품종별 하위 품목 단일 전환
- 사용자 후속 확정: 카네이션/장미 등 상위 품종 버튼 하나 선택 → 해당 하위 품목 표시. 다른 품종은 교체 선택, 같은 버튼은 유지, 전체로 복귀. 검색은 선택 품종 안에서 기존대로 적용.
- 변경은 React 필터/묶음 제목/행 선택 초기화뿐. Product/Flower 및 모든 주문·출고·재고·견적·매출 원장 보존, 사진 공용 연동 유지.
- 실제 dnSpy FormOrderAdd.GetDataProduct 재확인. 운영 읽기에서 카네이션379/장미814 품목 분류 확인. 실제 버튼 핸들러 회귀 통과, 전체 검사/배포 진행 중.
- 검색어: 품종 하위 품목 단일선택 flower-groups

## 2026-10-19 국가 → 품종 → 하위 품목 정정
- 사용자 최종 요구는 품종이 아닌 국가(네덜란드/콜롬비아/중국 등) 상위 버튼. 국가 선택 시 해당 국가의 품종 버튼과 품종별 구분 행 아래 품목을 표시한다.
- 실제 dnSpy FormOrderAdd.GetDataProduct의 CounName/FlowerName 조회 확인. 운영 읽기 3351개: 네덜란드1306/콜롬비아1025/중국433. 국가/품종은 DB 값으로만 묶고 누락은 미지정, 원장 변경 없음.
- 국가 변경 시 하위 품종/행 선택 초기화, 검색 조건 유지, 사진 공유 기능 유지. 실제 페이지 핸들러와 교차연도/동일품종 타국/누락 분류 회귀 통과. 전체 검사·배포 진행 중.
- 검색어: productCountry groupProductsByCountryFlower 국가 품종 하위품목
- 검증 완료: verify:erp-change(ERP 계약/dnSpy/manifest/write guard/프로덕션 빌드), test:ui-layout, 실제 페이지 버튼 회귀 및 로컬 브라우저 국가·품종 전환/키보드 통과. PR·운영 배포 진행.

## 2026-10-19 수입부 10 품목관리 · 영역 일괄 입력
- 기존 국가/품종/검색을 유지하고 5항목 영역 드래그·개별/일괄입력·변경 확인·명시 저장 추가. 수입부 탭 전환 시 초안 보존.
- 실제 ClassProduct/FormProductAdd CLI, 운영 schema/trigger SELECT 확인. ProdKey+6필드 CAS, 전체 transaction, 사후 대조, SystemActionLog 전후 감사. 주문/입고/출고/재고/견적/손익 원장 미수정.
- 격리 MSSQL 저장/소수/0/파생값/rollback/Stock-trigger/교차연도 검증 통과. 전체 ERP검사·빌드 및 Chrome 마우스드래그 시험 통과. 운영 배포 스모크 아직 미검증(진행 중).
- 검색어: ProductBulkEditor products-bulk 수입부10 영역드래그 품목일괄입력

## 2026-10-19 품목 입력 히스토리 · 인보이스 문제 로그
- 기존 10 품목관리 PR1090/9ced3744 운영 배포 성공. 추가 이력은 전체/선택 품목의 전후 값과 수정자·시각 표시; 개별 저장도 같은 transaction 감사.
- 초안 이전 업로드 문제 분류·건수는 SystemActionLog, 서버 검증 행별 문제는 WebInvoiceHistory. 사용자별 같은 탭 대기 로그 복원/명시 로그만 재시도. ERP 입고/재고 재실행 없음.
- 테스트/최종 배포 확인 진행 중. 운영 업무 데이터 수정 테스트 미실시. docs/work-sessions/2026-10-19_import-audit-history.md 참고.
- 검색어: ProductInputHistory INVOICE_UPLOAD_ISSUE invoiceValidationAudit

## 2026-10-19 중국 발주 다운로드 HF 별도 셀
- 품목명 A열/HF CODE B열/단위 C열/합계 D열, 업체 E열부터. banner와 원수량/환산/정렬/매칭 유지. SQL/API/운영 DB 미수정.
- 실제 XLSX round-trip 열/선행0/빈칸/수식형코드/합계/교차연도/260업체 통과. 전체 guard/빌드·배포 스모크 진행 중.
- 상세 docs/work-sessions/2026-10-19_china-hf-columns.md.
- 검색어: 중국발주 HF CODE 별도셀 별도열 chinaOrderWorkbook

## 2026-10-19 패킹 원문 확인 안내
- Cloudland 캡처의 품목매칭/원문 확인 의미를 구분. 구체 사유·행 수정 초점·남은 건수·다음 단계 안내 추가.
- 적용된 원문 검토는 기존 validator 통과시 미리보기에서 재요구하지 않음. 파일/수량/송장연도 변경시 경고 유지.
- 원장/API/SQL 쓰기 변경 없음. 대상 63통과1skip, 전체 계약/가드 통과, 격리 Chrome callback/키보드 확인. 배포 진행 중, 실제 원본 재업로드/입고 미검증.
- 검색어: packing-review-guide VERIFIED_BASELINE_UNAVAILABLE Cloudland 원문확인
- 추가 캡처의 숨겨진 확인 열을 품목 상단으로 이동. 중첩 표 스크롤 제거, 한글 입력명·진행 건수. 로컬 실제 PDF/13행 확인→제출 성공, 대상25/25 및 전체 계약/빌드 통과. PR1094 배포 진행; 운영 입고는 미실행.

## 2026-10-19 주차별 매출이익 범위 출력·이상비율 진단
- 조회 완료된 연도 기준 1~선택 차수 표시/원본 시트 다운로드, 차수 선택 인쇄 미리보기, 진행률·취소·교차연도 응답 차단.
- 공통 보고서 읽기/확정값을 보존하며 출력 GET은 ERP 및 Web snapshot 쓰기 없음. 기존 수기 저장은 기존 명시 경로 유지.
- 운영 SELECT 진단: 재고조정 영향, 재고 평가근거 누락, 근사 평가, 오래된 계산 snapshot을 구분. 실제 금액·거래 데이터는 공개 저장소에 저장하지 않음.
- 계약·dnSpy·manifest·쓰기 가드·빌드 통과 후 마지막 보완 재검증 진행. 합성 자료 1/26/41 선택 미리보기 확인. 실제 프린터 출력은 미검증.
- 상세 docs/work-sessions/2026-10-19_profit-range-output.md.
- 검색어: 주차별매출이익 전체차수 엑셀 선택인쇄 profitRangeOutput 재고평가 누락 snapshot

## 2026-10-19 보고서 엑셀 한 차수 한 시트 후속 명시
- 사용자가 원본/표시용 중복을 원치 않음을 명시. 범위 다운로드는 차수당 한 시트만 제공하고 웹 실제 표시열 순서·품명 숨김·프리셋을 반영, 비고는 같은 시트 하단 보존.
- 기존 단건/MOYI 원본 호환 API는 유지. 미조회 연도/차수 입력 상태의 출력은 차단. 원장 수정 없음.
- 검색어: 한차수한시트 표시필터 품명숨김 profitRangeOutput

## 2026-10-19 배포 차단 학습 단위 파일 보존
- 읽기 전용 GitHub SSH 진단으로 data/order-import-units.json 운영 학습 변경이 원인임을 확인. 설정 내용은 공개 로그/저장소에 미포함.
- 같은 파일의 upstream 변경이 없을 때만 원본을 그대로 유지해 fast-forward. 비공개 백업, 충돌/잘못된 JSON/미확인·staged 수정 차단. 원장·단위 판정 로직 변경 없음.
- 실제 임시 Git fixture에서 설정 보존·백업·동시 저장 유지·upstream 충돌·비정상 JSON 차단 통과. 전체 검사/CI·배포 진행 중, 운영 반영은 아직 미검증.
- 상세 docs/work-sessions/2026-10-19_deploy-learned-units.md.
- 검색어: DEPLOY_CHECKOUT_DIRTY order-import-units diagnose_checkout_only 운영학습보존

## 2026-10-19 수익률 검증 별도 창
- 매출이익 보고서 상단 및 공용 메뉴에 별도 검증창 연결. 조회 연도/차수 전달, 기존 보고서 경고·원천 점검·StockHistory 참고 이력 표시.
- 원장/계산/확정/재고 보존, GET-only. 독립 검증 엔진은 미구현으로 명시. 오류·stale·다른 연도 응답을 정상 결과로 숨기지 않는다.
- 실제 FormStockView CLI 및 2026/32 Stock/확정매출 존재 SELECT probe 확인. 기능검사와 배포 결과는 세션 MD에 기록하며 성공 전 운영 완료로 판정하지 않는다.
- 검색어: profit-validation 수익률검증 새창 popup 연도차수 읽기전용
- 로컬 verify:erp-change(build 포함), dnSpy evidence, UI layout, 합성 Chrome 교차연도/실패/390px/키보드/GET-only 통과. PR·배포·운영 새창은 아직 미검증.

## 2026-10-19 패킹 매칭 완료 후 다음 단계
- 사용자 요구에 따라 원본 품명 옆 DB 품목 매칭을 완료하면 별도 원문확인 체크 없이 다음 단계로 이동. PDF 렌더 실패 자체가 입고 준비를 취소하지 않도록 분리.
- 실제 필수 숫자/음수/원본 해시/수정 스냅샷/날짜·통화·총액/단위 검증은 보존. 기존 입고 writer와 중복/연도 검증 변경 없음. ERP 원장 쓰기 수행하지 않음.
- 수정 전 로컬 dnSpy 및 2025/2026 42-02 읽기 전용 probe. 전체 ERP 계약, dnSpy, 변경 manifest/write guard, build 통과. 격리 브라우저에서 체크 없이 10→20 수정 적용, VALUES_APPLIED/confirmed=false 검증. 후속 문구 수정 빌드와 운영 배포는 진행 중(아직 미검증).
- 검색어: packing-match-next assertPackingSourceValues VALUES_APPLIED 원문확인체크제거
- 배포 전 추가 점검: 분석 완료 상태문에 남아 있던 과거 원문 검토 안내 2곳도 DB 매칭→다음 버튼 안내로 통일. 실제 수량/가격 오류 안내는 유지. 검색어: packing-match-next-copy
- 후속 CI에서 예전 원문 검토 문구를 요구하던 화면 회귀 1개 확인; 새 사용자 요구의 매칭→다음 안내를 검증하도록 수정. 숫자/중복/쓰기 검증은 삭제하지 않음.

## 2026-10-19 품목 저장 EXE 호환성
- 웹 그룹/사진/일괄 편집 유지. 실제 dnSpy·운영 SELECT 후 CountryFlower 분류키와 독립 SteamOf1Box 보존, 최소 수정값 저장, 충돌·단위 변경 확인, 원자적 감사/읽기 대조 추가.
- 격리 실제 MSSQL 신규/수정/실패 롤백 및 교차연도 sentinel 검증 통과. 운영 DB 쓰기/스키마 변경 없음. 전체 검사·PR·배포 진행 중(운영 미검증).
- 상세: docs/work-sessions/2026-10-19_product-save-compat.md.
- 검색어: product-save-compat CountryFlower SteamOf1Box 독립값 EXE 품목저장

## 2026-10-19 독립 재고·수익률 검산
- 검증 새창에 1~선택 차수 수량 대사, 기초 이월/이번 차이 분리, 조정 포함 식, 최초 관측 구간, 직접 단가 곱셈 및 별도 수익률 산술을 구현. 원장/보고서 공식/확정본 보존.
- 비표준/누락 차수를 넘어 최초 원인을 단정하지 않음. FIFO/평균/판매단가 원가 증빙은 미확인으로 분리. 전후 SHA256 변경 시 판정 보류, NULL은 0 정상 처리 금지.
- 실제 dnSpy/SP/2026년 1~41차 SELECT probe, 합성 회귀 및 verify:erp-change 통과. 최종 브라우저·CI·배포는 진행 중(완료 전 미검증).
- 검색어: profitIndependentAudit 독립검산 기초기말 원인추적 STALE 조정포함

## 2026-10-19 패킹 차수 날짜 자동 적용
- 원본 날짜 없는 경우에만 표시 연도와 파일 세부차수로 PeriodDay 기준일 조회. 원본 날짜·수정 날짜 보존, 자동 적용 근거 화면/Excel/입고초안 기록.
- 실제 dnSpy 및 2025/2026 42차 읽기 전용 달력 검증. 숫자/단가·중복 검증 및 기존 입고/재고/매출 writer 보존. 실제 입고 저장하지 않음.
- 빌드·날짜 회귀 통과, 전체 계약과 배포·운영 브라우저는 진행 중(미검증).
- 검색어: packing-week-date DATE_SOURCE_UNAVAILABLE PeriodDay AUTO_ORDER_WEEK 중국패킹

## 2026-10-19 에콰도르 기초재고 실제 매입 근거
- 41차 기초의 일부 품목만 최근 4차수 밖 매입이 제외되어 판매단가를 사용함을 실제 dnSpy/SELECT/모듈 비교로 확인. 같은 연도·과거 매입·정확 과세환율·완전한 동일 단위 도착원가 재현이 있을 때만 이월 우선.
- 기초/기말 자동 제안의 기간을 분리하고 오래된 원가 변경도 캐시 지문에 포함. ERP 수량·판매·견적·수기·확정 revision 보존.
- 1~41차 전후 비교, 36~41차 실제 보고서 비교 및 기초 단가 화면 동등성 확인. 다른 국가 변경 없음. 이전 차수 원가 부족은 남아 있으며 41차 기말 0은 실제 감소 조정과 구분해 설명한다.
- 신규 회귀와 전체 verify:erp-change(build 포함) 통과. CI·배포·운영 스모크 진행 중(아직 미검증). 상세 docs/work-sessions/2026-10-19_ecuador-acquisition-cost.md.
- 검색어: ecu-acquisition-carry profitReportAcquisitionCarry 최근4차수 판매단가 기초기말 과거매입
- PR #1105/ea015ab0 및 Cafe24 39257930494 성공, 운영 41차 평가값 변경 확인. 브라우저 스모크에서 week-check만 과거 캐시 경고를 읽는 불일치 발견하여 후속 보완 중. 검증창의 본표·원천 점검 모두 auditLive GET, 확정본·기본 호출 보존. 후속 배포 완료 전 미검증.

## 2026-10-19 중국 기존 입고 원가 연결 진행 중
- 별도 nw-china-existing-cost에서 CN 단기준 원가 연결 및 compact PDF 파서 초안. 운영 입고7671 읽기만 수행. 관련73테스트 통과9생략; 전체검사/배포/실저장/다운로드 미검증.
- 원본 Populus 10송이×15단과 총300송이 불일치 확인, 임의보정 안 함. docs/work-sessions/2026-10-19_china-existing-cost.md 참조.
- 검색어: china-existing-cost HUBFRESH 7671 Populus 150 300

## 2026-10-20 중국 단기준 원가 연결 후속
- 사용자 결정: Populus 원가 15단 기준, 송이 수는 직접 수정. 원본 송이값과 수정 사유·파생 박스당 송이를 별도 보존하며 단수/금액은 유지.
- 실제 PDF 파서 및 합성 오류 사례, CN 비용 저장/재조회 모의 SQL 및 NULL 품목 보존 검사 통과. 전체 ERP 검사·dnSpy·manifest/write guard·빌드 통과. 운영 로그인 확인.
- PR/운영 배포 및 실제 원가 저장·Excel 다운로드는 아직 미검증. 기존 운영 입고 수정 없음.
- 검색어: china-existing-cost EXISTING_CN 15단 송이수수정 null-product

## 2026-10-20 ECOUNT 기능 이관 자동 작업 설계
- 최신 origin/master abe88d34에서 별도 작업트리. 실제 Chrome 사이트맵·입출금·세금계산서 표/버튼과 기존 수집·은행·증빙 코드를 조회.
- docs/ECOUNT_REPLACEMENT_DESIGN_2026-10-20.md 및 docs/ecount-migration/work-plan.json에 자체 DB 범위, 외부 API, 14개 의존 작업, 수집 보강·원장 호환·전환 게이트 기록.
- ECOUNT/MSSQL 쓰기, 거래자료 적재, REA 설치, 실행 스케줄, 앱 배포 없음. 전체 기능 동등성·운영 API·실제 이관 미검증. 문서/JSON 구조 확인만 수행.
- 검색어: ECOUNT_REPLACEMENT_DESIGN ecount-migration REA 자체회계 은행대사 전자세금계산서

## 2026-10-20 전체 차수 계산식 검산
- 원장 76개 연도·차수 28,001항목 + 자동 저장 입력 116 revision 42,451항목 독립 산술 일치. 수동 확정 revision 0건. 원본 fixture 898셀 회귀 통과.
- 확정 AC/AJ 보존, 0/null 표시, 분모 0 합계 비율의 가짜 100%를 수정. 검증 새창·범위 검산에 전체 항목 검사 및 원천 누락 별도 경고 추가. ERP 원장/기존 확정본 변경 없음.
- 원천 누락 59차수 334행 및 NULL 연도/범위 밖 60차는 정상 인증하지 않음. 전체 gate/배포/운영 smoke 진행 중(미검증). 상세 docs/work-sessions/2026-10-20_profit-formula-complete.md.
- 검색어: profit-formula-complete 전체항목검산 AC AJ 확정조정누락 합계100퍼센트

## 2026-10-20 ECOUNT 전체 메뉴 작업실 초기 구현
- 8개 탭/537개 경로/423개 말단을 실제 사이트맵 메타데이터로 목록화. /ecount/workbench에서 18개 기능군, 430개 화면 계약, 합성 입력·계산·조회·수정·검토·취소·변경이력 및 저장 설계 제공.
- 외부 API 28개 말단도 화면/저장 로직 설계 포함. 실제 DB/API/영속 저장 없음, 민감정보 수집 없음. 인증/활동 수집기의 부수 호출도 제외한 독립 shell.
- 신규/전체 ERP/UI/manifest/write scope/dnSpy guard 및 첫 빌드 통과. 브라우저 견적 추가·수정/은행·세금계산서 설계 확인, 로컬 API 시도 0건. 최종 빌드 재검증 중. 원본 전체 상세 동등성/좁은 화면/운영 배포는 아직 미검증.
- 상세: docs/work-sessions/2026-10-20_ecount-replacement-design.md, docs/ecount-migration/menu-inventory.md, docs/ECOUNT_WORKBENCH_CONTRACT.md.
- 검색어: ecount-workbench 전체메뉴537 DB미연결 메모리초안 외부API저장설계

## 2026-10-20 44-1차 음수 주문 Pivot 통계 진단
- 2026/44-01 콜롬비아 카네이션26행 -76박스/수국4행 -17박스 정상저장 확인. 전산피벗 OutQuantity>0 조건으로30음수행 제외. 실제dnSpy/운영SELECT 동일 확인. 원장/코드/배포 변경없음. 사용자로그인화면 필터상태 미검증.
- 상세 docs/work-sessions/2026-10-20_pivot-negative-44-diagnosis.md
- 검색어: 44-1 음수주문 Pivot통계 OutQuantity 양수필터 카네이션 수국

## 2026-10-20 음수주문 이전표시와 모드전환 원인
- git기록: b46355a8(2026-09-14)에서 Pivot 기본mode=exe 도입, statsPivotMode 브라우저저장값으로legacy/exe복원. 기존웹피벗 주문SQL에는양수제한없음, EXE SQL OutQuantity>0은 c5feda67(2026-07-06) 도입이후변경없음. 사용자가이전에어떤모드였는지는미검증. 코드변경일과실제배포일은구분.
- 검색어: statsPivotMode b46355a8 전산피벗 기존웹피벗 음수주문 2026-09-14

## 2026-10-20 음수 주문 피벗 수정
- 주문 조회를 OutQuantity<>0으로 변경, 모든 국가·연도차수에 공통 적용. 원장 쓰기 없음. 20264401 음수31행/-103 추가(콜롬비아 수국·카네이션30행/-93), 기존1112행 동일. 20264402/20254001 원본 동일.
- signedOrders 18조합·XLSX 회귀, 1920/1280 브라우저(+10/-3=7), build/manifest/write guard 통과. 로컬 전체ERP 검사는 C: 여유558MB로 activity health 테스트 실패; CI 전체검사 통과 전 배포 금지. 캐시삭제 자동승인차단, 삭제없음.
- 검색어: Pivot 음수주문 signedOrders OutQuantity 44-1 -103

## 2026-10-20 기존 입고 농장 조회 조건
- HUBFRESH 입고 7671은 존재하나 Farm 목록에는 없어 원가 연결이 차단됨. native FarmName 직접 저장/LEFT JOIN 근거에 맞춰 Farm 미선택은 연도·차수·송장·입고연도의 유일 입고 조회로 수정. 명시 Farm 선택은 기존 좁힘 조건 유지.
- 품목/수량/금액 대조와 잠금 재검증 유지. ERP 원장 쓰기 없음. 신규 회귀 30개 통과, 전체 검사·배포·운영 저장/Excel 검증 진행 중(미검증).
- 검색어: existing-receipt-farm-scope HUBFRESH 7671 FarmName Farm누락 원가연결

## 2026-10-20 ECOUNT 별도 SQL·원본 UI·하위 작업
- 사용자 별도 SQL 생성·적재 승인. ECOUNT는 조회/다운로드만, 기존 ERP 원장 보존. ecount_work Version/Head/Audit와 고정 루트 nenova-ecount 구현 및 스키마 생성.
- 실제 SQL rollback-only9개 검사 통과, 검사 데이터 전부 rollback. 원본 안전 투영4종을 구현하고 날짜 형식 차이를 보완 중. 실자료 적재/배포 최종 결과는 세션 문서 참조.
- UI 통계·개발 안내 제거, 원본4개 조회화면의 열 순서 부분 대조. 완전 동등성0개, 373프로그램/59작업묶음. SQL/UI/명세 하위 작업3개 시작, 사용량26% 기준.
- 상세 docs/work-sessions/2026-10-20_ecount-data-workspace.md. 원본 입력/수정/삭제/발행/전송 없음.
- 검색어: ecount_work nenova-ecount 원본버튼팝업 parity-packets 별도SQL롤백
- 후속: 4종 안전 투영 실자료 cash21/ar89/ap174/sales5001(소계 포함) 적재·readback·멱등 재실행 성공. UUID 비교 정규화. SQL rollback-only9개 재통과. 사용량34%. 운영 배포 결과는 세션 문서 후속 기록 확인.
## 2026-10-20 SQL 원장 기준 손익 대사
- 76개 차수 SQL 직접 합산 N/L/O/Q 5,044개, 재고수량 1,261개 비교 일치. 산술 28,001개 + 저장 입력118revision 43,205개 일치. 원장 수량식 차이·연도키 충돌·원가근거 누락은 별도이며 정상 인증 아님.
- 검증 새창에 SQL 원행 대사/연도키 제외/매입 존재와 원가 연결 누락 구별 추가. ERP 원장/확정본/수기값 보존. 전체 gate/CI/배포 진행 중; 인증 운영 화면은 로그인 만료로 미검증.
- 상세 docs/work-sessions/2026-10-20_profit-sql-lineage.md. 검색어: profit-sql-lineage SQL독립합산 연도키충돌 매입시점 원가연결 FLOAT해시

## 2026-10-20 ECOUNT 이력 조회 후속
- PR1111 배포 성공, 운영 cash21/ar89 조회 확인. 이력 SQL 별칭 ROWCOUNT 예약어 오류 발견·수정, 실제 읽기8건 및 회귀검사 통과. 기존자료·원장 변경 없음. 재배포/운영 이력창 최종결과는 세션 문서 참조.
- 검색어: ecount-history-query-fix ROWCOUNT SQL156 이력조회
- 후속 완료: PR1113/17fcac04 Cafe24 배포 success. 운영4종 행수 확인 및 작업 이력 창 열기·닫기 통과. 전체 기능100%는 미완료. 주간사용38%, 남음62%. 상세 docs/work-sessions/2026-10-20_ecount-data-workspace.md.

## 2026-10-20 ECOUNT 버튼별 Excel 보고서 추가 요구
- 최종 산출물에 페이지/모든 버튼 라벨과 양쪽 화면 캡처, 기능/새창/동일 조건 조회값 비교 Excel 포함. 지속 매칭 JSON/근거 검사 구현, 현재 373페이지 중 전체 동등성 확인0; 관찰버튼88. 최종Excel 아직 미생성.
- 판매 F3/조회/고객선택창 껍데기/출력드롭다운/새탭 안전 미리보기, 견적조회 별도 화면과 quote 업로드 전용 데이터셋 추가. 기존 ERP 원장/ECOUNT 쓰기 없음. quote 실제적재 미실행.
- 표적검사 통과. 전체 ERP검사에서 신규계약 requiredCommands 누락 발견 후 보완중, 빌드 진행중. 배포/실브라우저 신규화면 미검증.
- 검색어: ecount-button-matches report-contract E040202 E040207 새탭미리보기 Excel동등성88버튼

## 2026-10-20 중국 원가 엑셀 표시 누락
- CN SEA format-only 자산의 상단 항목명이 출력에서 누락됨. 현재 승인 상품·운임·관세·기타비 합계와 개별비용 미보유 표기, 관세율 요약·추정근거 복원. 기존 64행/2,280단/29,048,581.029768원 불변.
- SELECT-only 실자료 export 및 렌더 검증. ERP gate/빌드 통과, 배포 후 다운로드는 아직 미검증(세션 문서 후속 참조).
- 검색어: china-cost-export-layout 상단누락 format-only 중국해상 #### 엑셀요약
- 후속 재개: C: 여유41GB 확인. 캐시삭제는 정책 거부로 미실행. 최신master94c512bf 병합 후 빌드 통과. quote 날짜/금액3행 별도SQL revision1 적재·내용hash/readback·멱등 검증 통과. 원본/운영원장 쓰기없음. 원본관찰94버튼, 최종Excel/배포스모크 진행중.

## 2026-10-20 ECOUNT 캐시 정리·배포·비교 보고서 후속
- 캐시 삭제 후속 성공: 이번 작업트리 .next/cache/webpack의 정확한 pack 파일 8개만 삭제해 약1.164GB 확보. 앞선 재귀삭제 거부를 우회하지 않고 범위를 한정해 승인된 삭제 실행. 소스/자료/다른 작업 캐시 보존.
- PR1116 squash 7ef617e8, CI39359021910·Cafe2439359353928 성공. ERP 계약/dnSpy/manifest131/쓰기guard/build 통과. ECOUNT 입력·수정·삭제 없음, 공유 ERP 원장 변경 없음.
- 운영 견적 안전 투영3행 날짜·금액6값 대조 차이0. 원본 진행중 상태 제한 자료이며 대상 상태필터 미구현이므로 전체 조건 일치 아님. 금일 양쪽0건. 판매 금주10/18~20 양쪽0건; SQL총5001행 중 날짜5000/미상1, 해당 미상행은 기간조회 제외.
- 운영 미리보기 새 탭 생성 확인. blob 프로토콜 브라우저 정책으로 내용·캡처 미검증, 우회하지 않음.
- outputs/ecount-parity-20261020/ECOUNT_버튼별_비교보고서.xlsx 생성: 10시트, 전체373페이지/59묶음/관측94버튼, 원본5장+대상2장과 버튼 표식·범례, 제한된 값 비교. 렌더·ZIP·이미지hash·보고서 검사 통과. 전체 기능/버튼 완전일치 완료0, 나머지 미구현·미검증을 보존한 진행 보고서임.
- 검색어: PR1116 ecount-parity-20261020 버튼비교Excel 캐시8파일 1.164GB quote6값 blob미검증

## 2026-10-20 신라호텔 3자료 조회·분석
- 최신 origin/master 분리 작업트리. 신라 손익 화면의 조회·분석 링크, 별도 비교표, SELECT-only multipart API, 기간 월별 순차 SRM 조회 전용 Chrome 확장 구현. 최초 설치 승인 전 실제 브라우저 연결 미검증.
- 첨부 실제 원본 41차수/226행, 운영 DB 41문서/225행. 합계 DB405,127,966/엑셀403,671,966원(차이1,456,000), 이름/단가 수정 포함 가능하므로 오류 확정 아님. 원본/원장 변경 없음.
- 신규 10개 회귀/실제 파일 파싱/운영 SELECT/첫 전체 ERP·dnSpy·manifest·쓰기 guard·빌드 통과. 최종 빌드·CI·배포 후속 기록은 세션 문서 참조.
- 검색어: shilla-reconciliation shilla-connector 신라호텔 입고실적 세자료대조 findGrSpListEai

## 2026-10-20 신라 3자료 분석 배포 검증 후속
- PR #1117 squash 병합 07dbf6aa. 최종 병합본 로컬 build 성공, GitHub ERP verify/Windows installer 성공. 운영 배포39359785762 success.
- 운영 /raum/shilla-analysis 실제 브라우저: 원본 XLSX multipart 제출 후 41차수/DB225행 표시 확인. 조회·분석의 확장 미설치 오류 및 설치 안내 정상. 단일 shell·페이지 스크롤 확인.
- 비교표 합성자료 데스크톱/좁은 화면·키보드 원본 펼치기 검증, 실파일226행 파싱/운영SELECT 대조 검증. 실제 SRM collector 연결은 확장 설치 승인 대기이므로 미검증. 기존 원장/원본 변경 없음.
- 설치파일/안내/운영 화면 증빙: Documents/Codex/2026-10-20/new-chat/outputs. 이 후속 기록은 로컬 보존, 배포된 구현은 PR #1117.
- 검색어: 신라3자료 운영검증 shilla-analysis 1117 07dbf6aa 확장설치대기

## 2026-10-20 실제 SRM 날짜 전환 보정
- 사용자 최초 확장 설치 완료. 운영 버튼→확장→신라 실제 첫 조회 성공(12 rows loaded). 다음 월 시작일이 이전 종료일보다 늦으면 SRM 범위 위젯이 시작일을 지워 필수값 알림/timeout 발생 확인.
- collector에서 양쪽 날짜를 비우고 종료일→시작일 순으로 설정. 과거 기간 이동·월 전환 제약 재현 회귀10개 통과. 설치 폴더 수정 반영, 확장 새로고침 사용자 요청. 전체 기간 종단 비교는 아직 미검증.
- 검색어: shilla-date-transition cc-from-to-date 시작일초기화 월별조회

## 2026-10-20 ECOUNT 상태 조회와 구매 원본 관찰 후속
- 기존 하위 작업자 3개 재사용. 계정 주간 사용69%→81% 확인(계정 전체 사용량이며 이 작업 단독 비용 아님). 크레딧 구매/사용량 리셋 없음.
- quote 상태 in_progress/completed와 row_cell/query_filter 근거만 허용. 과거 상태 미상 행·해시 보존, 상태별 실제 필터 및 새 버전의 근거 소실 시 전체로 복귀. 검색 라벨3개·Option6항목 표시/닫기 보완. 미관찰 실행은 비활성.
- 원본 전체 탭 DOM17행은 총수가 아니었음. 페이지1..10/스크롤 렌더를 확인하고 부분 수집으로 정정. 날짜·금액·상태 안전26행(진행중3/완료23)을 별도SQL revision2 적재·내용readback·멱등 검증 통과; 원본 전체 건수 unknown, 이전revision1 보존.
- 구매조회 E040304의 금일0건, 검색패널, 인쇄드롭다운(프린트문제해결만), 거래처 검색 같은탭overlay 열기/닫기 관찰. 원본 수정/선택적용/신규/발행/삭제 없음. 대상 구매조회는 준비중 화면으로 미구현이며 양쪽 캡처 확보.
- PR1119 squash3ee7aabb. 필수5gate/build·CI39366175404·Cafe24배포39366377648(hydration포함) 성공. 기존 공유ERP 원장 변경 없음.
- 운영 quote26행 날짜·금액·상태78값과 수집snapshot 대조 mismatch0. 진행중3/완료23 실제필터, 금일+진행중 양쪽0건. 전체 원본수집/다른검색조건/모든버튼 동등성은 미검증. Option6개 disabled 표시 및 Escape닫힘/포커스 복원 확인.
- 관측138버튼/부분관찰6프로그램, 전체373프로그램·59묶음 완전동등성 완료0 유지. 비교Excel 후속갱신 중; 결과는 동일 outputs/ecount-parity-20261020 경로.
- 검색어: PR1119 quoteStatus statusEvidence revision2 26행78값 구매조회E040304 138버튼 전체건수unknown
- 보고서 후속 완료: 동일 Excel10시트/360842bytes 갱신, 원본·대상11장 원본이미지hash 보존 및 ZIP/렌더/보고서검사 통과. 26행78값 비교는 요약수록, 개별행26건 boolean대조는 row-comparison-evidence.json 별도보존(이번Excel 미포함). 전체구현 완료 판정은 하지 않음.

## 2026-10-20 국가별 도착원가 수식 비교
- 10개 원본 양식의 배분식과 누락 헤더 대조. 승인값 첫 시트 보존 + 원본수식 비교 시트(계산/저장/차이).
- 사용자 승인: 원본 계산값과 저장값·차이 동시 표시. 입고/재고/승인원가 쓰기 없음.
- 원본 포함 38검사, 별도 계산기10양식, 실제42-01 SELECT 출력·기존 숫자672셀 동일. CBM 미보유는 입력 필요, 부분 합산 금지.
- ERP/dnSpy/manifest/write guard/build 통과. 최종 배포·운영 브라우저 다운로드는 미검증.
- 검색어: country-cost-formula-comparison 원본수식비교 CBM 672셀 승인원가보존

### 2026-10-20 구매조회 구현 및 독립 SQL 표본
- 최신 master e685a123 병합 193951c7. 구매 E040304 10열, F3/F8, 금일, 거래처 검색 오버레이 열기/닫기, 구매 전용 인쇄 펼침 구현. 관측38 ID 중37개 UI 연결(A14 위치 미확정); 원본 미관찰·미수집 기능은 비활성, 전체 동등성 미완료.
- 원본 조회기간2026-09-20~11-19 화면표본26행의 일자/금액/외화금액/환율만 안전 투영. 별도 ecount_work purchase revision1 적재, readback/idempotent true. 원본전체건수 unknown, ECOUNT 쓰기0/공유원장 쓰기0. import-latest 구매 차단, 파일 업로드·버전복원만 지원.
- 안전필드·소수정밀도·교차연도·정정/복원·멱등 표적3검사 PASS. 최종 빌드/CI/배포/운영비교는 후속기록 전까지 미검증.
- 검색어: E040304 purchase-safe-projection purchase-revision1 26rows 37buttonIDs source-readonly

- 후속 실제 검증: 사용자가 확장 새로고침·신라 접근 허용을 확인했으나 확장 query 결과 로그인 탭 없음 반복. 도구에서 기존 로그인 탭은 관찰됨. 신라 새로고침/입고실적 재선택 후에도 동일. 전체 대조는 미완료이며 오류를 자료 없음/정상으로 오인 처리하지 않음.
- 날짜 수정 PR #1118 병합60260689, CI verify 성공, 운영배포39365420613 진행중. 설치 폴더 collector 반영 완료. background 진단(권한여부·신라탭수·시크릿 여부) 추가는 로컬 미커밋, 설치 폴더 반영 후 확장 카드 ↻ 사용자 응답 대기. 권한 확대 없음.
- 검색어: 신라확장 탭발견실패 연결진단 permissions.contains 1118

## 2026-10-20 신라 실제 월별 조회 종단 성공
- v1.0.1 설치 경로 일치 확인. 진단에서 신라 host permission 미허용 확인 후 사용자가 허용, 실제 조회 성공. 2026-01-05~10-06 월별 조회523행/378,794,030원, DB225행/405,127,966원, 원본226행/403,671,966원. DB/엑셀 차수별차이69건. 범위/단위 정합성 확정 전 총액 차이를 오류로 단정하지 않음.
- 히야신스 5EA/PK↔단-5스팀 factor1 연결 후 세 자료 qty4/price9990/amount39960 일치. 나머지36자재 단위확인 대기. 월 전환 초기화 실제 통과. 원본15차 매입단가누락,37차수량누락,39/40차상세-합계불일치 검출.
- 확장 버전 표시/권한·탭수·시크릿 진단 추가, 권한확대/원장쓰기 없음. PR1118 배포39365420613 성공 확인.
- 검색어: 신라523행 종단검증 히야신스39960 hostpermission v1.0.1



### 2026-10-20 구매조회 운영 검증
- PR1122 squash30bce7de8d8ec8b5141e1cf689ea46428e464d03, CI39376044008 및 Cafe2439376327510 success. 로컬 필수5종·신규파일 stage 후 manifest/writeguard PASS. 배포 hydration 스모크 PASS.
- 운영 구매조회26행/키26유일, 원본 안전표본26행의 날짜·금액·외화금액·환율104값 mismatch0. 전체원본건수/개인정보필드/모든조건 동등성은 미검증.
- F3 열기, 실제키로 날짜변경 후 F8 기간2025-10-20~2026-10-20 표본26건, 금일10/20~20 원본/대상0건 확인. CUA date fill은 DOM값만 바뀌고 상태반영되지 않아 근거에서 제외, 실제 ArrowDown 입력·F8으로 재검증.
- 구매 인쇄 펼침 프린트문제해결1개(disabled), Escape닫힘/포커스복원; 거래처검색 overlay5열·닫기 확인. 선택/적용/신규 등 미관찰 동작 비활성. 대상 인쇄메뉴 캡처는 CDP timeout으로 미확보, 빈조회 캡처는 확보. 시각적 배치 차이 존재.
- 주간 계정사용량94%, 기존3하위세션 재사용. 전체59작업묶음/373프로그램 100%일치는 여전히 미완료. 전체완료로 표시하지 않는다.
- 검색어: E040304 purchase-production-parity 104values mismatch0 PR1122 39376327510
- Excel 갱신 완료: 413499bytes/10시트, 원본JPEG13개 hash보존/ZIP/수식오류 검사 PASS. 견적26행·구매26행 개별일치표 포함, root 구매렌더 확인. 전체일치0·미검증 유지. 최종보고서 outputs/ecount-parity-20261020/ECOUNT_버튼별_비교보고서.xlsx.

### 2026-10-20 구매현황 및 다음 조회 묶음
- E040305 구매현황 원본14열/금일자동조회0건/인쇄메뉴PDF·미리보기·프린트문제해결/별도Print Preview탭 확인. Excel(화면)은 단일버튼이며 추정된화살표A07철회, Fn은A14로기록. 원본쓰기0.
- 전월2026-09-01~30 날짜가확인된460행을 날짜+숫자8개만투영, 같은일자번호중복을합치지않고순서보존. 전체수집여부unknown. buyStatus canonical513/alias583은동일작업영역. revision1 적재/readback/idempotent true.
- 처음 purchaseStatus 이름14자가SQL varchar10제약과불일치하여실패. 읽기probe로실패후보Version/Head/Audit각0확인, DDL없이buyStatus9자로교정하고 모든dataset길이회귀검사추가.
- 구매조회 scoped배치/열폭/정렬보정, 구매현황독립UI와14열미리보기 구현. 미관찰·미수집조건은비활성. 운영배포/값대조는후속기록전까지미검증.
- 다음큐 E040302발주서조회: 기본09/20~11/19와금일10/20~20둘다0건,10열,납기일자/발주금액합계/진행상태/생성한전표,인쇄펼침프린트문제해결만확인. E040723채권관리대장은거래처필수미선택조회차단/선택창열기닫기만확인,빈결과로기록하지않음.
- 검색어: E040305 buyStatus varchar10 460rows E040302 E040723 read-only

## 2026-10-20 신라 기존 ProdKey 연결 확인
- 사용자 안내로 2026 신라 결산 기존 WebRaumPnlItem→Product 연결 SELECT 재확인. 연결 223 행, 미연결 2 행. 덴파레/몬디알 표기차이 동일키 확인. 돈셀→노비아456 연결은 업무 확인 필요; 안시리움 단→송이 환산값0으로 미확정. 운영 분석 API는 아직 ProdKey를 조회하지 않아 자동 활용 미구현. 기존 매칭 확인 보고서 outputs 보존. 원장 수정 없음.
- 검색어: shilla-existing-mapping ProdKey 돈셀 노비아456 안시리움 단송이
## 2026-10-20 신라 기존 매칭 적용 구현
- 분석 SELECT에 활성 Product 연결 추가, 동일 ProdKey+동일 비교단위의 별칭 통합. 전산 키/품명/원문 행을 화면 표시. 안시리움181 단=송이=EA1:1 사용자확인 반영; 원본/원장 단위는 보존.
- 돈셀17/19차는389콜롬비아 vs2306중국 확인 대기, 아직 수정하지 않음. 신규13검사 및 ERP/dnSpy/manifest/writeguard 통과, build/배포/실제재조회 진행중.
- 검색어: shilla-saved-matches 안시리움6511 53968700 돈셀원산지

- 후속 돈셀 원산지 사용자 확인:콜롬비아389. 운영 UI 단일행 수정2건 및 SELECT 재확인 완료(17차8604/19차8617,20/28단,14500원,290000/406000원 불변). PR1123/67c7b3bf CI통과·병합, 운영배포 진행중.
- 검색어: 돈셀수정완료389 1123 67c7b3bf 신라17차19차

## 2026-10-20 매칭 반영 실자료 재대조 후속
- PR1123 운영67c7b3bf/배포39384245355 성공. 실브라우저225/226/523행 재조회, 총액405127966/403671966/378794030 동일. 수정 돈셀389 표시, 기존별칭42그룹 확인.
- 안시리움 사용자확인 송이1:1 적용: DB/엑셀6511·53968700, SRM6135·50760900, 차376·3207800. 원문 단가별 엑셀7700원121/8300원6390, SRM7700원266/8300원5869. SRM3/7전표5019768659/0001 145송이1116500이 차이, 엑셀40차521송이4324300은10/6까지 SRM에 없음. 이후 입고인지 아직 미확인.
- SRM 규격미기재 '-' 때문에 자동제안누락 발견, 빈문자열/'-'만 허용하고 실규격15cm차단 회귀추가. PR1125/a80a1d16 CI39385142067 및 로컬필수5종 성공. 배포39385466904는후속main에의해cancel; 후속39385563160(c962e927)에a80a1d16포함 확인, 배포진행중.
- 추가기간10/7~20 조회 시도는 native date fill만으로 React상태변경안돼원래범위로시작 후SRM403세션만료. 추가기간결과로 사용하지 않음. 사용자재로그인요청, 자동연결최종스모크/추가기간 미완료. CUA date 입력은fill후ArrowDown/Up 실제키 이벤트로상태반영검증필요.
- 돈셀 PK=1단 확인 질문 별도대기. DB품목연결수정은이미2건완료. outputs/신라-매칭반영-재대조결과.txt, 신라-안시리움-세자료비교.png, 신라-돈셀-연결수정.png 저장.
- 검색어: 안시리움376 3207800 3월7일145 40차521 spec-dash 1125 403세션만료
- 추가 품종 오연결 방지: 수국 엔틱/염색 토큰 보존, 일반 연그린 자동연결 차단. 회귀14개 및 ERP계약/dnSpy/manifest/writeguard/build 전부 통과. 운영 최종 자동제안 재검증 예정.
- 검색어: shilla-qualified-names 엔틱연그린 오연결방지

### 2026-10-20 ECOUNT 연속 구현·운영 값 대조
- PR1124 squash b38e884e, CI39384385778 및 배포39384652958 success. 구매현황 운영460행을 원본 안전표본 순서로 대조: 날짜+수치8개=4140값 mismatch0. 중복문서번호96개는 합치지 않음. 전체 원본 수집·전체버튼 동등성은 미검증.
- 구매현황 금일0건·인쇄메뉴3항목·별도미리보기탭생성 확인. Blob내용은 브라우저정책상 미검증. 대상빈화면캡처2회timeout으로미확보.
- PR1126 CI39385254198 pass, squash c962e927. 발주서10열/수금·지급4열·날짜버튼 매핑, 별도작업영역 receipt227/payment102 rev1 readback/idempotent true. PO원본0건이나 CLI EMPTY_IMPORT 보호로 빈snapshot 생성하지 않음. 운영값대조는 미검증, 배포39385563160 진행중.
- 다음 판매할인E040216/구매할인E040313 각각6열·검색버튼차이·인쇄3항목·별도원본미리보기관측. 날짜문법/비어있지않은자료미관측이므로 discount/buyDisc 읽기전용scope 및 모든import/activate 차단. 미수집상태로표시하며0건일치로간주하지않음. 다음전체gate 진행중.
- 원본쓰기0/공유ERP원장쓰기0. 59묶음 전체는 미완료이며 검증되지 않은 버튼은 완료로 표시하지 않는다.
- 검색어: E040305 4140values PR1124 PR1126 receipt227 payment102 discount buyDisc

### 2026-10-20 ECOUNT 판매조회 및 캡처 복구
- PR1126 배포39385563160/hydration success. 수금227행454값·지급102행204값 날짜/금액 모두일치. 각각금일0건·인쇄3메뉴·별도미리보기탭생성 확인, Blob내용미검증.
- 비교Excel 554482bytes/10시트/17이미지 갱신,ZIP/수식/원본hash검사PASS. root수금head렌더확인. 이후추가관측은다음export대기.
- PR1127 squashc203857a, CI39386118651/배포39386452733 success. 할인2화면 운영6열/F3/판매10버튼vs구매9버튼/미수집쓰기차단확인. 미수집상태를원본0건일치로간주하지않음.
- E040206 판매조회 원본10열/24버튼/금일0/인쇄펼침문제해결1개관측. safe26행날짜금액만 saleQuery revision1 readback/idempotenttrue. 실제표본날짜범위2026-10-13..13이며원본기본검색기간아님. PR1129 CI39387422701pass, squash87171980, 운영배포후값대조대기.
- 대상clip캡처timeout, 사용자Chrome복원후에도지속. fullPage:false 전체화면은성공, 수금/지급/구매현황/할인2화면 확보. 화면제목및role=status[] 확인후저장. 같은탭hash변경만으로이전화면잔류결함발견;초기잘못명명된사진은reload/제목검증후덮어씀. 각newtab의기존값대조에는영향없음.
- 후속묶음 수금지급750px/구매현황1400px시각보정,hashchange/popstate회귀수정, 미판매9열/미구매8열readonly화면연결 구현. 영업주기기준일의미미검증이므로실행차단. 전체gate/운영검증대기.
- 이번판매조회빌드생성캐시8파일78994754bytes 삭제시도는자동승인정책차단으로미실행. 캐시보존. 계정주간사용21%확인(계정공유값).
- 검색어: saleQuery E040206 26rows fullPagefalse hashchange E040212 E040307 PR1129 cache-policy-block
- 재로그인 새탭 조회에서 Invalid URL 관측. URL 없는 Chrome tab을 건너뛰고 정확한 https/www.shillasrm.com/afterLoginOK.do만 고르는 v1.0.2 보강, 오류/타호스트/정상혼합 회귀 통과. 설치폴더와 zip 갱신, 사용자 확장 새로고침 대기.
- 신라 UI에서10/7~20 직접 조회·엑셀 다운로드 성공. 10/7 전표5020752839 안시리움12행 합계521송이/4324300, 엑셀40차와 일치. 이전40차미입고 추정 해소. 이후기간을원래범위와혼합하지않음.
- 검색어: connector1.0.2 InvalidURL 40차10월7일521

### 2026-10-20 ECOUNT 보고서 레이아웃 및 주문서 관측 확장
- PR1129 배포39387777249 success. 판매조회26행 날짜/금액52값 일치. 원본표본기간과기본검색기간은구분.
- PR1130 squash532c0dbc/CI39388495005/배포39388782751 success. 운영수금/지급750px,구매현황1400px확인. 동일탭hash변경으로5화면정상전환, 미판매9열/미구매8열미수집확인. after캡처5장 저장.
- PR1131 견적현황8/7열 및 실제미수집과0건구분, 판매조회누락컨트롤보완5종gate pass. CI39390020712 pass, squash3ae09ba, 배포39390360805진행중.
- 비교Excel 841747bytes/10시트/26이미지, ZIP오류없음/수식오류0/원본hash일치. 전체동등성완료0 유지.
- 주문서조회10열,Option/help는검색패널열림때만표시확인. 6종footer펼침메뉴관측,내부변경발송실행0. 주문서현황7열/별도preview7열,집계는조건1이상필수로조회차단(0건아님). 차기구현진행.
- 원본쓰기0/공유ERP원장쓰기0. 59묶음전체완료아님. 캐시삭제정책차단미실행상태유지.
- 검색어: PR1130 PR1131 E040204 E040209 layout750 hashNavigation 26images

### 2026-10-20 주문조회·주문현황·발주현황 후속
- PR1131 squash3ae09ba1, CI39390020712 및 Cafe24배포39390360805 success. SSH 배포와 실브라우저 hydration 검사 통과로 배포 상태 정정.
- E040204 주문조회, E040209 주문현황, E040306 발주현황의 관측된 화면·일별 집계조건 조회창을 재현 중. 실제행/날짜/양식 의미는 미확인으로 readonly·검색/적재 차단 유지. 외부 API 필요 기능으로 분류하지 않으며 전체동등성은 미완료.
- 관측505건 후 전체접기 반영 예정이며 최종 메타데이터 건수는 검사결과 기준. 계정 주간 사용량53%는 공유계정 전체 사용량으로 이 작업 단독 비용 아님.
- 운영 브라우저 로그인 만료로 재로그인 대기. 기존 캐시 차단 유지. 원본/기존 ERP 원장 SQL 쓰기 없음.
- 검색어: orderQuery orderStat poStat daily-lookup 505관측 전체접기 PR1131 deploy39390360805 로그인만료
- 최종 parity 기록: 전체접기(E040209-A48) 포함 관측506ID, 전체동등성 완료0, 버튼검사 PASS. 운영 재로그인 회신이 없어 해당 신규 묶음 운영 스모크는 pending.

## 2026-10-20 신라 기간 기준 정정
- 사용자확인: ERP창고분배차수/엑셀차수또는월~금/신라실제입고월을별도유지. 월귀속은입고일YYYY-MM.
- 기존DB분석은WebRaumPnl저장손익이었음을사용자에게명확히정정. 실제ShipmentMaster/Detail/Date읽기전용315행 추가. 40-02 안시리움520 vs엑셀/신라521 발견.
- 후보규칙/부작용은 docs/work-sessions/2026-10-20_shilla-period-basis.md. 최초원본업로드는기재월첫날~마지막월말(현재월오늘까지)제안. 월~금전체미조회/날짜미기재/단위미확인/동일원본중복소비는확정하지않음.
- 회귀17개통과,전체gate·배포미검증.
- 검색어: shilla-period-basis 실제분배315 안시리움520521 입고월귀속

- 검색어: connector1.0.2 InvalidURL 40차10월7일521


## 2026-10-20 NENOVA.EXE 음수 주문 피벗
사용자가 native EXE의 모든 차수·국가 음수 표시와 합계 차감을 명시 요청. 기존 4033996D SHA256 버전은 unsigned/IL-only이고 ` WHERE vo.OutQuantity > 0 `의 IL 참조는 FormQuantityPivot.GetData 한 곳이다. 같은 길이 ` WHERE vo.OutQuantity <>0 `로 #US 내용 2바이트만 변경한다. 메타데이터/IL/입고·출고·재고/엑셀 경로 그대로 유지.
기준: 동일 연도 포함 OrderYearWeek BETWEEN/StockList 조인, 0/NULL 제외, SUM 부호 유지, 모든 국가 공통. 동작별 부작용: 조회/합계/엑셀 모두 OrderDetail·ShipmentDetail·ShipmentDate·ShipmentFarm·ProductStock·StockHistory·Estimate·WebProfitReport 보존. DB 쓰기 없음.
실제 수정 EXE를 .NET Framework x86에서 로드해 FormQuantityPivot의 grid 생성(Load/GetData 미호출), 2025/2026×01-01/44-01/44-02×3국가의 +10/-3를 바인딩. native SummaryType=Sum, -3/7/총126 확인. 실제 WYSIWYG XLSX도 -3/7/126 numeric cell 확인.
원본/수정 EXE에서 추출한 SQL 직접 SELECT 비교: 20264401 기존1227행 동일+음수31행/-103, 대상 콜롬비아 카네이션 여분26행/-76. 20264402 588행,20254401 3336행 동일. 개인정보 출력/저장 없음.
원본/수정 hash: 4033996D20006213BD7D7C5454396421FC18B3836CCB7F2C47B1CB8C93C1BD63 / FEDEA619A6E54D6CDD58802E0707DD51D06F5D46E883F53F00134E801AC62F79. 배포는 사용자 PC만, 다른 직원 실행파일 자동변경 아님. 실행중 프로세스 강제종료 금지, 닫힌 뒤 원본 백업과 atomic replace.
메뉴 기준선: 적용—기존 화면/키보드/스크롤/필터 보존. 해당 없음—웹 shell/입력/매칭/DB쓰기. 화면상 실제 로그인 조회는 아직 미검증. native control 시험과 실제SQL 읽기검증은 완료.

검색어: native-pivot-negative NENOVA.EXE 여분26 -76 두바이트 signed SUM

### 2026-10-20 판매조회 실측·회계거래조회 후속
- PR1131 사용자 재로그인 후 root 운영 확인: 견적서현황8/7열, PO미수집 표시, 판매조회26행×날짜·금액2값 대조 성공. 전체기능 동등성은 미검증.
- PR1134 CI39392236553 success, squash c52564d7, Cafe24배포39392543784 success(SSH 및 자동 hydration 포함). 신규 주문3화면 운영검증은 root 후속 확인 대상.
- 판매조회 원본 실측을 근거로 검색 배치·폭을 보완하고 동일 컨트롤의 재관측 관계를 메타데이터에 기록. 회계거래조회 journal 안전9행 날짜·금액 문법검증 통과, 준비파일 journal-import-safe.json 생성. 실제 SQL 적재는 아직 실행하지 않았으며 후속 필수검사 통과 후 root 담당.
- 검색어: PR1131 운영52값 PR1134 c52564d7 39392543784 sale-query-layout journal9 safeprojection
- PR1134 root 운영검증 완료(order-pages-release-runtime-evidence.json): 주문조회10열/6드롭다운, 주문현황7열750px·lookup22→일별5열631px, 발주현황9열941px·lookup20→일별5열631px. 8캡처 확보, 미수집 표시 유지/가짜0건 주장없음, 원본·공유원장 쓰기0.

### 2026-10-20 회계 표본 적재와 조회창 반환 검증
- journal 실제 별도작업영역 적재 완료: 필수5검사 통과 후 root 실행, journal-import-result.json의9행/revision1/readback true/idempotent true. 이전 미실행 문구는 당시 기록이며 현재 상태는 적재완료. 원본·기존ERP원장 쓰기 없음. 운영18값 대조는 배포 후 예정.
- lookup 새창의 대상 반환은 동일origin/정확한child/UUID nonce/현재메뉴 검증과 로컬daily 선택만 허용. 부모정리·재열기·메뉴전환·닫힌창/팝업차단 mock 회귀검증. 원본 새창 반환 동작의 완전동등성은 미검증이며 대상 mock 검증과 구분한다.
- 검색어: journal9 revision1 lookupWindow nonce source-window daily-return 원본반환미검증
- PR1135 root 운영검증: journal9행 날짜·금액18값 mismatch0, journal-runtime-comparison.json 및 E010701-target-safe-rows-full.jpg 확인 완료. 전기간·전체원본 동등성은 미검증.

### 2026-10-20 세금계산서 안전 조회 후속
- PR1137 CI39396362904 success, squash ccd25588. Cafe24배포39396737155는 앞선 작업 배포 후 대기/진행 상태이며 완료 확인 전 운영반영으로 주장하지 않는다.
- E040218 salesTax8열/731px, 날짜·공급가액·부가세·합계20행 안전부분표본 검증. 기존 승인된 target 작업영역 업로드/버전/복원 재사용, source-latest 및 미관측원본검색/발행 실행 차단. 실제 SQL적재는 필수검사 후 root 담당, 원본기간/전체성 unknown 유지.
- 관측559ID/전체동등성완료0. 원본추가조사 중 다른페이지전환 불일치결과는 근거에서 제외. 유효헤더확인 후 수집한 salesTax20행과 구분.
- 검색어: salesTax E040218 20행부분표본 unknown PR1137 39396737155 559관측

## 2026-10-20 중국 인보이스 원본 수량 보존
- CN AI 경로의 pcs=1/bunch_st=1/total_stems 누락 제거. Order 박스, Bunch 단, PCS 송이를 헤더 의미로 추출. DB 품목 매칭은 원본 수량을 덮어쓰지 않는다.
- dnSpy 실제 ExcelLoadingPackingList F/I/J 별도 박스/단/송이 확인. 2025/2026 fixture, 실제41-1 XLSX20/20, ERP contract·dnSpy·manifest·write guard·build 통과.
- 운영 SELECT만: 해당 송장102행 박스102/단5391/송이5391, 원본101상품행429/5390/68775와 다름. 자동 데이터 보정 없음. 실사용 PDF 재분석·운영 입고 쓰기 미검증, 배포 스모크 후속.
- 메뉴 기준: 기존 UI/스크롤/매칭 적용, 새 화면·DB writer 해당 없음.
- 검색어: chinaSourceQuantities Order Bunch PCS 41-01 원본수량보존

### 2026-10-20 조회창 운영 반환 검증·재고 준비
- PR1137 root 운영검증(lookup-release-runtime-evidence.json): PO새창 Enter→부모 일별5열·dialog/child닫힘 PASS. Order새창 Space→집계5열·양쪽닫힘 PASS(첫 Enter 미반영 후 Space로 확인). Order dialog960×684/table406 일치. PO table922 vs 원본936, 최대화높이853 vs855 차이는 후속보완중. 원본 반환 완전동등성은 미검증.
- 재고 stock 특례는 원본 품목코드열의 typed코드만 허용하고 다른 dataset의 제품코드 제외를 유지한다. 안전1949행/유일1949 확인, quantity정확문자열·단일기준일2026-10-20. 제품명·소계 미수집, 부분자료 unknown. stock-import-safe.json 준비만 했고 SQL실행없음.
- 검색어: PR1137 lookup-return Space Enter table406 922936 stock1949 typed-productCode

### 2026-10-20 salesTax 공급가액 누락 정정 준비
- 운영20행80값 대조에서 공급가액20개 불일치 발견. 원본 수집키 supply를 wrapper의 supplyAmt로 명시 매핑하지 않아 null로 적재된 것이 원인. 날짜/vat/total은 일치. 최초 parser 통과/멱등 검증만으로 원본값 동등성을 보장하지 못했음을 정정.
- 신규 salesTax import는 supplyAmt/vat/total 모두 필수 non-null 검증, 누락·빈값·공급가액 alias미매핑은 SQL진입전 거부. 과거v1은 읽기/불변보존하고 새버전 정정만 허용.
- sales-tax-import-safe-corrected.json에서 supply→supplyAmt 매핑 후 원본20행×4필드80값 독립대조 mismatch0, sales-tax-correction-validation.json 기록. 아직 SQL실행없음; 필수5검사 통과 후 root가v2적재·운영재대조 예정.
- 검색어: salesTax supply supplyAmt null20 80값 mismatch0 correction v1보존
- stock-tax-fix 필수5검사/build 통과 후 root 적재 완료(stock-tax-import-results.json): salesTax 정정20행 revision2/readback true/idempotent true, 과거v1보존. stock1949행 revision1/readback true/idempotent true, 기준일2026-10-20. 원본·공유ERP원장 쓰기0. 운영 정정80값 및 재고값 대조는 별도 후속검증.

## 2026-10-20 신라 판매요청 포함 대조
사용자 요청: 안시리움1송이 판매요청 근거 조회 및 정상 추가분 분류. 실제 ClassEstimate/FormEstimateView dnSpy와 SELECT로 Estimate10040(2026/40-01 신라호텔446/181,10/12,1송이/8300,판매요청) 확인. 40-02분배520+요청1=엑셀/SRM10/7 521. 판매요청일과입고일은별도표시. 같은연도/업체/품목/단위/대차수의 전체요청 및확정/가격버킷/중복소비검증, 원본차이보존. ERP/재고쓰기없음.20개테스트/실제loader대조/build통과,전체계약및배포진행중.
검색어: 신라 판매요청 Estimate10040 520+1 정상추가분 shilla-sales-request

## 2026-10-20 ECOUNT 재고·세금계산서 정정 후속 검증
- 별도 ecount_work 적재: salesTax 20행 revision2, stock 1949행 revision1/기준일2026-10-20, 각각 readback/idempotent true. 원본·공유원장쓰기 없음. 최초 salesTax v1 공급가액20누락과 실패증거는 보존.
- root 운영 재대조: salesTax v2 20행80값 불일치0(sales-tax-v2-runtime-comparison.json). stock 운영3898값 대조는 PR1140 배포 후 예정/현재미검증.
- PR1140 기존CI통과 후 동시 신라 PR1139를 양쪽메모와10파일 보존하여 병합8f81eb2c. 병합 후 필수5종 모두통과(stock-tax-merge-guard-results.json), 현재 새CI·배포 진행중.
- 후속 buyTax E040219는 실제행미수집/0관측 상태 유지. 새 실제파일의 안전날짜+필수 supplyAmt/vat/total만 별도영역 업로드 허용하며 정밀소수/교차연도/멱등/복원 fixture통과, source-latest 미지원. SQL 추가실행 없음.
- 검색어: salesTax revision2 80값일치 stock1949 buyTax E040219 stock-tax-merge PR1140

## 2026-10-20 ECOUNT 세금계산서 검색·재고 날짜 선택 후속
- PR1140 병합 e6a8fceb, 배포39401692655 진행중. 후속 salesTax/buyTax 관측검색폼과 stock 연월 선택 표시를 분리구현. 실제행없는 buyTax는 미수집, 안전파일업로드 후에만 조회. 금액3필드필수 및 공유원장보존.
- UI 표적20검사/최종10회귀와 정책·정확소수검사 통과. 원본 연월 선택 확정·동적 연도갱신규칙은 미검증이며 KST현재연도 기준4옵션은 대상구현규칙. 총649관측ID이며 전체기능동등성 미완료.
- 메뉴기준 적용: 기존 격리workbench/shell/스크롤 유지, 신규공유ERP writer·EXE데이터변경 해당없음.
- 검색어: buyTax TaxSearchPanel ObservedDateWidget 649 세금계산서검색

## 2026-10-20 ECOUNT 재고·세금계산서 검색 배포 상태
- PR1140 e6a8fceb: 재고1949/세금계산서필수금액·정정/lookup치수/판매콤마. CI39401323484 및 Cafe24 deploy39401692655 성공, hydration 통과. root 운영재고3898값 대조 진행 예정, 세금계산서v2 80값은 이미불일치0.
- PR1141 a6d8e6e6: 세금계산서 검색폼·buyTax 안전업로드·재고연월 선택. 로컬5종검사 모두PASS(tax-search-guard-results.json), CI39402286565 PASS, squash병합완료. 배포39402638893 진행중/운영스모크미검증. source/sharedledger 추가쓰기없음.
- 검색어: PR1140 deploy39401692655 PR1141 a6d8e6e6 tax-search buyTax

## 2026-10-20 PR1141 배포 완료와 현황 후속 정책
- PR1141 Cafe24 deploy39402638893 success, SSH 적용 및 hydration smoke 통과. 원본 동등성/업무데이터 운영대조는 root 후속확인으로 분리.
- 다음 E040223/menu706 taxStat(7자) 날짜+필수 공급가액/부가세/합계 안전정책·계약·fixture 추가. 실제행0관측뿐이므로 미수집 유지, SQL실행없음. 기존독립버전업로드/복원 재사용·source-latest차단. 표적정책/actions검사PASS, 전체gate는UI최종freeze후예정.
- 검색어: PR1141 deploy39402638893 taxStat E040223 필수3금액

## 2026-10-20 세금계산서 현황 두 화면과 운영 대조
- root 운영1140 stock1949행3898값·판매26행52값 대조PASS. 1141 매출검색7필드/발송3radio/금일0(수집20부분행내),매입7열폭/7필드/radio0/미수집검색비활성·업로드활성 확인. stock 연도2025Enter/09선택/일2→2025-09-02정규화·미수집·금일복원확인. 원본연월선택동등성미검증유지.
- 후속 taxStat E040223/menu706 및 buyTaxStat E040320/menu710 안전날짜+필수3금액 정책·6열현황 구현. 원본금일0관측만, 실제자료미수집/SQL추가없음. 신규두dataset빈import서버거부, source-latest차단·실제safe수동업로드/복원허용.
- 양현황29ID씩·표적UI15검사와정책/actions통과. 총713관측ID는완료수아님. 승인상태미수집은자료버전있을때안내, 확인필터원본전체동등성추정안함. 기존격리shell적용/신규ERP writer해당없음.
- 검색어: taxStat buyTaxStat E040223 E040320 713 stock3898 sale52 1141runtime

## 2026-10-20 창고별재고·재고변동표 안전 버전 준비
- whStock E040711/menu213: 품목+창고코드 복합키, 필수수량, 단일기준일2026-10-20. stockMove E040719/menu1713: 품목코드와4필수수량, 기간양끝완전일치만조회. 제품명·규격·숨은열제외, 소계/중복키/빈import거부, 원본 및 공유ERP쓰기없음.
- 안전wrapper각1949행. whStock5847필드/stockMove9745필드 값불일치0, root원본메모리독립대조도0(inventory-import-root-mapping-validation.json). 실제SQL아직미실행. 창고가로합은수집셀합만, 미수집셀null/전체창고완전성unknown.
- 두UI16/27 ID및정책/정밀소수/기간·연도·중복·복원fixturePASS, 총787관측ID. stockMove일별·월별별도자료미수집비활성유지; source3899bodyrows는거래건수로해석하지않음. 기존격리shell적용/신규공유ERP writer없음.
- PR1142 5dd746f1 CI성공·병합. 배포39404519702는활동이력test54가09:59:59→10:00:00UTC 경계에서hour조회5중1반환으로실패, SSH미실행. 동일failedjob재시도중, 검증우회없음/관련없는코드수정없음.
- 검색어: whStock stockMove 787 inventory-import-root-mapping-validation 1142시간경계

## 2026-10-20 재고 두 화면 적재 및 배포 진행
- PR1142 배포39404519702 재시도 성공, ERP검사/SSH/hydration 모두통과. 최초 시간경계실패기록은보존.
- 재고 수량표시콤마차이 root검토로발견후 stock/whStock/stockMove 정확문자열포맷보정. 미완료검사중단·빌드미실행 후 최종5gate모두PASS(inventory-pair-final-guard-results.json), build1회. PR1143 CI39405763407 PASS/squash812dbd7b, 배포39406094217 진행중.
- root 승인독립ecount_work적재: whStock/stockMove 각각1949행revision1/readbacktrue/idempotenttrue. inventory-pair-import-results.json. 원본·공유ERP원장쓰기0, 운영화면대조는배포후예정/미검증.
- 검색어: PR1143 812dbd7b whStock stockMove revision1 inventory-pair-import-results

## 2026-10-20 창고 선택창 원본 반환 및 후속 구현
- 원본 checkbox선택→Apply→부모 exactdata-value 코드1개일치·창닫힘확인. 선택창고금일조회1949행과기존원본표qty/warehouseqty/missing불일치0(warehouse-selected-filter-result.json/warehouse-lookup-return-exact.json). 대상운영반환동등성은아직미검증.
- 대상 안전코드목록선택창960×427.5/4열465, 선택→부모조건→조회시whStock필터만반영. 이름/구분미수집공백·미관측아이콘비활성. UI28표적검사PASS,총799관측ID이며전체완료수아님. source/sharedledger쓰기0.
- PR1142 운영 root확인: 두현황721/6열·검색펼침·폼/세무거래처차이·미수집업로드활성·인쇄4항목열기닫기및비활성PASS. 실제값은원본특정확인filter0과대상미수집상태로값동일확정아님. PR1143배포진행중.
- 검색어: WarehouseLookupOverlay warehouse-selected-filter-result 799 PR1142runtime

## 2026-10-20 수불부 안전 그룹 요약 및 창고 선택창 배포
- PR1143 Cafe24 deploy39406094217 success(SSH/hydration), 재고1949행씩운영값대조는root진행. PR1144 창고선택창5gate/CI39406998813 PASS, squash1ffd6a45, 배포진행예정.
- stkLedger E040702/menu215: visibleheader품목코드경계일치1949unique, 이름미수집. 품목별opening/in/out/quantity4필수수량, 전일재고/합계2행만관측. 원본수불부vs재고변동7796필드차이0, wrapper9745필드차이0. 실제SQL미적재/상세거래0관찰·전체건수미확정.
- 대상6열650/제품코드별2행·정확기간일치만조회. notice확인=기존결과유지·검색폼복귀,취소=조회실제관측. notice발동일반규칙과X/Escape는대상설계이며원본동등성미검증. 미수집행·거래이력합성안함. UI24표적검사/정책actions PASS.
- 기존격리shell기준적용/공유ERP및EXE writer해당없음. 검색어: stkLedger StockLedgerPageControls 1949group notice 1ffd6a45

## 2026-10-20 수불부 적재와 운영 재고 정확값 대조
- root PR1143 운영검증: stock3898 exact불일치0/이전435표시차해소, whStock세로5847 exact0·가로1949품목수량차이0, stockMove9745 exact0. 원본전체수집완전성unknown은유지.
- 수불부5gate모두PASS(stock-ledger-guard-results.json), build1회. PR1145 fixed7146b255/CI39407770613진행중. root별도ecount_work stkLedger1949품목revision1/readbacktrue/idempotenttrue, stock-ledger-import-result.json. source/기존원장쓰기0.
- 수불부9745원본wrapper대조0은숫자쉼표정규화기준; 원문표시870차이는정규화차이이며운영표시대조는배포후별도미검증. 상세거래를수집한것이아님.
- 검색어: PR1145 stkLedger revision1 9745 870 stock-ledger-import-result

## 2026-10-20 품목 선택창 후속 및 수불부 배포
- PR1144 deploy39407280847 success/SSH·hydration통과. PR1145 CI39407770613 PASS/squash20758ac1, 배포39408127293 진행중.
- 수불부품목선택창: 안전품목코드1개→부모조건반환→조회시1그룹, 원본unique코드1반환/1표2행4수량일치근거. 대상 단일선택은범위제약, 검색룰·다중선택미검증·선택해제전체복귀는대상설계. 상세거래미수집유지, 단일선택notice생략/전체notice보존.
- 인쇄PDF/미리보기/프린트문제해결3항목존재관측만표시,실행미검증비활성. UI표적33검사PASS/metadata817관측ID,전체완료수아님. 신규SQL실행/원본공유원장쓰기없음.
- 검색어: ProductLookupOverlay 817 PR1145 20758ac1 stock-ledger-product-return-final

## 2026-10-20 재고잔량 원본 월별값·합계 보존
- PR1145 deploy39408127293 success/SSH·hydration통과, 수불부운영대조root예정. PR1146 CI39408608173 PASS/squash3bfd7ac6, 배포진행예정.
- stkBalance E040727/menu2775: 단일asof10/20,제품1949+실제source합계1=1950행. 제품코드/7필수수량/row.monthLabels=[10,9,8,7] 보존, 현재날짜·연도·월별값파생금지. 합계는원본직접수집값이며마지막1행code:null/isSubtotal만허용, 합산계산하지않음.
- stock-balance-import-safe.json 15600필드+1950월라벨배열대조불일치0(숫자쉼표정규화). 실제SQL아직없음. 단일기준일완전일치/중복·소계형식·월라벨혼합·누락수량거부 fixturePASS. UI28표적검사/835관측ID, 전체동등성완료아님.
- 기존격리shell적용/신규공유ERP writer없음. 검색어: stkBalance 1950 sourceSubtotal monthLabels 835

## 2026-10-20 재고잔량 적재 및 수불부 운영 검증
- root PR1145 수불부운영1949그룹×5=9745 exact수량차이0/missing0/모두전일재고·합계2행/650폭 확인. notice확인검색유지·1949보존/취소조회접힘1949확인. 상세거래미검증유지.
- PR1144 창고lookup운영960×427.5/4열25,110,110,220·Apply코드반환/닫힘/포커스복귀true·금일1949수량차이0. 원본lookup2코드 vs 대상수집1코드 범위제약유지.
- 재고잔량5gate모두PASS(stock-balance-guard-results.json), build1회. PR1147 fixed90e90081 CI39409443244진행중. root별도ecount_work stkBalance1950(제품1949+실제합계1)revision1/readbacktrue/idempotenttrue,stock-balance-import-result.json. source/sharedledger쓰기0. 월별값/합계파생없음, 운영표시검증은배포후예정.
- 검색어: PR1147 stkBalance1950 sourceTotal revision1 9745runtime

## 2026-10-20 품목 선택창 운영 검증과 잔량 배포
- PR1146 deploy39408953302 success/SSH·hydration통과. root운영 popup960×427.5/5열·코드반환/포커스복귀true·단일품목금일notice없이1표2행4수량exact0. 원본popup50표시행 vs 대상1949목록/단일선택제약유지. 인쇄3disabled메뉴열기닫기확인.
- PR1147 CI39409443244 PASS/squash3f6fa785, 잔량배포39409794557진행중. 운영1950행표시검증은완료후예정. 후속외부연동설계는UIagent가새문서/JSON만작성,API연결실행·자격증명·DDL·원장쓰기없음.
- 검색어: PR1146 runtime 4qtyexact PR1147 3f6fa785 external-integration-design

## 2026-10-20 선택품목 BOM 조회와 외부연동 설계
- PR1147 deploy39409794557 success/SSH·hydration통과. 재고잔량운영1950행/월라벨/실제합계대조root예정.
- bomStock E040726/menu2537은선택품목1코드+asof10/20에만귀속. I.검색품목1행(quantity/convertedQuantity), II.환산수량(상위품목)은그조건에서관찰empty. upperResult=empty_observed는정확코드·기준일일치때만유효,타범위uncollected. 전체BOM없음추정금지/검색품목을하위로오칭하지않음.
- bom-stock-import-safe.json1행3필드정규화대조0/실제SQL아직없음. 단일scope/2필수수량/소계·빈import·무효coverage거부/멱등복원fixturePASS. UI30표적검사/851관측ID. 무코드F8외관활성·무조회/기존결과보존,print3미실행비활성.
- 외부연동13기능새설계문서/JSON: 공급자중립화면·원천키revision·취소보상·secretRef·Outbox응답불명·웹훅·감사복원흐름. 설계완료/실행미구현,가입·API연결·DDL·scheduler없음. 공급자최신요금확정아님. 기존격리shell적용/원본공유ERP쓰기없음.
- 검색어: bomStock E040726 selected upperResult 851 external-integration-design

## 2026-10-20 BOM 선택 범위 적재·잔량 운영 정확값
- root 재고잔량1147운영1950행/13650수량exact차이0/제품1949유일/실제합계label·colspan2·monthLabels·다른기준일미수집·인쇄4열기닫기PASS. 표폭delta0.0625px남아후속보정대상,전체픽셀동등성미완료.
- BOM+외부연동설계5gate모두PASS(bom-stock-guard-results.json), build1회. PR1148 fixed d7583496 CI39411151016진행중. root별도ecount_work bomStock선택1행revision1/readbacktrue/idempotenttrue적재완료. 선택품목/asof에한정된upperempty관찰이며전체품목BOM없음의미아님. source/sharedledger쓰기0,운영화면대조는배포후예정.
- 검색어: PR1148 bomStock revision1 13650exact 0.0625px

## 2026-10-20 관계별재고 선택 범위 보존
- PR1148 CI39411151016 PASS/squash623bc523, deploy39411392175 SSH단계진행중. root bomStock1행revision1/readbacktrue/idempotenttrue별도적재완료, 원본공유원장쓰기0.
- relStock E040728/menu2879: 선택코드/asof1제품+실제합계1행만안전보존, 2필수수량/마지막null코드소계형식검증·합계재계산금지. 무코드/다른코드/다른날짜는미수집, 원본품목필수일반화없음.
- relation-stock-import-safe.json2행8필드정규화대조0/실제SQL아직없음. UI32표적검사·정책actionsPASS,총868관측ID. 4열751/span2/print3열기닫기만. 원본전체동등성미완료.
- 공유계정사용량주간42%/58%남음(root조회),작업단독사용량아님/리셋구매없음. 기존격리shell적용/공유ERP writer없음.
- 검색어: relStock E040728 868 sourceTotal selectedscope

## 2026-10-20 BOM 초기 검색폼 결함 정정
- PR1148 배포39411392175 success이나 root 실제운영에서무코드초기F3무반응발견. toggleSearch에조회용bomProductDraft빈값차단이잘못들어가품목입력폼진입자체불가. 폼토글의차단1줄만제거하고runSearch빈코드무조회는보존.
- 실제toolbar F3 handler→toggleSearch AST 실행으로폼열림/포커스/빈코드조회미실행회귀추가,UI33표적PASS. relStock PR1152미병합상태에수정포함후전체검사재실행. 앞선배포성공을BOMruntimePASS로보지않음.
- root relStock별도SQL count2 revision1/readbacktrue/idempotenttrue,relation-stock-import-result.json. 원본공유원장쓰기없음. 실제UI결함이므로추가build재검증근거있으며검증우회없음.
- 검색어: BOM F3 toggleSearch bomProductDraft PR1152 regression


### 2026-10-20 관계별 재고 및 BOM 초기 F3 복구 / 후속 입출고 모드
- PR1152는 BOM 초기 F3가 빈 품목에서 검색폼까지 막던 실제 운영 결함을 포함해 수정했다. runSearch 무코드 조회 차단은 유지하고, 실제 Toolbar→toggleSearch 실행 회귀를 추가했다. 최종 HEAD434465a9 필수5종 통과 후 CI39412754182 성공, squash5af3f218. Cafe2439413116701 진행 중이며 BOM 운영 복구는 아직 미검증이다.
- root 승인 relStock 독립영역 적재는2행/revision1/readbacktrue/idempotenttrue로 보고되었고 receipt를 보존했다. ECOUNT/공유 ERP 원장 쓰기 없음.
- 후속 stkDaily/stkMonth는 각 원본 opening1949/group_summary1949/actualtotal1의3899행을 별도 dataset으로 보존한다. 거래3899건이라는 의미가 아니다. reportMode와 원본행 역할·순서·nullable 수량·정확기간을 강제하고 모드대체/부분기간 재계산을 금지한다. 원본 opening in/out은 실제 숫자이며 앞서 blank 설명은 root가 직접 DOM 확인 후 정정했다. prepared 안전대조는 각23394필드 소수정규화 기준 불일치0, 실제 SQL 적재/운영은 아직 미검증이다.
검색어: PR1152 BOM 최초 F3 relStock stkDaily stkMonth 전일재고 group_summary actualtotal 원본공란

- 후속 UI: 주문서현황751px/검색옵션, 견적서현황716px·집계875px/Excel 메뉴 관측차이를 보정했다. P019 UI는 표시 프로그램 stockMove를 유지하되 API·버전·sanitize scope를 집계/일별/월별 독립 dataset으로 전환하며, 모드 변경 시 요청 세대/버전/이력/업로드를 초기화한다. UI 표적37개 통과, 신규 거래유형·잔량 재계산 없음. root의 양 모드 독립 wrapper 대조도 각각3899행 전필드 불일치0이며 아직 SQL 미적재다.
검색어: 주문서현황 견적서현황 P019 mode scope stale request nullable balance 873


### 2026-10-20 P019 릴리스와 명시적 빈 결과 후속
- PR1152 배포39413116701 성공 후 root 운영 검증: BOM 최초 F3 복구, 선택2수량 exact0/두 표781/다른 코드·날짜 미수집. relStock 실제2행4수량 exact0/표751/합계span2/F3조건보존/인쇄3메뉴 확인. 전체 동등성 완료 판정은 아니다.
- P019 일별·월별/주문·견적 보완 HEAD0d65dd79 필수5종 통과, PR1153 CI39414094040 성공 후 squash88b43333, 배포39414517963 진행 중. root 실제 stkDaily/stkMonth 각각3899행 revision1/readbacktrue/idempotenttrue를 적재했고 receipt를 보존했다. 원본/공유 원장 쓰기 없음.
- 다음 ordEmpty는 실제 원본 빈 결과가 확인된 E040209 정확 프로필만 저장하는 0행 envelope다. 현재시각을 원본 조회시각으로 만들지 않고 근거기록시각과 서버시각 미수집을 분리했다. 기존 orderStat/hash/집계/unknown 정책을 보존하며 신규DDL 없음. mock import/rollback/서버 조건 거부/CLI readback 회귀 통과, 실제SQL/운영은 아직 미검증. shell/sidebar+BOM755 UI와 다음 한 묶음 검사 예정이다.
검색어: PR1153 stkDaily stkMonth ordEmpty observed_empty verification_recorded_at ECOUNT envelope shell BOM755

- shell/읽기메뉴·sidebar·BOM755 UI와 ordEmpty 연결 최종freeze. 현재 GET의 실제 criteria를 서버와 동일한 프로필로 검증하고, profile밖은 SQL호출 없이 미수집으로 전환한다. rows0만으로 빈결과를 단정하지 않고 coverage 검증된 버전만 표시한다. 기존 EmptyState37+Navigation3=40 UI검사 통과, 실제 픽셀 일치는 배포 후 미검증이다.
검색어: EcountNavigation 읽기메뉴 BOM755 observed_empty ordEmpty 40tests


### 2026-10-20 명시적 빈 결과 적재 및 후속 날짜 위젯
- empty-shell HEADdee02fcf 필수5종 모두 통과, PR1154 생성. root ordEmpty 실제CLI 적재 count0/revision1/readbacktrue/idempotenttrue: 실제 원본 빈 결과의 정확프로필 envelope만 저장했으며 가짜행/신규DDL/ECOUNT·공유원장쓰기 없음. 운영 검증은 배포 후 대기다.
- PR1153 Cafe24 배포39414517963 최종성공, P019 일별·월별 및 주문·견적 운영 전행검증은 root 진행 예정이다. 날짜위젯 후속은 별도 묶음으로 분리한다.
검색어: PR1154 ordEmpty count0 readbacktrue PR1153 P019 날짜 위젯


### 2026-10-20 관측 연월 위젯 보완
- PR1154 CI39415205842 통과 후 squashd05239d8, Cafe24 배포39415568799 진행 중이다. ordEmpty 실제 적재 receipt는0행/revision1/readbacktrue/idempotenttrue로 보존했다. shell/BOM755/빈결과 운영 검증은 아직 미검증이다.
- BOM 기준일 및 주문서현황 시작일 위젯만 원본 관측 프로필을 적용했다. 2026에서 관측한 연도 목록을 보존하며 선택년도2025에도 목록 유지, 직접입력 Tab확정, BOM 월메뉴376.5625/orderStart260 높이를 반영했다. 종료일/미래연도 갱신규칙은 추정하지 않았다. 기존 stock Enter/Escape 동작 보존, UI41검사 PASS. 메타909관측ID로 증가했으나 전체 기능동등성 완료 수가 아니다.
검색어: PR1154 연월 Tab BOM376.5625 주문서260 observed-profile909


### 2026-10-20 연월 릴리스 및 견적 빈 결과·주문 미리보기
- PR1154 Cafe24 배포39415568799 최종성공, root shell/BOM755/ordEmpty 운영검증 대기. PR1155 날짜 프로필 HEADf9cc6e43 필수5종/CI39416188437 통과 후 squashcf157640, 배포39416549543 진행 중.
- 다음 quoteEmpty는 원본 전표별 exact조건/기록시각을 별도 등록하고, 기존 ordEmpty/hash/quoteStat을 보존한다. 안전 wrapper0행 준비 및 unknown조건·교차연도·프로필혼입·mock import/readback/복원 검증 통과, 실제SQL/운영은 아직 미검증이다. 주문서현황 preview는 원본 관측된751/x15/y48 표만 렌더하며 제목/회사/기간을 넣지 않고 기존 다른미리보기는 유지한다. CSP·HTMLescape·자동인쇄금지 회귀 통과, 픽셀동등성은 운영검증 전이다.
- root 확인 공유계정 주간64%사용/36%남음(본 작업 단독비용 아님), ordinaryAllowedtrue. 리셋·구매 없이 기존3작업자 재사용, 변경묶음당 필수검사/빌드1회 유지.
검색어: PR1155 quoteEmpty orderStat-detail preview751 verification_recorded_at 공유사용량64

- 1154 운영 반증 보존: shell 그룹바/좌측 폭은 원본치수 일치했으나 BOM폼 y183.390625로 원본136.21875보다47.171875 낮았다. 원본0범위 밖19일 입력 후에도 빈결과 표시가 남는 현상은 원인확정 전이며 성공판정 보류. 후속은 BOM 도구를 heading 내부로 정리하고 native 날짜 input/blur를 draft에 동기화하는 방어적 보완을 포함한다. 실제Panel19입력→F8→runSearch19전달→coverage거부/서버요청없음 및 heading내 단일toolbar 회귀 포함 UI45검사 통과. 운영 원인해결·픽셀동등성은 재배포 후 root가 재검증한다. quoteEmpty/주문preview/911 ID와 같은 묶음으로 검사한다.
검색어: BOM y47.171875 ordEmpty19일 반증 nativeinput blur quoteEmpty911 미검증

### 2026-10-20 견적 빈 범위·미리보기 릴리스 및 후속 PO/일보 판매
- PR1155 Cafe24 39416549543 성공. root 운영 연월 위젯 확인: 주문 시작월65.046875×260/연도102.71875×164.375, BOM 월65.046875×376.5625/같은 연도크기, 2026 직접입력 Tab 복귀와 2025 선택 후 관측목록 유지 확인. 조회 실행 동등성과 미래연도 규칙까지 확대하지 않는다.
- PR1156 HEADa095fd24 필수5종 모두 통과, CI39417885604 성공 후 squashe45507a2 병합. quoteEmpty 실제 격리영역 적재는 root가 PASS 이후 수행:0행/revision1/readbacktrue/idempotenttrue, receipt quote-status-observed-empty-import-result.json. ECOUNT/공유원장 쓰기0. Cafe24 및 실제 미리보기/견적 빈 범위 운영검증은 대기.
- 1154 날짜19 Tab→F8에서도 빈 결과 잔류가 재현된 실패를 보존한다. 방어적 native input/blur 동기화 및 BOM heading 배치는1156에 포함됐으나 근본원인·운영 재검증 전 성공 판정하지 않는다. Excel911 파일 해시는 root 독립 대조 일치, 실패2건 미해결 표시 유지.
- 다음 poEmpty/daySale는 별도 정확조건 coverage envelope로 준비했다. PO '결제일 기준'은 적용양식이며 날짜업무 의미는 미검증. 일보는 판매종류 하나/10월20일/빈 선택조건만 허용한다. 정책·mock store의 import/readback/멱등/rollback 및 CLI 검사 통과, 실제SQL은 아직 미실행. quoteEmpty naked[] 디코드 방어 누락도 모든 명시빈범위 envelope 필수로 통일했다; 정상 import는 기존에도 증거필수였고 기존 해시는 변경하지 않는다.
검색어: PR1156 quoteEmpty0행 19일Tab반증 BOMheading poEmpty daySale envelope 977
- 후속 UI 최종 동결: PO detail→poEmpty, 일보 daySale exact criteria와 판매 체크→적용/재열기 초기화 연결. 일보 인쇄2항목은 원본 관측대로 Escape·재클릭 시 유지, F3에서 닫힘; 실제 출력 실행은 미검증이다. observed coverage dataset은 일반 파일 업로드 버튼을 노출하지 않는다. UI EmptyState/Navigation48검사·JSX6파일·diffcheck PASS. root wrapper 독립 대조 모두 criteriaMismatch[]; 실제SQL 및 UI 운영/픽셀 검증은 아직 미검증. 메타977은 관측ID 수이며 완료기능 수가 아니다.
검색어: poEmpty daySale 판매 종류팝업48tests observed-empty977 runtime미검증

### 2026-10-20 PO/일보 릴리스와 운영 회귀 해소
- PR1156 Cafe2439418264281 성공. root1156 운영에서 BOM폼 x250.15625/y136.21875/w755/h310.46875 원본 bbox 정확 일치 확인. 주문 시작·종료19일 입력 Tab→F8 미수집, F3 재열기 두날짜19 유지 확인해1154의 빈결과 잔류 반증이 해소됐다. 금일/preview/quote 범위는 추가검증 중이다.
- PR1157 HEAD19132b0c 필수5종 PASS 후 생성/attach, CI39419124262 진행. root가 PASS 후 poEmpty/daySale를 각각0행/revision1/readbacktrue/idempotenttrue로 실제 적재했다. 별도ecount_work만, 원본/공유원장쓰기0. 두 receipt 저장, 운영 UI는 배포 전 미검증.
검색어: PR1156 BOMbbox정확 19일미수집복구 PR1157 poEmpty daySale 실제0행증거
- PR1156 견적 운영 추가검증: exact10/20 현황716/7열/빈1행span7, 다른19일 입력 Tab→F8 미수집 및 F3 날짜유지 PASS. 주문 미리보기는 enabled 메뉴→별도 Print Preview 창 생성까지만 확인; 창 내부는 도구 URL protocol 보안 정책 차단으로 미검증이다. 우회 surface/URL변경 없이 제한을 보존한다.
- PR1157 CI39419124262 성공 후 squash70a038c6, Cafe2439419456563 진행 중. 실제 PO/daySale 화면은 배포 후 root 검증 대기.
검색어: quote1156 exactempty716 preview보안정책내부미검증 PR1157배포39419456563

### 2026-10-20 미매출 날짜범위와 집계 전환 보완
- PR1157 Cafe2439419456563 최종성공, root PO/일보 운영검증 진행 중. 후속 unpSale는 E040609 기준일자/date_range/2026-10-20의 명시적 빈 결과만 별도 프로필로 등록했다. 영업주기 과거자료와 섞지 않으며 고급필터 독립 동작은 미검증이다. root wrapper 독립대조 criteriaMismatch[]·기록시각·sourceTimeNull·빈9열 확인, 실제SQL은 아직 미실행이다.
- 견적 집계 전환 오류는 API 실패가 아니라 보존된 날짜를 readonly 집계 filterSortRows에 전달해 DATE_FILTER_UNAVAILABLE가 발생한 문제였다. quote/order/po 집계 미수집 분기를 분리하고 날짜조건은 보존했다. unpSale 날짜모드 전환 시 버전 무효화 및 exact 조건만 조회, UI50검사·JSX/diffcheck PASS. 메타1002관측ID. 운영 재검증은 배포 후 필요하다.
- dayAll 전체34종류는 다음 독립 배치다. safe2217행/30빈구역/4누계분류×3기간과 거래처관계기준 조건을 하나의 불변 snapshot으로 설계하되 현재 커밋에는 구현하지 않는다. 원본값은 untracked 로컬 자료에만 두고 fixture는 합성값만 사용한다.
검색어: unpSale date_range E040609 aggregate DATE_FILTER_UNAVAILABLE 50tests1002 dayAll다음배치

### 2026-10-20 일보 전체 안전자료 원자 버전
- PR1158 필수5종/CI39420936549 PASS 후 squashee7b430c, Cafe2439421260544 진행 중. unpSale 실제 적재는 root count0/revision1/readbacktrue/idempotenttrue, 원본/공유원장쓰기0이며 운영 검증은 배포 후 예정.
- dayAll 새 envelope는 exact34종류/relationship/10월20일과 sourceTable/sourceRow를 고정한다.34구역(명시빈30),53표,AR72/AP183/재고1950/누계12=2217행. 실제합계와null/정밀문자열 보존, 이름·업체코드·미회수월·숨은코드 제외. 원본끼리 재고1949×4 대조0과 root wrapper 전필드 valueMismatches[]를 구분 기록했다; target runtime는 아직 미검증이다.
- UI53표 연속배치/34제목, AR/AP/재고합계span1/2/3, 누계4×rowspan3, canonical34 종류 반환과 부분조건 미수집, state전환 전 dataset override 보완을 구현했다. UI52검사·새합성fixture 정책/store/CLI 표적검사 PASS. 실제값은 outputs만 보관/커밋금지, actualSQL 아직미실행. 메타1018 관측ID, 전체 기능완료수가 아니다.
- 공유계정 주간87%사용/13%남음은 본 작업 단독사용량이 아니며 ordinaryAllowedtrue. 추가worker·리셋·구매 없이 최종 고정묶음당 필수검사/빌드1회 유지한다.
검색어: dayAll2217 observed_report34 sections30empty actualtotal null sourceTable atomic1018 PR1158
- dayAll 최초 HEADb4c412c7에서 계약/dnSpy/manifest/writeguard4종 PASS이나 build134 실패(Node worker semi-space 메모리commit 실패). 성공으로 간주하지 않으며 failed log 보존. 해당workerPID20060/50036은 이미 종료, 작업트리 잔류Next프로세스 확인없어 광역종료하지 않았다. 설치된 Next가 지원하는 CIRCLE_NODE_TOTAL=3으로 worker2개만 사용하여 다음빌드를 재검증한다(저장소설정파일 변경 없음).
- 원본 발주계획 table6 다단헤더 실제결함을 보정했다:12flat 대신8열/2헤더행/colspan3 두개/emptyspan8. UI53회귀 PASS, 나머지52표 폭합계 추가이상 없음. 이 새결함 변경을 포함한 고정HEAD로 필수5종 재실행한다. PR1158 Cafe2439421260544 최종성공, unpSale/집계전환 운영은root검증예정.
검색어: dayAll build134 semi-space CIRCLE_NODE_TOTAL2workers 발주계획2단8열53tests

### 2026-10-20 일보 최종검증 및 실제 적재
- HEAD1304072c 최종5종 daily-all-final 모두 PASS, 기존 지원환경 CIRCLE_NODE_TOTAL=3(2workers)로 build성공. 최초build134는 별도 실패로그로 남기고 성공으로 덮지 않았다. PR1159 생성/attach, CI39422639398 진행.
- root가 최종5종 직접확인 후 dayAll2217/revision1/readbacktrue/idempotenttrue 실제적재 완료, inventory-daily-all-kinds-import-result.json 기록. 앞선53표 관측 snapshot만 적재했고 이후동일조건 재조회51표/검색제한 안내는 별도미완료 증거로 보존했다. 최신전체조회 완전성은 미검증/complete unknown, 원본/공유원장쓰기0.
- PR1158 견적 집계 전환 실제수정 PASS, unpSale 기준일자exactempty/다른날짜미수집/영업주기차단 bounded PASS. 제목·정렬·인쇄화살표 등 시각차이는 다음독립보정으로 진행, 전체픽셀동등성미완료. 기존Preview내부는 도구보안차단으로미검증 유지.
검색어: PR1159 dayAll2217 readbacktrue 53표51표제한구분 2workerbuildPASS quoteaggregate1158

### 2026-10-20 은행 매핑 화면 설계와 미매출 시각보정
- PR1159 CI39422639398 첫 실행은 기존 importChecklistEditing 브라우저 시작에서 Chrome WS endpoint30초 timeout으로 실패(224PASS/1fail). 관련코드 변경 없이 failed job1회 재시도하며 PASS전 병합하지 않는다. 최초실패로그 보존, ECOUNT assertion 실패로 혼동하지 않는다.
- 후속 은행 매핑 popup은 원본 제목/960×676/755폭7열/F3검색폼/빈4필드/관측3매핑종류 표시만 구현했다. 미수집이며 자동매핑·선택삭제·F8·Excel은 비활성, API/DDL/저장 실행없음. 외부연동 설계문서에 draft검토→버전활성화/감사·복원 정책만 구체화했다.
- unpSale 원본 시각근거로 중앙24px 제목/오른쪽기간/중앙빈문구/인쇄화살표 존재만표시(실행disabled)를 반영하고 현재empty에없는 오천건버튼을 제거했다. UI55검사·JSX/JSON/diffcheck PASS, 메타1019관측ID. 다음 별도고정HEAD의 필수5종과운영검증은 아직대기다.
검색어: PR1159 CIChrome기동timeout 은행매핑960x676755 unpSale24px 55tests1019 설계only
- PR1159 동일HEAD의 CI39422639398 attempt2가 코드변경 없이 SUCCESS로 종료되어 squash75081bfa 병합했다. 원격 Chrome기동 실패와 재시도 성공 기록을 함께 보존하며 배포는 후속 감시한다.

### 2026-10-20 승인된 마지막 배포 마무리
- PR1159 Cafe2439423532560 최종SUCCESS, dayAll 실제53표/2217행 운영비교는 root 진행 중이며 완료로 앞서 표기하지 않는다. 기존원본 검색제한·완전성unknown은 보존한다.
- 시각보정 HEAD87e6f382 mapping-unposted 필수5종 PASS(2workers), UI55회귀 PASS. PR1160 CI39424066494 SUCCESS 후 squashf2643be6 병합, Cafe24 배포 확인 대기. 은행자동매핑/삭제/저장/외부API 실행은 없음.
- root 지시에 따라 공유계정97%사용/3%남음(본작업단독아님) 상태에서 추가기능·원본조사·새배치 착수는 중지하고 이미 진행 중인 배포/운영확인/인계만 마무리한다. 리셋·구매·추가worker 없음. 전체ERP100%완료 아님, disabled/미관측/외부연동설계 항목은 남아 있다.
검색어: PR1159deploySUCCESS PR1160f2643be6 공유97중지추가기능 dayAll런타임대기
- 1159 root 운영 exact범위53표/2217행/8426숫자/991null 불일치0 확인. 다른19일은 UI load 사전검사목록에 dayAll 누락으로 오류표시되는 실제결함 발견. 서버 strict거부는정상이며 UI검사를 PROFILES hasOwn으로통일하는1줄+실제load19일 fetch0/versionnull/error없음 회귀만수정, UI56검사PASS. 새기능없고긴급후속검증/배포대기.

## 2026-10-21 native 관리자 설치기
- PR1132 payload 그대로 포함한 단일 WinForms 설치 EXE 구현. requireAdministrator, 기존 경로/직접 선택, 모든 로컬 세션 실행 중 차단, SHA256 allowlist, 원본 백업/atomic 교체/실패 복원. DB 쓰기 없음.
- 파일 교체/거부/재설치 회귀 및 UI 렌더 확인 통과. 직원 PC 및 실제 로그인 Pivot은 미검증. 전체 gate 진행 중.
- 검색어: native-pivot-installer 관리자설치 단일EXE requireAdministrator
## 2026-10-21 바로빌 API 세팅(테스트 서버 인증키) — lib/barobillApi.js
검색어: 바로빌, barobill, SOAP, testws.baroservice.com, BAROBILL_CERTKEY, 134-86-94367, 세금계산서 API, 계좌조회 API, 카드조회 API, 홈택스 수집
- 개발자센터 파트너 '네노바'(콘솔 8614) 테스트/운영 인증키 확인 → GitHub Secret(BAROBILL_ENV=test, BAROBILL_CERTKEY, BAROBILL_CERTKEY_PROD, BAROBILL_CORPNUM=1348694367)·owner PC env. deploy.yml 이 .env.local 동기화. 회원사 번호는 134-86-94367(견적서 416-81-38772 는 케이넷).
- 의존성 없는 SOAP 클라이언트(fetch+최소 XML 파서), GET 전용 관리자 API /api/finance/barobill?action=…, 스모크 scripts/barobill-smoke.mjs, 계약 docs/contracts/barobill-api.json, 문서 docs/BAROBILL_API.md.
- 테스트서버 실측: Ping OK·회원사 1·선불 10,000·사업자상태 영업중·계좌 0·카드 0·세금계산서 0. CheckCERTIsValid -31100(공동인증서 미등록).
- 함정: ArrayOfX 래퍼는 한 단계만 벗길 것(행 객체까지 풀면 값만 남음). 쓰기 API 는 BAROBILL_ALLOW_WRITE=1 없으면 호출 전 차단.
- 남은 사람 작업: 테스트 사이트 공동인증서 등록, 계좌 4·카드 2 등록, BAROBILL_USERID 확정, 운영 전환.

## 2026-10-22 ECOUNT P020~P039 원본 조사 125/125 완료 (PR #1222)
- 남은 회계I 28화면을 2026-10-22 조사(사업자번호 [사업자번호] 마스킹)·셸·대상 DOM 크롤까지 한 PR. 증거 evidence/2026-10-22-source-survey-p020-p039-rest.json, 셸 197화면·ID 2,670, 버튼 3,743(+399), 목록 확보 230/373, 구현 1,649 / 미구현 1,899 / 미관측 49 / API설계 133 / 검증 0.
- 조사일이 다른 증거 파일이 섞이므로 프리셋 날짜 대조는 page.sourceSurvey.observedOn 기준(822건 일치).
- 안내창 루프 대응: closeDialogs 안에서 계정코드 안내창만 1회 확인 클릭(반복 setInterval 금지) → 28화면 약 10분.
- 다음: 회계II P040~P051, 관리/그룹웨어 P052~P059, 사용자설정 P005~P007(원본 미조사 143).
- 검색어: ECOUNT P020~P039 완료 PR1222 125/125 2026-10-22 rest 사업자번호마스킹 observedOn 화면별조사일

## 2026-10-21 ECOUNT 이관 재개 4차(후반) — P020~P039 원본 조사 97/125·셸 169화면
- 원본 조사: 사장님 크롬 ECOUNT 세션 읽기 전용. 결과는 페이지 메모리→압축 행(JSON)으로 900자씩 읽어 scratchpad/survey/inbox/s*.json 에 즉시 저장(127.0.0.1 수신기 POST 는 자동승인 분류기가 Browser JS Exfil 로 차단 → 사용 중단). 변환기 scratchpad/survey/expand2.cjs(재조사 행이 더 풍부하면 교체, 사이트맵만 렌더된 화면 제외, 남은 ECOUNT 안내창 확인 버튼 제외).
- 함정: (1) 4초 고정 대기는 입력/시리얼 화면 미렌더 → 제목 변경+컨트롤>3 대기 루프(최대 16초). (2) 계정별원장 프리셋 후 "검색창에 계정코드를 입력하고 검색 바랍니다" 안내가 무한 반복 — 자동 확인 클릭(setInterval)이 오히려 루프를 키움(6분 623회). 끄면 정상. (3) ERP 주소를 ec_req_sid 없이 다시 열면 로그아웃 → location.reload() 만 쓸 것. (4) 크롬 확장 재연결마다 탭 그룹 재생성.
- 릴리스: PR #1215 90화면 조사 적재(+1,223버튼) · #1216 P020~P039 대상 셸(워커, 판정 규칙 3개 추가: 저장(F8)+저장/전표(F7)=input, 26 / 09 / 날짜 정규화, other 의 Search(F3)→토글) · #1217 회계I 7화면 추가(+74, 셸 169화면·ID 2,271·활성 1,054/자리표시 1,217). 전부 CI pass 후 squash.
- 현황(2,047→3,344 관측 버튼): 버튼 목록 확보 202/373, 구현 817 / 미구현 1,076 / 조건부 13 / 미관측 1,313(새 셸은 크롤 전이라 아직 미관측) / API설계전용 125 / 검증 0. 남은 조사 28화면(회계I E010712~E010823), 재로그인 대기.
- 다음: 남은 28화면 조사 → 대상 DOM 재크롤(로컬 prod 빌드 포트 3100, scripts/ecount-dom-crawl.cjs, 이전 크롤 union 필수) → 미관측→미구현/구현 재분류.
- 검색어: ECOUNT 재개4차후반 PR1215 PR1216 PR1217 survey7 survey8 expand2 계정코드안내창루프 ec_req_sid로그아웃 BrowserJSExfil 97/125 셸169

## 2026-10-21 ECOUNT 이관 재개 4차 — 회수·셸 새창·InputDraft API·105화면 대상 DOM 병합
- 회수(0단계): ECOUNT 관련 로컬/origin 브랜치·agent-* worktree 산출물은 전부 master 머지 확인(#1164~#1175, #1178~#1182, #1195). 유실 1건: 앞 세션(local_d76e6a38)의 P020~P039 125화면 원본 조사 결과(99/125)는 디스크 미저장·탭 메모리(window.__survey5)만 → 재조사 대상.
- 릴리스4(이 세션): PR #1200 P008~P019 셸 검색패널 거래처/품목/창고 새창 연결(활성 437→440) · #1201 입력 화면 7종 InputDraft 저장 API(/api/ecount/input-drafts GET/POST/PATCH, 테이블 없으면 503 MIGRATION_PENDING, DDL 미실행)+InputDraftForm · #1202 셸에 폼 통합(sourceSaveButton prop 으로 matchId 중복 방지) · #1208 105화면 대상 DOM 크롤(로컬 prod 빌드 8ab5da0c, 포트 3100) 병합. 전부 CI verify pass 후 squash.
- 분류 변화(2,047 관측 버튼): 구현 220→817 / 미구현 718→1,076 / 조건부 26→13 / 미관측 991→49 / API설계전용 92 / 검증 완료 0. 함정: 새 크롤 파일을 단독 병합하면 이전 33화면 로컬 크롤의 정적 주장 66건이 철회됨 → 크롤러 union 규칙과 같은 방식으로 이전 로컬 크롤을 union 한 뒤 병합(철회 0, E040207 거래처 대화상자 7건은 조건부).
- 비교 엑셀 outputs/ecount-parity-20261021/ECOUNT_버튼별_비교보고서.xlsx 9시트 7,924,251B sha256 0f658763…(이미지 미삽입).
- 차단: 크롬 확장 재연결(deviceId 변경)마다 Claude in Chrome 탭 그룹이 재생성되어 로그인된 ECOUNT 탭·진행 중 조사를 잃음. 조사 중 확장 재연결·다른 세션 브라우저 전환 금지. 조사 스크립트(srv/run/expand)는 세션 scratchpad 에 보관, 결과는 화면 배치마다 즉시 evidence JSON 저장 원칙.
- 검색어: ECOUNT 재개4차 PR1200 PR1201 PR1202 PR1208 InputDraft API MIGRATION_PENDING 대상DOM크롤 r4 union 철회66 미관측49 구현817 탭그룹재생성 survey6

## 2026-10-21 ECOUNT 이관 재개 1차 — PR1161 운영회귀 닫기 · 33화면 대상 DOM 증거 · ACTION_IDS 누락 11화면 수정
- 재개 기준: docs/session-backups/2026-10-21_ecount-status-and-replan.md + resume-inventory.json(이 브랜치에 복사). 코덱스 앞선 3커밋(dayAll 미관측 날짜 미수집)은 master 9a8e55a7(#1161)에 동일 포함 확인(파일 diff 동일).
- PR1161 운영회귀: 서비스 토큰 API dayAll 2026-10-20 → 200/2,217행/34구역/revision1 PASS, 10-19·10-21 → 400 INVALID_COVERAGE_SCOPE(설계상 정상). 브라우저(사장님 크롬, 네노바웹 미로그인): 10-19·금일 검색 시 53표 전부 '미수집', alert 0, 서버 요청 0 PASS. 10-20 표 렌더는 401로 미검증. 증거 data/ecount-workbench/evidence/2026-10-21-pr1161-daily-regression.json.
- 대상 DOM 크롤러 scripts/ecount-dom-crawl.cjs(puppeteer-core+시스템 크롬, 미로그인 셸, 메뉴 해시→F3→활성 버튼 클릭→data-ecount-action-id 스냅샷, lookup 창 페이지 포함, window.open 스텁, 재실행 시 union). 운영(baf6d3df) 698개, 로컬(수정 트리) 977개/1,019. 병합 scripts/ecount-merge-dom-evidence.cjs → button-matches.json target.actualStableId/domState/verificationScope, 라벨 일치 888. 미재현 정적 주장은 자동 철회(이번 최종 0건; 중간 실행에서 7건 철회 후 로컬 재현으로 복구).
- 결함 수정: ObservedPageControls ACTION_IDS에 receipt/payment/poQuery/buyStatus/discount/buyDisc/quoteStat/orderQuery/saleQuery/unsold/unbought 11 데이터셋 맵이 없어 해당 11화면(약 280버튼)이 ID 없이 렌더되던 문제 → 소스 라벨·문맥 그대로 생성해 추가. 회귀검사 __tests__/ecountActionIdCoverage.test.cjs(27 데이터셋 전수 커버리지·중복/타프로그램 금지).
- 1단계 분류표 docs/ecount-migration/step1-closure-2026-10-21.md: 1,019버튼 = 구현(활성) 212 / 미구현(비활성 자리표시) 708 / 미관측(대상 컨트롤 없음) 42 / API설계전용 57. 기능·새창·조회값 비교는 전부 미검증(검증대기 1,019). 어떤 화면도 100% 아님.
- 차단: ECOUNT 원본 관측은 크롬 ECOUNT 세션이 로그인 페이지로 튕겨 불가(사장님 로그인 요청 전달). 로그인 후 33화면 기간 프리셋/새창 원본 관측 → 708 자리표시 중 datePreset 가능 항목부터 활성화 예정.
- ERP 원장·ECOUNT 쓰기 없음. test:erp-contract 통과(수정 트리), manifest·write guard 통과, build/CI는 PR에서 확인.
- 검색어: ECOUNT 재개 ACTION_IDS 누락 11데이터셋 ecount-dom-crawl 977/1019 step1-closure 미관측42 PR1161 2217 INVALID_COVERAGE_SCOPE ECOUNT로그인차단
- 2026-10-21 릴리스1: PR #1164 CI verify SUCCESS(3회, 최종 bcc10069) → squash d3c33993 → deploy run 39532373778 success(02:26Z). 운영 스모크: /api/ping OK, dayAll 2026-10-20 API 200/2,217행/34구역, 수정 11화면 운영 크롤 279 ID 렌더(배포 전 0). 비교 엑셀 outputs/ecount-parity-20261021/ECOUNT_버튼별_비교보고서.xlsx 9시트 3,686,914B sha256 616f5756…6b4107(이미지 미삽입). 검색어: PR1164 d3c33993 39532373778 운영스모크 279ID
- 2026-10-21 릴리스2(하위 작업자 3건): PR #1165 프리셋 라벨 매핑(77c9a4fc, deploy 39535003807 success) · PR #1166 보고서 모델 DOM 분류(733a244c, 39535327937 success) · PR #1167 Excel 내보내기 35버튼(170de90d, 39536243857 success). 모두 CI verify SUCCESS 확인 후 squash. 로컬 스모크: 수금현황 227행 Excel 클릭 → xlsx 38,711B/2시트/228행 캡처 PASS. 운영 로그인 다운로드·원본 서식 동일성 미검증. 증거 evidence/2026-10-21-release2-smoke.json. 검색어: PR1165 PR1166 PR1167 Excel내보내기 presetIdForLabel 릴리스2
- 2026-10-21 원본 조사 1차: 사장님 크롬 ECOUNT 세션(Claude 탭 그룹)에서 33화면 검색패널 컨트롤·간편검색 프리셋을 조회만으로 관측(evidence/2026-10-21-source-survey.json, 간편검색설정 39종 목록은 닫기로 종료·저장 안 함). 프리셋 공통: 금주 시작 일요일, 전월+금월, 말일=당월말, 이번기수=당해1/1~오늘, 직전분기/반기, 금년/전년/직전기수, 종료일=현재 종료일을 시작일로 복사(순서의존 확인), 단일기준일 화면은 금일/전일만, 영업주기 화면은 종료일만 변경. ingest(PR #1168 스크립트+라벨 단독 매칭 보완)로 button-matches 1,073버튼(신규 54: 입/출금·판매현황·구매현황·채무 프리셋, 기본(수정불가)/정렬기준 설정/양식 버튼 등). 검색어: source-survey 간편검색 프리셋 관측 1073버튼 신규54 종료일복사 주시작일요일

## 2026-10-21 패킹 팀 업로드 이력 / 직원 중단 진단
- 공용 품목 매칭은 기존 팀 레코드. 원본·분석 복구는 개인 IndexedDB뿐이던 공백을 웹 파일 이력으로 보완. 원본 해시 검증, 불변 revision, 작성 계정, 최신 공용 매칭 재적용, ERP 승인 정보 제외.
- 10/20 16:41KST 다음·입고준비 → 원문 박스/단수 확인창 →16:42 취소 확인. 클릭로그로 잘못된 숫자를 확정하지 않음. 과거 UPLOAD_FAILED2건은 상세 없음; 일부 문서 COMMITTED/APPROVED 확인. 운영 ERP SELECT만.
- 전체 ERP/packing-team/UI/manifest/write/evidence guard/build 통과. 격리 실제 Chrome A 보관→B 조회/키보드복구 성공, ERP write0. 새 dnSpy 실행은 CLR 오류로 실패, 기존 native 근거 사용; ERP writer 변경 없음.
- 최종 PR/배포/운영 확인은 세션 문서에 추가. 실물 인보이스 입고·도착원가 E2E는 이번 작업 미검증.
- 검색어: packing-shared-history upload-history 팀공용 원본복구 직원로그 다음입고준비 취소 IndexedDB

## 2026-10-21 ERP 관리기능 공백 3축 대조(이카운트 메뉴 430·중견 ERP 모듈·네노바웹 9단계) — 보고서만
- 산출물 docs/ERP_GAP_ANALYSIS_2026-10.md + 메뉴별 태그 CSV. 코드·수식·contracts·이카운트 쓰기 없음.
- 이카운트 말단 430메뉴: 웹에 이미 있음 96(22%) / 실사용인데 웹 없음 17(4%, 거의 회계I 전표·원장·카드·계좌) / 미사용 317(74%). 사장님 판단("대부분 안 쓴다") 수치로 확인.
- 9단계 공백 중 '필요' 상위10: 여신한도·채권aging 일수구간·입금대사·환차손익·송금결재선·단가변경이력·클레임사유코드·차수마감체크리스트·거래처별이익/목표·변경감사로그 통합. 불필요=고정자산·연결회계·급여인사·생산BOM·A/S·수표·전자계약.
- 미검증: 이카운트 공식 help 대조, "커버리지 40%" 원문 미발견, 상위10이 실제 수기 관리인지(사장님 확인 필요), Amaranth/K-System 상세 모듈.
- 맥락: 바이브코딩 직원→전산 연결 플랫폼 구상(데이터 계약·직원별 MCP 권한 토큰·검증게이트·실행consumer·절차 가이드 5층) 논의에서 파생.
- 검색어: ERP공백 3축대조 이카운트430메뉴 미사용74% 여신한도 채권aging 환차손익 송금결재선 ERP_GAP_ANALYSIS 플랫폼5층

## 2026-10-21 중국발주현황 두 시트 다운로드
- 선택 세부차수 다운로드에 기존 품목별업체수량 + 단수량 시트 추가. HF/품목/CL 순서 보존, 단 전용은 숫자형 저장. 박스/송이는 등록 포장비율 환산, 누락/불일치 시 환산확인 및 합계 전파.
- 중국발주 관련 20개 검사 및 XLSX 재읽기/교차연도/필터 검사 통과. manifest/write guard 통과. 전체 계약/빌드 최초 실행은 PC 메모리 부족으로 실패하여 재검증 중. 운영 배포/실브라우저 미검증.
- 원장/API/SQL 쓰기 없음. 이전 인보이스 매칭·양방향 수량 편집은 이번 변경 범위 밖.
- 검색어: 중국발주현황 단수량 두시트 품목별업체수량 박스 송이 환산확인
- 최종 요청 변경: 다운로드 버튼 두 개로 분리, 각 파일에 선택 형식 한 시트만 생성. 단박스/단만 파일명 구분. 관련 20개 검사 재통과. 로컬 Next 빌드는 메모리 부족으로 2회 실패, 운영 미배포. PR #1177.
## 2026-10-21 경영관리(mgmt) 모듈 기반 — ECOUNT 이관과 공존 설계·골격 PR
- 설계 docs/mgmt/MGMT_CONTROLS_DESIGN.md: 이관 소유 경로(lib/ecount*, pages/(api/)ecount, components/ecount, data/ecount-workbench, docs/ecount-migration, ecount_work 스키마) 접촉 금지, mgmt 네임스페이스(lib/mgmt·pages/mgmt·pages/api/mgmt·web_mgmt 스키마) 분리, 공유 핫스팟(Layout.js·package.json·erpContractManifest.test.js) 최소 삽입+리베이스 규칙, ecount_work는 lib/mgmt/sources.js 어댑터로 읽기만, 승인모델은 이관 Outbox와 같은 상태의미(draft→requested→approved|rejected→applied, 요청자 본인 승인 금지, 하드삭제 트리거 차단).
- 골격: web_mgmt 9테이블 DDL(docs/migrations/2026-10-21_web_mgmt_controls.sql, 멱등), lib/mgmt/{schema,schemaMeta,boundary,sources,approval,approvalPolicy}.js, /api/mgmt/approvals, /mgmt 홈(상위10 카드)·/mgmt/approvals, 계약 docs/contracts/management-controls.json, 메뉴 그룹 '경영관리'(nenovaSS3만).
- 자동검사: __tests__/mgmtBoundary.test.js --changed-from origin/master 가 mgmt 변경 PR이 이관 파일을 건드리면 실패. SQL 쓰기동사 가드(ecount_work·ERP 원장). test:erp-contract 끝에 test:mgmt 연결.
- 다음: A군(여신한도·aging·단가이력·클레임코드·마감체크·거래처이익/목표·감사뷰) 기능별 PR, B군(입금대사·환차손익·송금결재선)은 어댑터 소스 채워지는 대로. 각 PR 전 origin/master 리베이스.
- 검색어: mgmt 경영관리 web_mgmt 경계 boundary ECOUNT이관공존 ApprovalRequest 결재선 management-controls 계약 MGMT_CONTROLS_DESIGN

## 2026-10-21 주차별 보고서 출력 선택·기억
- 엑셀은 1~조회차수 전체/한 차수 한 시트, 인쇄 미리보기는 체크한 차수만이라는 기존 범위를 명시하고 개수 표시. 별도 출력 항목 선택과 화면 컬럼 가져오기 제공.
- 기존 화면 컬럼 v3를 보존하며 첫 복원 전 기본값 덮어쓰기 방지. 출력 항목은 별도 localStorage에 저장하고 빈 선택도 유지/출력 차단. 같은 브라우저 범위이며 계정·기기 간 동기화 아님.
- 18차 HTTP502 신고: 502/503/504/네트워크 GET 실패만 해당 차수 최대2회 재시도, 이전 완료분 유지, 실패 시 부분파일 금지. 운영 ping200/다른 배포 진행 확인만으로 최초502 원인을 단정하지 않음.
- ERP 계산·SQL·확정본·원장 변경 없음. 전체 verify:erp-change/build·dnSpy gate 및 production-build 실제 Chrome 합성 API 검증 통과(재접속/선택빈값/41차단독/41시트/18차재시도/교차연도/1920·640px, API 쓰기0). PR/배포는 진행 중(미검증). 빌드 생성 개발이력 JSON 2개는 이 작업 이전 커밋본으로 복원.
- 검색어: profit-output-preferences 출력항목저장 화면컬럼복원 41차미리보기 18차502 차수별재시도

## 2026-10-21 유오디아 native 분배 오류 재발 방지
- 정확 감사 source=order-import-final(10/09 11:35:37.683, 2026/43-01, ProdKey2226,1박스)와 생성시각 대조. 웹 업로드가 native FormOrderAdd의 빈 ShipmentMaster 준비를 누락했다. 최근 음수 피벗 패치 무관.
- FINAL_SNAPSHOT만 기존 헤더 준비 분기에 연결. 현재연도/세부차수/업체 잠금·재사용, 주문과 동일 transaction. 분배량·날짜·농장·확정·재고·견적 자동 생성 없음.
- 실행형 API 신규/재시도/교차연도/삭제/기존확정/헤더실패/후속실패 rollback PASS. 전체 gate·배포 진행 중, EXE 실제 재조회 미검증. 운영 최신 주문/출고/date10단, 확정·공급90909/VAT9091은 read-only 확인이며 이번 턴 변경하지 않음.
- 검색어: 유오디아 블랙잭 43-01 2226 GetShipmentMaster order-import-final ShipmentMaster누락 재발방지

## 2026-10-21 선택 차수 엑셀·원본 손익 재검증
- 엑셀에만 선택 배열이 누락되어 전 차수를 요청하던 경로 수정. 인쇄/엑셀 동일 체크 범위, 단일·전체·비연속·빈 선택 회귀 및 실제 파일 시트 수 검사 추가. 계산/원장 변경 없음.
- 실제 SQL18차 476 SELECT 약6~9초, 생성 XLSX128개 값 대조. 27~31차 원본80행 동일 입력 산식 일치, 독립 SQL328항목 및 생성 파일640개 값 일치. 재고수량·원가 근거 미해결과 원본 입력 차이는 별도 설명.
- 인증 운영18차 HTTP 다운로드/502원인은 도구 초기화 경로 오류로 미검증. 상세 docs/work-sessions/2026-10-21_profit-selected-output-audit.md, 실제 숫자는 ignored .verify만 보관.
- 검색어: 선택차수엑셀 전체선택 단일다운로드 18차502 27~31원본비교 기초기말재고 SQL328

## 2026-10-21 44-01 직원 업로드 처리 중 대기 점검
- 사용자 확인: 2026/44-01 업로드 화면이 처리 중에서 멈춤. 최근 3일 주문 API 감사 SUCCESS24, FAIL0; 당일 완료 주문 요청 없음. 특정 직원 요청 원인은 미확정.
- SELECT-only: ViewOrder760, ViewShipment0, ShipmentImportAudit0, 재고게이트 IDLE/PendingCalc=false. 전체 세션 조회 권한 없어 서버 전체 잠금은 미검증.
- 기존 최종 업로드10업체/169활성 주문행에 ShipmentMaster 누락 확인. PR1183 예방수정 Cafe24 성공 확인; 기존누락 소급보정은 수행하지 않음.
- UI 파일분석/저장120초, 업체보조조회/저장후조회30초 응답대기 상한. timeout은 서버취소 아님, 초안보존/자동재전송없음/늦은응답 성공표시없음. SQL/API 쓰기정책 변경없음.
- 회귀: 정상/409/끝나지 않는 요청/JSON본문대기/늦은저장응답/재시도0 실행검사 PASS. 전체필수검사·배포 진행 중. 상세 docs/work-sessions/2026-10-21_upload-response-wait.md.
- 검색어: 44-01 직원업로드 처리중 응답대기 timeout ShipmentMaster10 169 withOrderImportDeadline
- 추가검증: 최신 전체 요청이 남은 업로드15업체299품목 비교 차이7·추가3은 모두 이후 OrderHistory 수정/삭제/신규로 설명. 재업로드 원복금지. 로컬5종 exit0, PR1185 CI39552447489 success 후 squash22983567, Cafe2439552707668 진행.

- 완료: PR1185 squash22983567, Cafe2439552707668 SUCCESS, SSH·hydration 실브라우저 PASS. Chrome 운영 주문업로드 로딩·기존초안복원 확인, 실제 운영 bundle에서120초/30초 및 timeout분기 확인. 원장수정0. 기존10업체 헤더누락/직원개별요청 최초원인은 미해결·미검증으로 명시. 사용자 DB손상 없으면 계속 진행 지시 반영.

## 2026-10-21 EXE 연결 헤더 보정 완료 및 지식 저장
- 사용자 승인 범위: 기존 주문수량 보존, 누락10업체 헤더만 보정. dnSpy 실제 FormOrderAdd/ShipmentDistribution 재확인 후 SERIALIZABLE 롤백 리허설·적용·별도 연결 조회 완료.
- 2026/44-01 ShipmentMaster10건(7069~7078) 추가, KeyNumbering 동기화. 14개 보호 영역 행 수·SHA256 동일. 주문/출고상세/재고/견적/매출 변경 없음. EXE SQL조회10/10, EXE GUI 미검증.
- docs/knowledge/NATIVE_SHIPMENT_HEADER_CONTRACT.md를 AGENTS.md 필수 참조로 연결. 세션 인계 docs/session-backups/2026-10-21_upload-header-repair.md. 직원 최초 정지원인은 미확정.
- 검색어: EXE 연결헤더 ShipmentMaster dnSpy GetShipmentMaster 44-01 10업체 7069 7078 주문수량보존

## 2026-10-21 선택 차수 배포·기기별 로그인 유지
- 선택 차수 수정 PR1187 → master16e6ca5f → Cafe24 run39553387769 성공. 배포된 UI 실제 Chromium 합성 API 시트 다운로드 회귀 통과, ping DB연결 성공. 운영 실제18 HTTP는 별도 수동 read-only smoke로 검증 준비.
- 사용자 추가 선택: 이 기기 로그인 유지 opt-in만. 웹/모바일 기본 해제 체크박스, 미선택8시간. 일반 브라우저400일 미사용 제한/일단위 연장, 기존 PC웹앱은 cookie-change 업무창 stop/hide 방지를 위해 중간갱신 없는 고정400일. 서버 hashed runtime session, API/SSR 현재 계정 검증, 비밀번호변경·비활성·로그아웃 폐기, 외부Bearer8시간 보존.
- ERP/UserInfo 쓰기 없음. 로그인 유지 단위 회귀 통과; 전체gate/CI/배포 진행 중(미검증). docs/work-sessions/2026-10-21_remember-device.md 참고.
- 검색어: 로그인유지 이기기 8시간자동해제 rememberDevice 400일 서버폐기 18차운영다운로드

## 2026-10-21 알스트로 물량표 자동 박스·합계
- 입력 수량 옆 박스(자동) 수식열, 내부 테두리 제거. 업체 두 열 전체 복사삽입을 INDEX/COLUMN 합계로 지원. 빈칸·업체명 변경·새 열 삽입 후 업로드는 숫자 수량만 판독.
- 실제 Excel 수량변경/삭제/빈칸입력/두열삽입/합계 및 XLSX 재업로드 검사 통과. DB/저장정책 변경 없음. 전체검사·배포 진행 중(미검증).
- 검색어: 알스트로 박스자동 두열복사 수량삭제 합계 INDEX COLUMN 분배업로드
## 2026-10-21 패킹 매칭 후 원문 검증 복구
- 상단 문제값 목록과 직접 수정 연결, 총액 검산 차이 표시, NL Handling 명시 수정. 기존 매칭/원문/입고 승인과 writer 유지.
- 실제 중국 해상 41-1 PDF 7페이지101행 웹 업로드·PDF 렌더·날짜/빈 단가금액 수정·재생성 격리 검증. 실제 카탈로그 매칭5행/추가확인96행, 실입고 완료는 미검증. 운영 DB 쓰기·유료 AI 호출 없음.
- 인계: docs/work-sessions/2026-10-21_packing-validation-repair.md. 배포는 CI/Actions 최종 결과 참조.
- 검색어: 패킹 매칭후막힘 인식값수정 DATE_ORDER_AMBIGUOUS AMOUNT_COMPONENTS_UNAVAILABLE Sinensis white Handling 41-1

## 2026-10-21 알스트로 입고 점검·업체명 병합
- 2026/44-01 알스트로 입고 원본/뷰 모두0행, 43-01=1648. 차수 대체 없음. 업체 헤더 두열병합, 업로드 병합보조열 품목오인 방지.
- 실제 Excel 복사삽입/이름변경/수량삭제/두열통삭제 및 저장파일 파서 통과. 필수검사/배포 진행 중(미검증).
- 검색어: 알스트로 44-01 입고없음 업체명병합 두열삭제

## 2026-10-21 경영관리(mgmt) A군 7기능 머지 — PR #1179 #1180 #1181 #1182
- ①여신한도 /mgmt/credit-limit(CreditLimitHistory 추가전용, 80%경고/초과) ②채권aging /mgmt/ar-aging(ar.js 쿼리 복제, FIFO 상계, 초과입금 credit 분리, 구간합−credit=잔액) ⑥단가변경이력 /mgmt/price-history(CustomerProdCost·Product.Cost 스냅샷 비교, 첫 스냅샷=기준선, PriceSnapshot 테이블 추가) ⑦클레임사유코드 /mgmt/claim-codes(8코드 시드, WebSalesDefectDeduction.DeductionKey 연결, 농장×사유 집계) ⑧차수마감 /mgmt/week-close(UNQUOTED·NEGATIVE_STOCK·EMPTY_SDETAIL·UNPAID·UNREMITTED·VERIFY_WEEK, WeekCloseCheck) ⑨거래처별이익·목표 /mgmt/customer-profit(보고서 스냅샷 카테고리행을 확정출고 저장Amount 비중으로 배분, 0.01원 정수배분 합계보존, CustomerTarget) ⑩감사뷰 /mgmt/audit-view(SystemActionLog·ShipmentHistory·PriceChangeHistory·CreditLimitHistory·ApprovalAudit 통합).
- 하위 작업자 4명 병렬(code-worker, worktree) → 메인이 리베이스·충돌(계약 scope/test:mgmt/index.js ready 플래그 union)·PR·머지. 매니페스트 140개 통과.
- ⚠ #1180·#1182는 체크 보고 전 머지됨(리베이스 후 force push로 체크 리셋). master ERP Contract Guard로 사후 확인. 다음부터 push 후 checks 등록 확인하고 merge.
- 미검증: 전 기능 실DB 미실행(순수로직+계약검사만). 운영 실증 필요: aging 합계 vs /api/sales/ar, 거래처이익 합계 vs 보고서 총이익(diff 배지), UNREMITTED 업무정의(WebFarmRemit.Weeks 농장단위 추정), SystemActionLog ActionType 명칭, 확정차수 확정값 vs 스냅샷.
- 남은 B군: ③입금대사 ④환차손익 ⑤송금결재선 화면연결(승인모델·ReceiptMatch 테이블은 있음).
- 검색어: mgmt A군 여신한도 aging 단가이력 클레임코드 마감체크 거래처이익 감사뷰 PR1179 PR1180 PR1181 PR1182 PriceSnapshot 체크전머지

## 2026-10-21 주광 요일 업로드·분배 품종 제한
- 기존 주문 보존 별도 업로드, 시트/품종 명시, 빈칸/0 무시, 동일 no-op/다른 기존분배 차단. 일반 분배 업로드 수국 선택 범위를 서버까지 제한.
- 실제 파일·격리 SQL 신규/중복/강제실패 롤백 통과. 필수검사/빌드/1366px Chrome 통과. PR1206 CI/배포 진행 중(배포 미검증). 운영 DB 쓰기 없음. docs/work-sessions/2026-10-21_jugwang-weekday-upload.md 참고.
- 검색어: 주광 요일수량 수국 카네이션 업로드 시트 ShipmentDate 주문보존 감사122


## 2026-10-21 분배 업로드 새 파일 자동 범위
- 사용자 정정: 수국만 선택을 추가하는 것이 아니라 새 수국 파일 자체 기준. 수동 시트/품종 필터 제거, 실제 행/제목 품종 자동판별, 교차품종 오매칭 차단, 새파일 이전결과 폐기.
- 감사122 STARTED/0, ERP/audit 원자적 저장 및 이전 프로세스 교체 확인. 재업로드는 현재DB 재검증. 회귀·빌드·배포 진행 중(미검증). docs/work-sessions/2026-10-21_import-file-scope.md.
- 검색어: 새파일 기준 수국 카네이션 자동범위 중단 재업로드 이전응답


## 2026-10-21 에콰도르 과거 재고·원가 누락 대사
- 사용자 확인: 후속 전산오류 조정은 과거 부풀려진 재고 제거 목적. 이중 차감 방지를 위해 기존 이력 보존, 정확한 상쇄 감사행과 native CALC를 한 트랜잭션으로 처리하는 수동 도구·계약·회귀 추가.
- 기본 SELECT only, 원천 지문·명시 범위·실제 롤백 리허설 필수. Product.Stock/주문/출고/견적/매입/확정자료 보존 검사. 미래 매입단가로 과거 원가를 만들지 않음.
- 읽기 전용 계획 통과. 전체검사·배포·운영 적용·보고서 최종 재조회 진행 중(미검증). docs/work-sessions/2026-10-21_ecuador-stock-cost.md 참고.
- 검색어: 에콰도르 31차 30차이월 41차전산오류 원가누락 이중차감 historicalStockRepair

## 2026-10-21 알스트로 전체 제목 병합
- 주문·입고·재고·잔량·농장명·입고합계까지 제목 두열병합 확대. 본문 숫자/박스/합계 수식·업로드 정책 보존. 양방향 입력은 일반 수식으로 불가 안내.
- 필수검사·배포 진행 중(미검증). 검색어: 알스트로 요약농장 제목병합 양방향수식

## 2026-10-21 경영관리 운영 실측(크롬 Browser1, 계정 nenovaSS1 강현우) + 수정 PR #1197
- 실측(배포 8ab5da0c): /mgmt 홈 7카드 열기 OK · 여신한도 잔액 합계 22,055,603,875 · aging 합계 22,035,173,875(차이 20,430,000 = 기준일 이후 청구) · 90+ 구간 17.37억 = ReceivableLedger 입금 0건이라 전 청구 미수 집계(입금은 이카운트에만) · 거래처별이익 합계 52,037,501 = 보고서 총이익 배지 일치(이번 달) · 차수마감 42-1: 견적미등록14·잔량마이너스10·빈출고상세39·미입금59·송금미완료48 · 클레임코드 사전 비어있음(시드 미실행), 불량차감 행 농장 미연결 175건 · 단가이력 스냅샷 미실행 · 감사뷰 '읽지 못한 원천: ShipmentHistory' · 직원 계정으로 URL 직접 접근 가능.
- 수정(#1197, f268ecd4): ShipmentHistory ColumName→Descr, aging futureExcluded·totalPaid 보고+입금0 경고, 금액 반올림, lib/mgmt/access.js 관리자(authority<=1·대표) 외 403.
- 미실측: 여신한도 등록·사유코드 시드·단가 스냅샷 실행 등 쓰기 동작(사장님 계정 필요), 기준일 변경 시 aging.
- 교훈: /sales/ar 기본 기간은 당월이라 aging(전기간)과 바로 비교 불가. 운영 실측은 로그인 계정이 누구인지 먼저 확인(화면 하단 'OOO (ID)').
- 검색어: mgmt 운영실측 aging 22035173875 futureExcluded ReceivableLedger입금0 ShipmentHistory Descr 관리자가드 403 PR1197 week-close 42-1

## 2026-10-21 신라 입고·견적·손익 확인 탭
- /raum/shilla-analysis/check: 기존 연결 확장 그대로 작업 시작→월별 조회→최신 DB 비교. 원본 Excel 미첨부는 저장손익 기준으로 명시. 시네신스220 수정대기/호접485 확인은 연도·차수·기간·원본값 조건으로 분리, 원장 보정 없음.
- 신라 회귀26개 통과. 전체검사·배포·실브라우저 진행 중(미검증).
- 검색어: 신라 작업시작 자동대조 시네신스220 호접485 shilla-check
## 2026-10-21 중국발주 다운로드 버튼 잘림
- 운영 1366px에서 버튼 right=1386.90625 재현. 컨테이너/차수/파일 도구 줄바꿈 및 최대너비 제한. 데이터/환산/원장 변경 없음. 검증·배포 진행 중.
- 검색어: 중국발주 다운로드 버튼 안보임 1366 flex-wrap 단만 단박스

## 2026-10-21 국가별 발주서 품목 정렬
- 전 국가 Excel 출력과 미리보기를 품목명 A-Z(대소문자 무시)로 정렬. 에콰도르는 전산 기본 품목순 이후 사용자 확인한 합포장 인접 묶음 유지. 수량·단위·박스 산식·원장 보존.
- 실제 dnSpy FormQuantityPivot 및 PivotGridFieldBase 기본 Ascending 확인. 운영 조회 파일 재개봉: 네덜란드42-02 74품목/16049송이, 에콰도르42-01 8품목/1150송이 보존. 관련39테스트 통과(선택적 로컬원본3개 skip), dnSpy/manifest/write 가드 통과. 전체 ERP 검사·빌드 통과. PR #1209 CI 최초 통과, 최신 master 통합 CI 및 배포 진행 중(배포 미검증).
- 검색어: 국가별발주서 엑셀 A-Z 품목정렬 에콰도르 합포장 importPedidos CountryOrders

## 2026-10-21 패킹 날짜 확인 후 다음 버튼 무반응 안내
- 금일 서버 로그에는 해당 client 검증 실패 기록 없음. 최신 42-1 CHINA CI 업로드 snapshot에 날짜 확인 미완료. 현재 미저장 브라우저 상태와 구분.
- validateDrafts 실패 시 submitError를 비워놓던 분기 수정: 날짜/총액 사유 등 항목별 즉시 알림창 및 화면 요약. generation 실패 이유도 준비 단계로 전달. 검증 조건·매칭·원문·ERP writer는 보존.
- 단위/관련 회귀31건 및 빌드 통과. 실제41-1 PDF 로컬 브라우저에서 팝업/인라인/날짜 보존·사유 수정 확인. 전체 검사·배포 결과는 세션 문서 후속 기록. 운영 DB 쓰기 없음.
- 검색어: packing next blocked DATE_ORDER_AMBIGUOUS 확인사유 submitError 42-1 CHINA

## 2026-10-21 공통 CALC 차수정렬 승인 후 보정
- 사용자 명시 승인에 따라 정확한 운영 SP 정의의 커서 정렬만 수정하는 수동 도구 추가. 원본 백업·권한/옵션/매개변수 보존, ALTER와 기존 승인 재고 보정을 한 transaction으로 rehearsal/apply. 계산식·Product.Stock·보호 원장 보존.
- 순서/near-miss/교차연도/legacy/단계별 실패 회귀 통과. 전체 gate·CI·배포 및 운영 통합 rehearsal/apply는 진행 중(미검증). docs/work-sessions/2026-10-21_stock-calc-order.md 참고.
- 검색어: CALC CURSOR ORDER BY 공통SQL 정렬 에콰도르 31차 이월 원자보정
- 2026-10-21 추가 실측(사장님 계정 nenovaSS3, 크롬 "사무실 pc" 893da7f6, 운영 df079d26): aging 잔액 22,036,756,225 + 기준일 이후 20,430,000 = 여신한도 22,057,186,225 설명문 표시·입금0 경고 표시 OK · 감사뷰 ShipmentHistory 행 정상(42-02 라움 수국 단가 32.23→33.23 등) · 단가 스냅샷 1회 실행(17:07:13, 기준선) · 클레임 사유코드 8개 시드 완료 · 직원 계정(nenovaSS1)은 403 확인. 미실측: 여신한도 등록·사유코드 연결 저장·주차 마감 상태 저장(쓰기 3종, 업무 값 필요). 검색어: mgmt 실측2 nenovaSS3 스냅샷기준선 사유코드시드 403확인

## 2026-10-21 42-1 격리 입고와 차단 사유 이력
- 실제 PDF→수동 매칭→날짜 사유 누락 오류/SQL 로그→사유 보완→입고 등록/재조회 통과. 64행/186박스/2280단/31450송이/57230CNY. 동일 operation 중복 없음, 전년도·주문·분배 보존.
- REVIEW_BLOCKED/PREPARE_BLOCKED 상세를 기존 audit 로그에 저장. 서버 actor와 eventId 멱등 유지. 운영 입고·재고·매칭 쓰기 없음. 원가 계산은 별도 필수값 미입력으로 미검증.
- 전체검사 통과, WarehouseKey 표시 후속 보완 재검증 및 배포 진행 중. docs/work-sessions/2026-10-21_packing-42-e2e.md 참조.
- 검색어: 42-1 CHINA CI REVIEW_BLOCKED 날짜확인 작업로그 격리SQL
- 입고번호 표시 보완 후 실제42-1 전체 흐름 재실행도 통과. PR1214 CI/배포 진행 중.



## 2026-10-21 신라 확인 탭 확장 주소 호환 보완
- PR #1205 배포 후 기존 확장 background가 하위 경로를 거부하는 실제 문제 확인. 새 메뉴 주소는 유지하고 허용된 기존 주소의 workspace=check로 서버 리다이렉트. 확장 재설치 없이 새 화면 사용.
- DB 쓰기 없음. 기존 638행 실제 조회 성공, 새 경로 자동완료는 배포 후 검증 예정.
- 검색어: shilla-check bridge workspace query redirect 1205

## 2026-10-22 네덜란드·베트남 이월 및 후속 재계산
- native CALC 후 전차수 원장 산식 검증을 재고조정·확정출고 감소/삭제에 추가. 구형 API의 확정수량 수정 우회 차단.
- SQL 보정 미리보기: 승인 두 품목 126 snapshot 검사, 113 변경 예정. 기존 이력·현재고·확정보고서 보존, 에콰도르 재보정 금지.
- 관련 회귀97개 통과. 전체검사·배포·운영보정은 진행 중(미완료). 상세는 docs/work-sessions/2026-10-22_carry-cascade.md.
- 검색어: carry cascade Netherlands Vietnam 후속재고 출고삭제 41차
## 2026-10-22 입고 참고일 차단 분리·박스 현황
- 실제 dnSpy ExcelLoadingPackingList 기준 InputDate/OrderWeek/BoxQuantity 확인. 인쇄 날짜 경고는 보존하되 수량 오류처럼 진행을 막지 않음. 실제 입고일·연도·수량·금액 검증 유지.
- 새 /incoming/boxes 조회 전용: 저장 BoxQuantity, 연도·세부차수·국가·품종 필터, NULL 별도 경고. DB 스키마·EXE·SP 변경 없음.
- 직접 Computer Use로 42-1 PDF→Ammi 수동매칭→입고91001→원가 승인/재조회→엑셀 다운로드 완료(격리SQL). 64행/186박스, 도착원가29048581.029768원. 기존 동일 송장 환율215/품목별 추정 비용 근거 재현. 운영 DB 쓰기 없음. 종료 후 주문·분배 보존 검사 통과.
- 전체 ERP 검사·빌드 통과, 최종 표시 보완 재빌드/PR/배포 진행 중. Excel 자체 머리글 시각검증과 운영 스모크는 미검증. 상세 docs/work-sessions/2026-10-22_receipt-boxes.md.
- 검색어: 42-1 입고 참고날짜 박스현황 186 도착원가 다운로드 격리SQL



## 2026-10-22 분배 업로드 수동 매칭·건너뛰기
- 최신 master aea62143 기반 codex/import-manual-skip 작업트리. Product1717/3085 실측 및 FormShipmentDistribution fresh dnSpy 확인.
- 수동 키 우선/무효키 자동fallback 금지, 명시 품목 건너뛰기/취소, 제외 시 남은 매칭품목 범위 HMAC/coverage/잠금/검증 일치. 제외·파일밖 품목 보존, 포함 품목 누락업체0 정책 유지.
- 신규6회귀·관련 업로드 검사·격리 브라우저 수동→제외→재검증→취소→적용 payload 통과. 필수 전체검사 최종/CI/운영 배포 미검증(후속 예정).
- 운영 쓰기/배포 없음. 사용자 업로드 보호 및 약2시간 유예 유지. docs/work-sessions/2026-10-22_import-manual-skip.md 참조.
- 검색어: 루스커스 40cm manualChoice IMPORT_SKIP_PRODUCT_VALUE replacementProductKeys PR1213 회귀 업로드보호

- 최종 검증: 전체 test:erp-contract 통과, test:nenova-dnspy-evidence/manifest/write guard 통과. 빌드 통과 후 마지막 UI 비동기 선택 처리까지 최종 재빌드 중. 운영 배포/실파일 적용은 유예 및 미검증.

- 완료 검증: 마지막 UI 비동기 수정 포함 최종 npm run build 성공. 최종 산출물에서 격리 브라우저 전체 흐름 및 전부 건너뛰기 안내/비활성 통과. 전체 ERP 계약·dnSpy·manifest·쓰기 가드 성공. PR https://github.com/Jayinsightfactory/nenova-erp-ui/pull/1221 draft 생성, CI는 원격 진행 중. 자동화에 작업트리/PR 인계 완료. 약11:22 이후 업로드 종료 확인 전까지 병합/배포 금지. 운영 스모크·실파일 저장·EXE GUI는 미검증.

- 2026-10-22 입고 박스 후속: 최종 미리보기 표시 보완 빌드/관련64통과1skip/UI/manifest144/writeguard 통과. PR1224 draft 생성, CI 대기. PR1221 업로드 보호 유예 기록 때문에 사용자에게 현재 업로드 종료 여부 확인 중, 답변 전 이번 배포 보류. 운영 DB 쓰기 없음. 검색어: PR1224 입고 박스 배포대기

## 2026-10-22 기존 자동매칭 복구
- 어제부터 자동매칭 품목이 전부 미매칭이며 루스커스가 수국으로 잡힌다는 사용자 확인. 제목보다 행/DB품목 우선, 루스커스 일반/40/50/70cm 분리, 미지원 DB품종명 보존, 수량표시/판정 공통 helper 적용.
- 실제 XLSX→실제 preview 자동매칭/교차연도/제외 포함9회귀 PASS. manifest/쓰기가드 PASS. PC 가용 메모리 부족(일시100MB 이하)으로 전체검사/빌드 프로세스 중단, 운영 배포 전 원격 격리 CI로 전체 재검증 예정. 운영 DB 쓰기 없음.
- 검색어: 자동매칭 루스커스 수국 PR1213 productFamilySource sourceProductFamily import-family-fix
## 2026-10-22 이월 보정 완료와 네덜란드 원가 후속
- PR1225/master78f19ba3, CI39702671667/Cafe24배포39702956142 및 hydration/ping 성공. 이전 항목의1221/1224는 이미 master에 병합된 상태를 확인하고 진행했다.
- native-only 두 품목126snapshot 검산/113수정, rollback rehearsal 및 commit 별도 readback 성공. 이력/현재고/확정보고서 보존. 보정 재실행 금지.
- 실제18·26·31·41 다운로드39704410335 모두 성공. 1~41재고15,692검사 대상문제0. 초기차수 다른18품목21관측,34·35입력경고 및 다른품목 음수재고 남음.
- 수량 복원 후 드러난 네덜란드 오래된 매입의 판매단가 대체를 SELECT-only 취득원가 재현으로 보완. EUR/국가 cache 격리, 베트남 평균원가 공식 유지. 새 작업트리nw-netherlands-acquisition. 최종 CI/배포 진행 중.
- 상세 docs/work-sessions/2026-10-22_carry-cascade.md. 실물/EXE GUI 미검증. 전체정상 주장 금지.
- 검색어: PR1225 carry cascade 네덜란드 베트남 113 126 acquisition EUR 원가이월 재실행금지

## 2026-10-22 ECOUNT 데이터 → 우리 DB `ecount` 스키마 별도 적재(1단계) — 사장님 지시 "ecount db 별도, 검증 후 합치기"
- DB 생성 권한 없음(nenova1_nenova: dbcreator 0, CREATE SCHEMA 1, SQL2016 Web) → 같은 DB 안 `ecount` 스키마로 분리. ecount_work(화면 동등성 작업영역)·web_mgmt 와 별개.
- 구조: ecount.Dataset(13 prgId 사전)·LoadBatch(파일 sha·기간·행수·화면합계·InsertCnt/DedupCnt)·Raw_<PrgId>(이카운트 엑셀 헤더를 한글 그대로 열 이름, RowHash 중복생략, 합계행 IsSubtotal) + 대조 뷰 ecount.cmp_*(views.js 가 실제 열 보고 CREATE OR ALTER). lib/ecountLedger, scripts/ecount-ledger(load-xlsx·backfill-legacy·ensure-schema), /api/ecount-ledger/status(관리자). 계약 ecount-ledger.json.
- 실측: 오늘 데몬 판매현황 엑셀(2026-09-01~10-22, 10,621행, 화면합계 3,060,164,321) load-xlsx 적재 OK(batch 1, dedup 0). cmp_sales_daily: ECOUNT 3,060,164,321 vs 우리 출고(isFix) 3,025,917,101, 차이 34,247,220(1.1%). **일자 기준이 달라 일별 매칭은 어긋남**(ECOUNT 판매일자 vs 우리 ShipmentDtm 기본출고일) → 차수·거래처 단위 대조 뷰 필요(2단계).
- legacy dbo.WebEcountRow 80만행 backfill dry-run: 고유 15,779행(sales 13,885·ar 797·ap 831·cash 266), 영문 열(Payload 키) → 미적용. 엑셀 원본 수집으로 대체 예정.
- 데몬 판매현황 전송 413 원인 nginx 1m → #1226 /api/ecount/ingest 20m. 데몬 세션 기본기간은 전월+금월, 과거 전기간 월단위 수집기는 2단계(데몬 일시정지 후 같은 프로필 사용).
- 검색어: ecount스키마 ecount-ledger load-xlsx Raw_E040207 cmp_sales_daily 3060164321 34247220 일자기준불일치 backfill15779 413 nginx20m

- 2026-10-22 네덜란드 원가 후속 PR1228: 전체 ERP 계약·dnSpy·manifest·쓰기 가드/CI39705549884 통과. 로컬 최초 build는 메모리 부족 상태에서 종료, NODE_OPTIONS 1536MB 제한 재시도 성공. master의 ECOUNT 별도적재 변경은 그대로 보존해 통합 후 재빌드/CI 진행. 검색어: PR1228 네덜란드 취득원가 EUR 장기이월

- 업로드 유예 최신 정정: 사용자의 지금배포 지시로 PR1221은 이미 a051f8bd 배포39701400245 완료. 이전 11:22 대기/업로드 종료 재승인 조건은 이 작업에 적용하지 않음. 이번 자동매칭 회귀도 수정→필수검증→배포 요청의 연속이며 시험 운영분배는 하지 않음.
- 2026-10-22 자동매칭 PR1229 master aa4970be, CI39707238221/격리 build+ERP39707238229 통과, Cafe24배포39707639322 진행. 열린 업로드의 이전 family 키 보존 후속: 동일 시트/품목 유일할 때 수동·무효·skip 복원, 현재 키 우선/모호한 선택 차단. 12개 실행형 fixture PASS. 운영 DB 쓰기 없음. 배포/실브라우저 최종 미검증.
- 검색어: import-choice-stability PR1229 루스커스 수국 이전선택 건너뛰기 family suffix
- 2026-10-22 전체 자동매칭 후속(codex/import-catalog-recovery): 사용자 즉시 수정/배포 승인.3359품목6175이름 전체 비교, 유일 원문 우선/오연결fallback 차단/원문별 선택·이전키 복원. 현재6159명칭 정확키, 실제중복16명칭(8품목) 명시차단, 오연결0.2025/2026 fixture 및 선택/skip 테스트17개 PASS.전체검사/최종build/배포 진행,운영시험쓰기 없음.검색어: catalog-recovery 6175 6159 16 8 269 61

## 2026-10-22 인보이스 이슈 전용 검토
- 원본행 캡처/DB품목 직접선택/이슈만 이전·다음/경고 원문값 유지 기록. 수량·금액 필수검증 우회 없음, SQL writer 변경 없음.
- 42-1 실제 Computer Use 원본 업로드→2이슈 검토→격리입고→원가다운로드 완료.64행2280단/GW·CW1985/시험비용29,048,581.029768원. Order/Shipment보호snapshot 보존, 운영쓰기0.
- NL42-2 실제125행 무료변환·매칭통과. US/AU/TH/EC/CO원본확보, AI최대6회 승인대기. VN41-1 PDF미확보. 국가별전체·Excel실앱디자인·전체키보드 미검증.
- ERP계약/dnSpy/manifest146/writeguard/build통과, PR/배포진행. docs/work-sessions/2026-10-22_invoice-issue-review.md 참조.
- 검색어: invoice-issue-review KEEP_SOURCE sourceCrop 42-1 2280 1985 NL125

- 2026-10-22 후속: PR1235/master7a30f6ef CI39715921668 성공. NL실제UI 전체공용400매칭으로125행(정확1+수동124) 연결, 다음입고준비까지 통과. 중국용62개 fixture와 비교조건 차이를 확인했고 운영문제로 단정하지 않음. Tab/Shift+Tab/방향키/Enter/Escape·초점복귀 확인. 앞선배포39715500053 SSH기본10분초과로 최종빌드단계 중단, 배포timeout30m만 추가하는 후속PR. DB변경없음. 검색어: deploy-timeout 30m PR1235 NL125 400 62

## 2026-10-22 중복 품목 사용자 확인·수정
- 사용자: 중복4쌍은 사용자가 매칭 확인·수정하도록 승인. Product 삭제/병합/영구 기본값 없음.
- 원문 중복 후보를 preview metadata로 반환, 코드·국가·품종·단위·선택연도차수 파일업체 양수주문 표시. 매칭 후에도 별도 확인영역에서 native select로 수정/skip 가능; 기존 productOverrides와 서명무효화/재검증 재사용.
- 기존 DB writer/자동매칭 판단/환산/견적·매출 영향 계약 보존. 실제 dnSpy CLI 및 읽기전용 중복8키 probe 확인. 교차연도/수동재선택/skip 포함 핵심19검사 PASS. 전체 검사/빌드/배포 진행 중, 완료 여부는 후속 기록 확인.
- 검색어: duplicate-review 중복4쌍 사용자확인 코드854 861 952 3464 1846 2030 2195 2197

## 2026-10-22 잔여 재고 대사
-18품목21오차·38품목292음수 재확인.34·35 자료부족은 실재 부재가 아니라 동일수량 native 중간노드 무조건 제외 문제. 검산 연결과 과거오차 추적 보존, 음수 원인/건수 별도표시 보완.
-화이트BOM608만101스냅샷 계획 중4개350→0/3차 이후불변. 나머지17품목은 새 음수 가드 차단. 실사/오류제거 목적 미확인 이력 임의상쇄 금지. 배포·운영보정 아직 미검증; 세션 후속 기록 확인.
-검색어: stock-residual 18품목 34-02A 34-02B 17-01B 화이트BOM 음수
-사용자 후속확인:1월23일4차 장미 조정은 전산 오류 제거 목적.1335/1344만0기초·단일조정·중간순변동0·후속0복원 엄격 패턴 후보; 전체 후속수량 불변 조건.다른15품목 목적만으로 전액취소하지 않음.운영 적용 여부는 후속 기록 확인.

## 2026-10-22 ECOUNT 과거 월단위 수집기 2단계 — 화면별 위젯 확정, 실행은 사장님 지시로 중단
- 성과: 판매현황 2026-07(3,493행·957,134,762)·08(3,898행·1,057,950,340), 거래처등록 790행, 회계거래현황 8월 455행(55.6억), 거래처별채권 8월 83행(16.17억), 거래처별채무 8월 170행(58.07억) ecount 스키마 적재. 잘못 들어간 배치(다른 화면 내용·빈 1행) 6건 삭제.
- 확정: datepicker 2종 — (A) 판매현황 button[data-id=year|month]+#day 중첩 wrapper 2개, (B) 채권/현황류 .wrapper-datepicker.datepicker-range 안 button[data-role=date.selectbox]×4 + input[data-index=2|5]. 프로그램 제목 = div.wrapper-title span.page-name(좌측 메뉴 텍스트로 판정하면 오진). 메뉴 해시 추정(E01→MENUTREE_000001, E04→000004)+메뉴검색 자동완성 폴백.
- ⚠ 사고: 수집기가 데몬과 같은 ecount-profile 을 쓰며 반복 실행 → 데몬 세션 끊김·로그인 창 반복 노출 → 사장님 중단 지시(다른 세션 local_7350c622 가 pid 53268 종료). **수집기 재실행 금지.** 재개 시 조건: 데몬과 프로필 분리(별도 프로필+1회 로그인) 또는 데몬 사이클 안에 월단위 수집을 편입, 그리고 사장님 승인.
- 미검증: 수금현황·구매현황·지급현황·입출금·카드매입·세금계산서현황 월수집(제목 판정 수정 후 미실행), 품목등록 master(9행 의심→삭제).
- 검색어: ecount 수집기 중단 ecount-profile 공유사고 로그인창반복 datepicker 2종 page-name collect-history 재실행금지

## 2026-10-22 주차별 손익 단위·평가·환율 (DB 불변)
- 과거 EstQuantity의 박스/단/송이 단가 혼용을 보고서 전용 분모에서 수정. E/F 동일 선택기, 원본 기반 과거 환율, 누락 원가의 이익·합계 보류. 화면 자동 캐시 쓰기 제거.
- 2026년 1~41차 운영 SELECT 재계산, 독립 산술15,058 항목 불일치0 및 비교 가능한 E/F 불연속0. 원본 수치와 SQL 매출/재고/통관비 차이는 별개. 12~14차 장미 단가 누락·18차 환율 원본충돌 보류.
- 원본32~41 수치 대조 미검증. 최초 기록 시 최종 테스트/PR/배포 진행 중, docs/work-sessions/2026-10-22_profit-unit-valuation.md 후속 확인.
- 검색어: profit-unit-valuation EstQuantity 단위분모 1~41 환율충돌 기초기말 계산보류 DB불변

## 2026-10-22 26~31차 우선 손익 계산 근거
- 엑셀 공통식/예외를 우선26~31로 검증. 사용자 확인: 엑셀 품목 묶음은 편의상이며 전산은 SQL 품목별 단가/수량 사용, 울리부쉬 색상별 단가 별도 확인.
- 판매단가·근사환율·전국 평균/합계단가 대체 제거. 호주 실제 SQL 품목 매입+당시 정확환율 재구성. DB·확정 revision·재고 수량 수정 없음.
- 원본858+23 계산 일치, 1~41 독립 산술15,058 실패0 및 비교 가능한 E/F 불연속0. 전체 ERP검사/빌드 성공. 전후 관측 DB 지문 동일.
- PR1249, 최초 기록 시 CI/배포/운영 스모크 대기. 중국26/27 E/F·28 E도 같은 품목19-01 실제 매입/정확환율/도착원가로 해소해 26~31 원가/환율 누락0. 태국38~41 및 초기 일부 원가/18차 환율은 확인 필요.32~41 원본 대조 미검증.
- 검색어: profit-excel-rulebook 26~31 SQL품목별 호주CNF 판매단가배제 1~41 DB불변

## 2026-10-22 주광 장미 출고일·재고 판정
- 실제 usp_ShipmentFix는 차수 검산, 주광은 Product.Stock 선차단이라는 불일치 수정. native 증감·cascade·실제 부족 rollback 보존, 임의 재고조정 없음. EXE에서 수정된 운영 날짜/수량 보존.
- 격리 SQL lifecycle·새 날짜 인쇄/옛 날짜 빈 출력, 교차연도·실패 rollback 통과. ERP 계약·dnSpy·manifest·write guard 성공. 최초 기록 시 빌드/배포 최종 미검증; 세션 md 후속 확인.
- 검색어: weekday-stock-date native-week-ledger 플라야블랑카 주광 STOCK_SHORTAGE
## 2026-10-22 태국 매입 원가 이월
- DB 무변경. 태국34차 매입의 FIFO 창 종료 후 누락, 현재 환율 혼입 수정. 최근/과거 이월에 정확 매입차수 환율 공유. legacy 단자리 차수 정규화.
- 운송기준원가 통관 기본값과 손익 H는 별도이며 실제 청구 확인 완료가 아님을 웹 경고에 표시. 실제 청구서 원본 미검증.
- 최초 기록 시 전체검사/1~41 검산 진행, 최종 PR/배포는 docs/work-sessions/2026-10-22_profit-thai-carry.md 후속 확인.
- 검색어: profit-thai-carry 태국34차 38~41 과거매입 exactFX 통관기본값 DB불변

## 2026-10-22 태국 SQL 실제 비용
- DB 쓰기 없음. 34차 입고 운송료 존재, 통관실비·원가스냅샷·수기H 없음. 기본값/트럭추천을실비로사용하지않게 수정.
- SQL 실제H와입고운송료 완전성, 연도/차수/AWB/품목, 단위·합계 보존. 누락은0원/다른차수/샘플평균 대체하지않고 최종이익률보류.
- 최초 기록 시 전체 gate/1~41 재대사 진행중. 최종 PR/배포는 docs/work-sessions/2026-10-22_profit-thai-actual-cost.md 확인. 실제 통관청구액 자체는 미검증.
- 검색어: profit-thai-actual-cost 태국34차 통관실비 actual_cost_missing 320200 168200 DB불변
## 2026-10-22 ECOUNT 과거 전기간(2024-01~2026-10) 수집 완료 — ecount 스키마 적재 결과
- 전용 프로필(scripts/ecount-ledger/_profile, 데몬 프로필 복사로 자동 로그인) 1·2차 실행. 적재: 판매현황 142,917행(35배치) · 구매현황 12,991 · 수금현황 6,667 · 지급현황 2,134 · 거래처별채권 2,492 · 거래처별채무 2,730(~2026-08, 2026-09/10 미수집) · 회계거래현황 10,000(월 상한 의심) · 매출세금계산서현황 1,960 · 매입세금계산서현황 3,009 · 카드매입 3,518(2025-01~) · 입출금 47(과거월 조회가 ECOUNT 입력오류로 거부, 미수집) · 거래처 790 · 품목 3,571.
- cmp_sales_week(차수·거래처): 2026 34~42차 ECOUNT가 우리보다 1~5% 작음(예 40차 5.01억 vs 5.14억). 43차 ECOUNT 0(미입력). 거래처 매칭 ecount_only 4,817·ours_only 833 → 거래처명 매핑 정비가 다음 과제.
- 잔여 실패: 입출금 과거월(22), 채무 2026-09/10(click timeout), 산발 month 설정(12), 구매 엑셀 미시작(2). 회계거래현황 월 10,000행 상한 여부 확인 필요.
- 검색어: ecount 전기간수집완료 142917 cmp_sales_week 거래처매핑 ecount_only4817 입출금과거월거부 채무0910미수집 회계거래10000상한

## 2026-10-23 주차별매출 승인 비용 추정
- 사용자 승인 백상460원/kg·합산중량 차량비·태국 누락 관세5%·선율 패턴을 보고서 전용 적용. 실제0/수기/확정본·ERP DB 보존.
- 미매칭 비용은 별도 배분 풀에 남기며 가짜 품목 생성 없음. 추정 출처를 재고 FIFO/과거 이월까지 표시.
- 전체검사/build·1~41 독립15,058 산술 실패0, 입력/수량변경0·원장 지문 동일. 배포/운영 스모크는 최초 기록 시 미검증. 태국39 GW/40 국제운임 누락은 유지. 계획 docs/plans/profit-approved-cost-2026-10-23.md 참조.
- 검색어: profit-approved-cost 460원 3톤286000 태국5% 승인추정 DB불변

## 2026-10-23 태국 기존 입고 원가 연결
- TH 기존 입고 원가 전용 연결, 인보이스 송이 FOB/ERP 단 원가 구분. 명시 패킹 그룹 박스 배분과 합계 검증. 기존 입고 수정 없음.
- 전체 ERP 계약·dnSpy·manifest·쓰기 가드·build, 격리 MSSQL 저장/재조회/엑셀/ERP 불변 통과. 운영 배포·원가 저장·다운로드는 배포 전 현재 미검증.
- 검색어: thai-existing-cost SuperFresh 6902981 38-01 PACKING_GROUP 기존입고7345
- 후속: PR1257 배포 성공, 운영 기존입고7345 원가 연결 성공. 자동 공식 그룹 입력 초기화 누락 발견→initialForm 보완·입력/복원 테스트 통과. 원가 승인/엑셀은 후속 배포 후 검증 예정.
## 2026-10-23 중국 포함 통관기간 과세환율
- InputDate는 EXE입력일자. 등록국가 승인고시주간을 보고서 전용 적용하고 중국은32차이후 다음ISO주간. 실제통관일 인증과 구분해 추정표식 유지. 원본26~31 양수환율59셀 일치, 중국29차예외 보존.
- 실제저장환율/수기/확정revision 보호. DB쓰기없음.1~41 전후SELECT대조15,058산술 실패0·입력/수량변경0·관측원장지문동일·E/F불연속0.1~27결과불변.
- 최초기록시 최종전체검사/배포 미검증. docs/plans/profit-customs-rate-timing-2026-10-23.md 후속결과확인. 태국39/40 기존근거부족보류 유지.
- 검색어: profit-customs-rate-timing 중국환율 59셀 InputDate입력일자 다음고시주간 DB불변

## 2026-10-23 주광 박스 낱개 입력
- 클릭/F2 박스+단/송이, 방향키 기존 박스 입력. dnSpy N2 표시와 float 저장 구분, 마스터 환산 및 낱개 합계 보존. 운영 ERP 쓰기 없음.
- 격리SQL 복수날짜 낱개 합산/인쇄와 Chrome 컴포넌트 입력/방향키/ESC 확인. 전체 gate/배포 최초기록시 진행중, 세션문서 확인.
- 검색어: weekday-box-parts 카네이션 수국 박스 낱개 N2

### 2026-10-23 주광 박스 소수 첫째 자리 표시
- 사용자 확인: 실제 박스 소수값 한 자리 (1박스+3단/15단포장=1.2). 박스·낱개 입력창 표시만 변경, 저장 정밀도 보존. PR1256 본 기능 병합 후 추가 요청.
- 검증/배포 진행 중. 검색어: weekday-box-one-decimal 소수첫째자리 박스낱개 1.2

## 2026-10-23 호주·미국 인보이스 분리 배포
- 사용자 요청으로 AU/US만 최신 master에 분리. TH는 다른 세션, CO/EC 미배포 작업 제외. 운영 DB 무변경.
- Woolly bush 파일별 분류·PDF 대조·합계 검증·공용매칭 금지. US 국가별 ProdKey 선택 및 EXE 동일명 다운로드 안전차단.
- 격리 SQL AU56박스/15500송이, US70박스/43750송이 입고→원가→다운로드 통과. TEST_ONLY 두 시트 표시 회귀 통과.
- 전체 ERP/dnSpy/manifest/write guard 통과. 최종 모달 portal/너비 수정 후 빌드·브라우저 및 PR/배포 대기. 후속 결과 docs/work-sessions/2026-10-23_au-us-release.md.
- 검색어: au-us-release Woolly bush TEST_ONLY ProdKey 파일별분류 운영DB불변

## 2026-10-23 네덜란드 인라인 작업 진행 중
- 별도 nw-dutch-inline-workflow, codex/dutch-inline-workflow. 업체 열 축소/전체 zoom 제거/반복 단가 문구 제거 초안.
- 실제 dnSpy ClassProduct Descr 공유 확인. 색상 별도 웹 저장 또는 공유 비고 수정 선택 대기. 추가 팝업/등록분배/인쇄/재업로드 미구현.
- 전체 ERP 검사/빌드/브라우저 미검증, PR/배포 없음. 운영 원장 무변경.
- 검색어: dutch-inline-workflow 칼라 Descr 업체36px 원본팝업 미배포

## 2026-10-23 네덜란드 레이아웃·칼라 배포 검사
- 사용자 Product.Descr 저장 확정. CAS·기존 설명 보존·전체 품목 readback·감사 원자 저장 구현. 원장 운영 시험 쓰기 없음.
- ERP 전체/컬러/UI/dnSpy/manifest/write guard/build 통과. 실제 컴포넌트 브라우저 열36px/전체 늘어남 없음 확인.
- 이번 배포 범위는 레이아웃·칼라. 업체추가 팝업/인쇄/재업로드는 미완으로 명시. PR/운영 스모크는 다음 기록 참조.
- 검색어: product-color Descr 칼라 CAS compact-layout
## 2026-10-23 주광 인쇄 적요·박스 선택
- 수량 적용→재조회→윌슨/Excel/인쇄 격리 SQL 검증: 카네이션1단/18단, 수국1송이/33송이 통과. 합계/잔량 정밀도9자리.
- 출력마다 박스 표시 선택, 비고 대차수만, 품목 적요 web runtime 저장(CAS) 및 실패 인쇄차단. 운영 ERP 원장 보존.
- Chrome 격리 컴포넌트 입력/저장/재열기/실패/Tab 확인. 운영 배포 후 스모크는 후속 기록. 실제 종이 출력 미검증.
- 메뉴 기준 적용: shell/키보드/오류보존; 신규메뉴 해당없음; 명시적 인쇄모달 스크롤 예외.
검색어: weekday-print-edit 박스 송이 단 적요 저장 인쇄 XLSX

## 2026-10-23 인보이스 도착원가 본표 자동 연결
- 현재 승인 ACTUAL을 기존 본표 검색/품종/페이징/누락판정에 연결. 기존 엑셀 같은 업무키는 상세 비교로 보존, ERP/원가 쓰기 없음.
- 태국2026/38-01 입고7345 자동19행/비교19행 실제 읽기 검증. 교차연도·stale·단위·과거문서 후보 회귀 통과.
- ERP 계약/dnSpy/manifest/write guard 통과. 빌드/배포/운영 브라우저는 후속 기록 전 미검증. 세션: docs/work-sessions/2026-10-23_invoice-arrival-unified.md.
- 메뉴 기본값: 기존 shell/키보드 상세 펼치기/출처·오류 안내 적용. 인보이스는 기존 단순 환율식 차단, 수입부 재승인 안내.
검색어: invoice-arrival-unified 자동 원가 본표 엑셀 비교 7345 38-01

## 2026-10-23 주광 최초 진입 명시 조회
- 메뉴 진입은 연도/차수/조회 폼만, 조회/Enter 후 Workspace 동적 로드. 명시 선택은 defaultNext 요청으로 덮어쓰지 않음.
- 최초 렌더 mount/fetch 0회 및 교차연도/무효입력 테스트, Chrome 입력만으로 조회하지 않음/Enter로2026-43 전달 확인. ERP 원장 변경 없음.
- 기준선 shell/키보드/스크롤 적용; 신규메뉴/ERP쓰기 변경 해당없음; 예외없음. 배포 후 검증은 PR 참조.
검색어: weekday-explicit-query 조회버튼 최초진입 동적로딩

## 2026-10-23 주광 인쇄 양식 보완
- 차수 표시 문서별 web CAS 저장, 고객Tel SELECT, native 반복 페이지여백/행분할방지/머리글 반복. 원장 불변.
- Chrome 85행 미리보기 차수편집/Tab/재열기 확인. 실제 종이·인쇄페이지 분할 미검증, 직인원본 확인 대기. 게이트/배포 PR참조.
- 이전 PR1263 조회버튼 배포 및 운영 Chrome 검증 완료.
검색어: weekday-print-native 차수표시 TEL FAX 페이지나눔 직인

## 2026-10-23 국가별 평균 도착원가 근거 표시
- 엑셀26~31 국가별 검토: 콜롬비아5품종·베트남 평균식, 호주 품목별 외화원가, 기타 직접입력/미확인 구분. 모든 국가 평균으로 임의 확대하지 않음.
- 기존 실제 E/F 평가에 평균단가·총원가·매입수량·환산수량·평가기준차수 표시. 단위혼합/무매입/승인추정/확정본 근거미보관을 구별. DB/수치계산 변경 없음.
- SQL26~31/41차116행 전후 수치/입력/재고 차이0,232근거 중 평균66건 산술확인,관측원장 지문동일. Chrome desktop/mobile 렌더·키보드 통과.
- 전체게이트/배포/운영브라우저는 후속 기록 전 미검증. 상세: docs/work-sessions/2026-10-23_profit-average-landed.md.
검색어: 평균 도착원가 국가별 재고평가 콜롬비아 베트남 FIFO 단위혼합

## 2026-10-23 주광 직인
- 사용자 PNG를 공개 저장소 제외/배포 secret 보관, 인증된 출력 응답에 포함. 회사정보 우측 21mm 직인. 원장 변경 없음.
- Chrome 85행 미리보기 직인 및 표 선 겹침 확인. 실제 종이 출력 미검증. 필수 검사/배포 PR 참조.
- 기준선 적용: shell/키보드/스크롤 유지. 신규 메뉴/원장 쓰기 해당없음, 예외없음.
검색어: weekday-stamp 네노바직인 인증출력 회사정보

## 2026-10-23 네덜란드 명시 조회·칼라 dialog
- 초기/연도 effect는 차수 목록과 기본값만 준비, 물량은 버튼으로만 조회. 기존 업로드/저장본/분배 경로 보존.
- 칼라 prompt/confirm을 페이지 dialog로 교체. 전체 비고 전후 표시, 취소/Escape 무쓰기, 저장 중복 방지, 실패 입력 유지, 초점 복귀.
- 실제 dnSpy ClassProduct/FormQuantityPivot 확인, SELECT-only 품목 schema/trigger probe 재실행. SQL/API writer 변경 없음.
- 관련 실행 검사/빌드 통과. 전체 gate·PR·배포 결과는 세션 기록 후속 참조. 운영 저장 시험 없음.
- 검색어: dutch-explicit-load prompt not supported 칼라 dialog 명시조회

## 2026-10-23 네덜란드 원본 표 업체 추가
- 업체 popup 선택 → 현재 시트 지역별 수량 열 표시. 원본 workbook 불변 projection, 추가 entries/지역 저장 복원, 기존 명시 검토·분배 계약 유지.
- 표 전폭과 반복 품목명 두 줄 제한. 전체 검사/배포/실화면 확인은 docs/work-sessions/2026-10-23_dutch-inline-add.md 참조. 운영 시험 분배 없음.
- 검색어: dutch-inline-add 업체추가 지역배치 반복품목명 전폭
## 2026-10-23 차수 버튼·견적 행 간격
- 첫 조회 차수 ▲▼56x44px, 웹 견적 한 줄4.8mm/여러 줄 자동확장, 빈 적요 입력도1줄. 수량·금액·원장·EXE 무변경.
- Chrome 경계/키보드/자동행높이·적요저장 확인. 실제 종이 출력 미검증. 게이트/배포 PR참조.
- 기준선 shell/키보드/스크롤 적용; 원장쓰기 해당없음. native 행높이 변경은 사용자 요청 예외.
검색어: weekday-week-buttons compact-item-row 차수버튼 행여백
## 2026-10-23 콜롬비아 수국 42-1 원가 확장
- 별도 CO_GROUP_42_1_V1 / CO_42_1_ORIGINAL_V1. 기존 승인 원가와 태국 정책 보존.
- 격리 SQL에서 실제 송장 2914의 6품목 48박스/1440송이 입고→TEST_ONLY 원가→XLSX 통과. 운영 DB 수정 없음.
- 1350/1400 독립 산식·원본 서식 검사 통과. 브라우저/배포 결과는 세션 기록에서 후속 확인. 전체 PDF 7송장 전수 미검증.
- 기록: docs/work-sessions/2026-10-23_colombia-hydrangea-42-1.md
- 검색어: CO_GROUP_42_1_V1 HYDRANGEA 콜롬비아 수국 42-1

## 2026-10-23 SQL 수량 기준 4국가 평균 도착원가
- 소액 수기 차이 허용/평균 틀 승인에 따라 NL·TH·CN·EC 매입·재고 단위를 정규화. 같은 StockKey, 동일 상품 범위, 비용누락·환산충돌 fallback, 수동0·음수 보존.
- NL China Pink/China white/Domenichina4품목 국가 오인 수정, CO/아나나스 CHINA placeholder 보존. DB 쓰기 없음.
- SQL1~41 paired43,406 SELECT,16,257 산술/연속성/범위 검사 실패0, 관측원천 지문 동일. NL1959·EC3227 충돌은 기존 품목원가 유지.
- 회귀16개+실제API통합/분류 parity 통과. 전체 gate/build·PR/배포/브라우저 최종상태는 docs/work-sessions/2026-10-23_profit-country-average.md 참조. EXE GUI·종이인쇄 미검증.
- 검색어: profit-country-average 평균도착원가 China Pink Domenichina 태국루스블룸 샘플150 튤립1959

## 2026-10-23 최신 승인 도착원가·호텔 환율 비교
- 호텔 원가 참고 표시를 인보이스 APPROVED ACTUAL 및 기존 엑셀 이력에 연결. 선택 연도 최신 세부차수 기본, 이전/다음 조회.
- 사용자 확정: 환율은 도착원가 표시만 비교. 매입액·이익·확정 원가·운영 DB 보존.
- 실제 읽기514이력/43인보이스, 격리 CUA 환율/차수/오류 검사 통과. 계약 게이트 통과; 배포/운영 화면 결과는 세션 문서 후속 참조.
- 검색어: landed-fx-history ArrivalFxControls loadHotelArrivalHistory 도착원가 환율 비교

## 2026-10-23 자동 중국 물량표 편집·등록분배
- 명시 조회, DB 품목/업체 추가·교체, 지역/요일/업체, 수량 직접입력, 인보이스 품목 분할, 초과/부족 목록.
- 등록분배는 명시 셀 SET. 기존 주문 전체 행 보존 검사, 없는 양수 주문만 신규. 단회계획/동시수정/확정/날짜/농장 가드·원자 rollback 유지.
- 격리 중국/네덜란드 SQL·전체 ERP·dnSpy·manifest·write guard·빌드 통과. Chrome 합성 입력 검증. 운영 시험 분배 없음. PR/배포/운영 화면은 세션 기록 후속 참조.
- 검색어: china-volume-edit 중국물량표 품목수량분할 기존주문보존 등록분배 지역 업체추가
# 2026-10-23 중국 물량표 배포 후 확정 사유 보완
- PR #1273/b62f8b5c Cafe24 배포 성공. 운영 조회·품목/업체 DB 검색·지역 창·주문200→200 미리보기 확인, 실제 저장 없이 취소.
- 확정 출고 사유가 요약 DB키 부재로 누락되어 keyed rows에서 추출하도록 보완. 원장 쓰기 로직 변경 없음. 실제 SQL 및 단위 회귀에 확정 사유 검증 추가.
- 검색어: china-volume-fixed-message 중국물량표 확정출고 사유누락 주문보존

## 2026-10-23 최신 도착원가 참고 통합
- 카탈로그·물량/전산피벗 공용 최신 조회, 입고/운송원가/재고평가 상세 최신 참고 별도 표시. 과거 계산·확정 원장 writer 변경 없음.
- dnSpy/SELECT-only/153품목·122최신인보이스/격리CUA/전체게이트·빌드 통과. PR·배포·운영 UI는 세션기록 후속 참조(현재 미검증).
- 검색어: arrival-display-unify loadLatestArrivalReferences 최신 승인 도착원가 참고

## 2026-10-23 네덜란드 Excel 추가 업체 왕복
- 화면 전용 추가 업체가 다운로드에서 누락되던 경로 수정. 지역별 실제 열·최종 수량·합계·단가 좌표와 ERP적용초안 V1 매칭/단위/차수 연결.
- 2회 XLSX 왕복 및 실제 격리 SQL preview/apply 동일 최종값 확인. 기존 주문·교차연도·Estimate/Stock/Warehouse 보존, 확정/동시수정/rollback 유지.
- dnSpy 실제 재실행, SELECT-only 운영 기준선 확인. 운영 시험 분배 없음.
- 전체 ERP 계약/pivot/dnSpy/manifest/write guard/layout/build 통과. 배포·운영 브라우저 검증은 세션 문서 후속 참조.
- 검색어: dutch-xlsx-roundtrip ERP적용초안 추가업체 재업로드 동일분배
## 2026-10-23 중국 물량표 dnSpy·등록분배 MD 재감사
- 사용자 확인: 기존 주문100은 보존하고 분배80, 새 업체/품목은 주문·분배 동시 등록.
- actual dnSpy FormOrderAdd/FormShipmentDistribution 및 운영 SELECT 재확인. 오래된 FormOrderAdd.md 양수 주문 덮어쓰기 설명 정정.
- 격리 SQL에서 신규 주문 Est8(기대80) 반례 재현 후 중국 전용 native 환산·readback 보완. 삭제 출고헤더의 중복생성도 공통 snapshot 단계에서 차단.
- exact100/80, 신규업체8단/80송이, 기존 주문 전열 보존, 반복/감소/0, 교차연도, 환산변조 rollback, 삭제헤더/경합 테스트 통과. 운영 쓰기 없음. 배포 후 결과는 세션 기록 참조.
- 검색어: china-order-guard-review 주문100 분배80 EstQuantity chinaOrderUnits 삭제출고헤더 dnSpy

## 2026-10-23 네덜란드 물량표 업체·지역·입고 품목
- CL 별도 행, 지역별 전체 업체 열 이동, 업체/품목 추가 팝업 분리, 주문 없는 입고표 표시.
- 실제 dnSpy·SELECT-only와 격리 SQL, 왕복/교차연도 fixture 확인. 원장 저장 경로 불변.
- PR·배포·운영 스모크는 docs/work-sessions/2026-10-23_dutch-arrival-layout.md 후속 기록 참조. 현재 미검증.
- 검색어: dutch-arrival-layout CL분리 지역이동 입고전용 품목추가

## 2026-10-23 중국 물량표 지역·요일·엑셀
- 지역/요일 native 선택, 미저장 변경 초기화, 확정/매칭 상태 무관 다운로드 및 동일 데이터 미리보기. 업체명/CL 별도 헤더 셀. ERP writer 변경 없음.
- 교차연도 엑셀/작업본 테스트. 전체 검증·배포·운영 UI 결과는 세션 문서 후속 참조.
- 검색어: china-board-options 지역선택 요일변경 변경초기화 엑셀미리보기 CL셀분리

## 2026-10-23 주광 수량 소수 한 자리
- 일반/윌슨 입력 및 숫자 상세를 소수 한 자리로 표시. 초안/환산/API 원본 정밀도 보존, 일반 박스+낱개 창에 반올림값 전달 방지.
- 실행형 컴포넌트/Chrome 격리 검증: 1.066666667→1.1, 대화상자1박스+1단, Tab/ESC 무저장, 명시 초안 값1.066666667 유지.
- 빌드/dnSpy근거/manifest/write guard/layout 통과. 전체 ERP 및 배포는 세션 문서 후속 참조, 운영 시험 저장 없음.
- 검색어: weekday-quantity-display 소수첫째자리 일반윌슨 원본정밀도 blur무저장


## 2026-10-23 중국 품목·업체 즉시 검색
- 닫힌 select 필터 대신 입력 아래 후보 목록. 이름/코드/복수어 검색 및 키보드·IME 보호. ERP writer 변경 없음.
- 검색어: china-search-suggestions ChinaSearchSelect 자동완성 연관품목 업체추가
## 2026-10-23 승인 원가 격리 통합 검증·정수 표시
- 실제 CO43-2 송장2914 캐시6품목으로 격리 SQL 입고/원가승인/재승인/엑셀 통과. 운영 DB 미접속.
- hotel/catalog/pivot/incoming 실제 조회 함수의 최신43-2·단위 환산 일치. 과거원가 및 주문·출고·재고·입고 원장 snapshot 보존.
- 실제 Next 페이지 라움/초이문/카탈로그/기존웹피벗/입고에서 조회 확인. 비원가 UI 데이터는 fixture, 전산피벗 전체 UI와 원본업로드부터 무가공 단일E2E는 미검증.
- 사용자 후속 요청에 원가 표시만 원 단위 반올림; DB/API/엑셀 계산 정밀도 유지. 후속 코드 미배포.
- 검색어: arrival-approval-e2e 송장2914 소수점 정수표시 원단위반올림 최신승인원가

## 2026-10-23 SQL 비용 연결·활성 입고 환산 복구
- DB SELECT만.40차태국 EXCEL운임640.75 USD,4차수국 같은세부차수 InvoiceNo→실제AWB운임7938.7 USD 복구.758비용행 합계/행수 보존.
- NL29/31 zero-anchor후 실제입고환산,EC33~35 미소진150+250송이 합산. NL09 모순/18부분FX/35NL운임없음/39TH무명중량은 임의보완 금지.
- 최종1~41 paired44,386 SELECT/9094검사 실패0·E/F불연속0·원장/비용/수기/확정/스냅샷SHA동일. 변경55셀은 복구항목과다음기초에만 존재. 첫지문변동실행은 최종근거에서제외.
- 관련회귀·전체gate/build 통과 후 최신master통합 재검증/배포 진행. 최종PR/운영브라우저는 세션문서 후속기록 참조. EXE GUI·실제인쇄 미검증.
- 검색어: profit-source-recovery EXCEL640.75 수국7938.7 zero-anchor EC400송이 partialFX DB불변

## 2026-10-23 입고 박스·중량 현황
- 기존 독립 메뉴를 차수/월/연도 및 국가/품종 조회로 확장. 박스는 저장값, GW/CW는 입고키별 한 번만; 혼합 중량 별도.
- 실제 CO/AU/US 캐시 인보이스 격리 입고→현황48/56/70박스, 27조합/교차연도/NULL/삭제/혼합 readback 통과. 운영 DB 무접속·원장/SP 변경 없음.
- 실제 페이지 CUA 필터 검증, 전체gate/build 통과. 1920화면 미검증; 최종 PR/배포는 세션 기록 후속 참조.
- 검색어: receipt-box-weight-summary 입고박스 중량 월별 연도별 혼합입고 WarehouseKey

## 2026-10-26 신라·라움 환율 적용
- 통화 매핑 누락·VAT별도/송의 셀 제목·초기 배열형 원본 누락을 웹 참고 조회에서 복구. 원본/ERP/매입단가 쓰기 없음.
- 실제 dnSpy/SELECT-only4873참조, 비교 가능309개 복구. 원본환율/단위 부족36개 명시 보류.
- 교차연도/원본복원/잘못된환율/중복제목/배열단위 회귀 및 CUA 입력·Enter 확인. 최종gate/PR/배포 결과는 세션 문서 후속 기록 참조, 현재 미검증.
- 검색어: hotel-arrival-exchange 신라 라움 환율 도착원가 RawJson 배열 VAT별도 COUNTRY_CURRENCY_MAP

## 2026-10-26 물량표 가이드·즉시 합계
- 네덜란드 단계 안내/끄기 저장, 양국 수정 고객합계 기준 주문·잔량 화면/XLSX 동기화. ERP writer 변경 없음.
- 전체 ERP gates/build/pivot/격리 SQL 및 CUA 양국 5→8, 입고20/잔량12 확인. 운영 시험 쓰기 미실행; 배포 결과 세션 기록 참조.
- 검색어: volume-guide-totals 네덜란드 중국 가이드 주문 입고 잔량 수식캐시

## 2026-10-26 인보이스 입고 scope 문자열 오류
- 빈 연도·차수를 null로 보내던 payload 수정, 명시 orderWeekDate 차수 보존, 저장 전 한국어 안내. 매칭값·ERP writer·재고/원가 불변.
- focused 51건 통과. 전체 gate/build/배포는 세션 문서 후속 결과 확인. 실제 실패 파일 개별 원인은 미확정이며 운영 입고 시험 미실행.
- 검색어: invoice-scope-type orderYear orderWeek must be strings receiptScopeIssue 입고 연도

## 2026-10-26 인보이스 연도 자동 입력·검증 실패
- 최신 지시로 인보이스 날짜 연도 자동 제안 허용. 명시 선택 우선, 충돌 확인, 현재연도 fallback 없음. 이전 수동 정책 대체.
- 2026/44-01 CO 문서966a9e13의 generic503 원인은 기존 음수 주문을 대조 함수가 거부한 것. 순합산 보존 수정 후 SELECT-only 실제 preview151행 정상, 입고일/농장 누락만 안내. 운영 DB 변경 없음.
- focused73 통과, CUA 격리 UI 확인. 전체검사/배포 후속은 세션 MD 참조. 실제 운영 입고 쓰기는 미검증/미실행.
- 검색어: invoice-auto-year-preview invoiceDateYear signed orders 44-01 INPUT_DATE_REQUIRED FARM_REQUIRED

## 2026-10-26 인보이스 초안 재개·다음 단계
- 고정 문서ID source 재준비가 revision을 지우고 재업로드가 GET 없이 POST하여 중복409 발생. 기존 저장 문서 자동GET/검증 재개, source 변경 3-way 병합, null revision 보존,409 한국어 복구 안내.
- 집중56/ERP gates/build/격리 SQL 통과. CUA 실제 Workbench rev3 next→refresh→수정PATCH rev4→next→입고 확인 모달 검증. 운영 DB 수정 없음. 운영 인증 후 버튼 조작 미검증.
- 상세·배포 결과: docs/work-sessions/2026-10-26_invoice-draft-next.md.
- 검색어: invoice-draft-next source-resume POST can only create revision PATCH

## 2026-10-26 피벗 필터 동기화·초기화
- 기존 화면 헤더/필터 영역 선택 동기화, 국가/품종 하위 조건 해제, 마지막 체크 0행 수정. 양쪽 상단 전체 초기화 및 전산 피벗 관련 품목 선택 초기화.
- 실제 dnSpy FormQuantityPivot 및 SELECT-only43-02 대조. API/SQL/ERP 원장 변경 없음.
- 전체검사·브라우저·배포 결과: docs/work-sessions/2026-10-26_pivot-filter-sync.md (진행 중 단계는 미검증).
- 검색어: pivot-filter-sync 국가 품종 필터 고정 초기화 fieldFilters __EMPTY__ linkedFilters
## 2026-10-26 인보이스 자동 입력·연속 실행
- 최초 자동 분석, 정상 매칭 후 자동 준비, 원문 날짜·유일농장·AWB AIR 제안, 선택 문서 입고/원가 연속 실행. 동일 송장 농장 약칭 중복 차단.
- 44-1 송장25529 7행107박스3210송이 격리 SQL/CUA 입고→시험원가 저장→엑셀 다운로드 확인. 운영 DB 수정 없음.
- 전체12페이지 AI 검증 아님. 나머지 페이지/실제 비용 미검증. 전체gate/배포는 docs/work-sessions/2026-10-26_invoice-auto-flow.md 후속 확인.
- 검색어: invoice-auto-flow 44-01 25529 Balverde 23OCT2026 AIR onebutton TEST_ONLY

## 2026-10-26 중국 단계 안내·양쪽 작업 초기화
- 중국 상태별 말풍선/버튼 강조/끄기 저장. 중국·네덜란드 미저장 변경만 마지막 작업 저장본으로 복구. 저장 이력/ERP/품목 비고 보존.
- ERP gates/build/실제 함수 실행 통과. 격리 화면 저장·수량·가이드 유지 확인. 네이티브 확인창 이후 시각적 복구는 브라우저 제어 오류로 미검증.
- PR·배포 후속 결과: docs/work-sessions/2026-10-26_china-guide-reset.md.
- 검색어: china-guide-reset 작업 초기화 마지막 저장본 BoardKey guideSavedStamp

## 2026-10-26 GW 자동입력·CW 직접 입력
- evidence-only 중량을 미리보기/결과/입고에 동일 적용. 같은 원본의 빈 미등록 초안만 복원. 수기/0/기등록 보존, GW/NET→CW 추정 금지.
- 격리 Chrome44-1 대표7행107박스3210송이 GW759.7/CW시험800 입고→원가 승인·재조회→다운로드 확인. 운영 입고/원가 변경 없음.
- 전체12페이지 AI 미검증. 최종 캡처는 브라우저 도구 오류. 배포 결과는 docs/work-sessions/2026-10-26_invoice-weight.md 참조.
- 검색어: GW CW review_evidence packingWeight weightManual 44-01 25529 TEST_ONLY

## 2026-10-26 물량표 메뉴 단일차수·입고 기본
- 사용자 확정: 실제 입고 최신차수 우선. 미래 주문50-01 대신 현재 양수입고44-01 기본, 한차수 선택 및 앞뒤5개 버튼. 범위모드는 명시 체크로 유지.
- 연도별 조회·다운로드 범위 일치, 조건변경시 품종목록 폐기. ERP 쓰기 없음. dnSpy/SELECT 근거·기준표: docs/plans/volume-menu-week-2026-10-26.md.
- 빌드/전체 ERP 계약/국소·피벗/manifest/write/dnSpy/UI layout 통과. 격리 실브라우저 단일·범위·방향키·직접입력·교차연도·빈기록 확인. 배포 결과는 세션 md 후속 기록.
- 검색어: volume-menu-week 50-01 44-01 최신입고 단일차수 앞뒤5개 volumeMenuQuickWeeks

## 2026-10-26 주광 차수/자동 갱신
- DOM step 대신 React 값 기반 차수 증감. 기준 미리보기 INVALID_ERP_DATES는 확정 불가로 남기되 분배 갱신은 허용. 과거 선출고 GET2000..2200,POST2026+불변.
- dnSpy ClassShipmentDate/운영 SELECT 근거: docs/plans/weekday-refresh-2026-10-26.md. DB 변경 없음. 배포 검증 진행 중.
- 검색어: 주광 44 43 1 자동갱신 EstQuantity NULL INVALID_ERP_DATES 2025 52
- 검증추가: 전체 ERP계약/dnSpy/manifest/writeguard/UIlayout/build통과,대상29건. 격리 Chrome44→43 및 키보드/조회값43 유지 확인. PR/배포 진행.

## 2026-10-26 도착원가 원본 기본값 복원
- CO42-1 원본 고정 문구/기본 통관비/계수/수식을 별도 원본 양식 계산 탭에 복원. 승인 스냅샷 보존, 기본값 미승인·차액 명시. 현재 데이터만 대입.
- 44-1 수국 12송장/39행/619박스/18,710송이 격리 replay 다운로드, 25529 파일 재계산/수량·환율 변경/시각검증 통과. 운영 DB 접근·수정 없음.
- 콜카장36페이지 신규 AI/다른 국가 원본 기본값 복원 미검증. 상세/배포: docs/work-sessions/2026-10-26_cost-template-content.md.
- 검색어: cost-template-content 기본셀 기본값 사라짐 CO_GROUP_42_1 원본 양식 계산 25529

## 2026-10-26 주광 첫진입 차수 빈값
- Native웹앱첫화면빈값(예시43)→▼1재현.기존직접입력후검증에서누락.기본전산차수44를달력GET1회로실제입력,빈값버튼차단,수동값우선.분배표는조회버튼후만로드.
- 검색어: weekday entry defaultNext placeholder 빈칸44 43 Nenova Desktop
- 검증추가:entry/default9건,전체ERP계약,dnSpy근거,manifest,쓰기guard,UIlayout,production build통과.배포후Native웹앱첫진입재검증예정.

## 2026-10-26 주광 첫 차수 배포 복구
- PR1302 병합 후 Cafe24 40289366107의 두 시도에서 webpack이 Killed로 끝나 이전 버전이 유지됨. 커널 OOM 로그는 접근하지 못했으므로 메모리 부족 확정은 아님.
- 빌드 명령에만 NODE_OPTIONS 1536MiB 힙 제한을 적용. 기존 서비스/ERP DB/원자적 교체/실패 시 보존은 유지. 서버 자원 현황 free -m 기록 추가.
- 제한 빌드와 배포 검증 진행 중. 검색어: 1302 40289366107 Killed build heap 1536 첫 차수
검증: 1536MiB 제한 production build, 배포 검사15건, 전체ERP계약, dnSpy, manifest, write guard 통과.

## 2026-10-26 GitHub 빌드 / Cafe24 산출물 배포
- 사용자 승인으로 컴파일을 GitHub Linux Node20로 이동. DB_SERVER 비움, 빌드 후 무DB 로그인 기동 확인. Cafe24에는 .next-build와 생성 이력 두 파일만 전달.
- tar SHA256, 커밋/lock/BUILD_ID 검증과 최신 master 일치 확인 뒤 기존 DB gate/pm2 교체. 직원 학습값·업로드·.env 미포함. 원장/SQL/EXE 변경 없음.
- 로컬 webpack/로그인 기동/산출물 양성·불일치6개 fixture 통과. 전체 계약 및 Linux PR build/운영 배포 결과는 세션 MD 후속 기록.
- 검색어: ci-build-deploy ci-build-manifest GitHub 빌드 OOM Cafe24 체크섬

## 2026-10-27 수입부 입고·도착원가 작업 분리
- 파일·매칭/입고/원가 화면 분리, 입력 유지, 상세 단계·이력 접기. 입고 버튼은 원가 자동 승인하지 않음.
- 원가 전용 workflow는 기존 입고 대조·웹 연결·재조회만 사용하고 실패 시 신규 입고로 전환하지 않음. 전산-only NL/CN/TH 범위 유지, 이미 웹 등록 문서는 모든 지원 국가 재조회.
- 운영 DB/SQL/EXE 변경 없음. 55회귀 통과, 원가69통과9선택skip, 전체계약·manifest·write guard·dnSpy·webpack 통과. Chrome 격리 fixture에서 기존입고 연결1회/입고commit0/원가승인0 및 환율 입력 유지 확인.
- 최종 UI build·PR·배포 진행 중. 운영 직접 SQL/실제 원가 다운로드는 이번 세션 미검증. 세션: docs/work-sessions/2026-10-27_import-workspace.md.
- 검색어: import-workspace cost-only 입고원가분리 기존입고 건너뛰기

## 2026-10-27 추가: 연도·세부차수 기본값 / 입고내역 원가 진입
- 현재 연도(2026) 및 공용 getCurrentWeek 기본값. 연도 직접 수정·좌우 이동, 공용 stepWeek 세부차수 이동. 조회 버튼과 입고내역 원가 버튼 분리.
- 신규 GET warehouse-list는 OrderYear+OrderWeek 필수 SELECT-only. 기존 승인 원가 다운로드 경로 재사용. 생성은 연결된 문서 연도/차수/입고번호 검증 후 열기. 연결 없는 과거 전산 입고는 원본 연결 안내, 임의 입고/원가 생성 금지.
- 기본 작업 분리 PR1306 병합851077eb, 배포40426114758 진행 중. 추가 작업 회귀26통과, 전체계약·build 진행 중. 운영 DB 수정 없음.
- 검색어: invoiceWarehouseBrowse warehouse-list 저장연도 기본차수 입고내역 원가다운로드

## 2026-10-27 기존 전산 입고로 원가 계산·다운로드
- 인보이스 재연결 없이 WarehouseMaster/Detail/Product SELECT-only → 검증된 국가 공식 계산 → 미승인 XLSX 다운로드 경로 추가. 원장/재고/웹 승인 원가 쓰기 없음.
- 연도·차수·입고번호 및 조회 지문을 재검증, 다운로드 생성 후 재조회. 기존 승인 원가 export의 승인/commit 검증은 보존.
- 통화·운송 미저장 값은 확인 입력, GW/CW 단일 명확 중량행 보완(충돌은 미기재), 관세/기타비 일괄입력. 연도·차수 및 조회 버튼 압축 배치, 잘못된 ‘미입력’ 빈 화면 제거.
- dnSpy 실제 실행 및 2026/43-01 입고7771 SELECT 대조:64품목+3비상품행. TEST_ONLY 원가 XLSX 생성, 전후 지문 동일. 10공식 계산/출력 회귀 통과. Chrome 격리 UI에서 비용 누락 안내→입력→다운로드1회, 쓰기 요청0 확인.
- 최종 webpack 빌드/전체계약/manifest/쓰기guard/dnSpy 통과. Chrome 최종 UI 다운로드 금액144,000 및 품목2,600/4,600원 XLSX 일치, 저장요청0. PR1309 CI·배포 진행 중, 운영 화면 최종 검증 미검증. 상세 docs/work-sessions/2026-10-27_native-cost.md.
- 검색어: nativeReceiptCost nativeCostHttp 기존입고 인보이스없이 원가계산 미승인계산본

## 2026-10-27 입고관리 조회 기본기간·태국 EXCEL 중량
- 조회 기본값만7일→KST 달력3개월~오늘. URL/수동값 및 uploadMeta 기존 입력일 기본값 보존. DB·입고·원가 계산 변경 없음.
- SELECT:39-01 EXCEL7474 상세42868/42869 SteamQuantity209/270.5는 남아 있지만 ProdKey=NULL.40-01 EXCEL7581은Gross weight225/Chargeable weight345.5 정상 연결.39차운임270.5×1.65=446.325, 원문라벨 확정은 아님.
- 실제dnSpy/웹 기본 INNER JOIN Product가39차NULL두행을 제외한다. 운영 Chrome65635f23에서39차 EXCEL1/1112건·GW/CW–·운송료2행 확인. UploadDtm07/27~10/27 SQL1112건, 두전표 포함.
- 전체 verify:erp-change/webpack·dnSpy·manifest·쓰기guard·UI layout57 통과. PR·배포 및 변경 후 운영스모크 진행 중/미검증. 결과는 docs/work-sessions/2026-10-27_incoming-date-default.md에 후속 기록.
- 검색어: incoming-date-default KST 달력3개월 UploadDtm 7474 7581 EXCEL 209 270.5 ProdKey NULL 1112

## 2026-10-27 호주 Woolly 분류 수입부 권한
- canManageInvoiceReceipt가 DeptName 공란의 Authority4(수입부)를 거절. 기존 역할4/7 허용, 비활성/타부서 거절 유지. 계정/운영 원장 수정 없음.
- 44-01 호주41002 제품11행 replay: 일반9행 공용매칭 재사용, Woolly2행 문서별 분류·65박스/AUD20443.75 보존. 유사명 전체 자동확정이나 색상 자동추정은 하지 않음.
- 관련22테스트 통과, 전체검증/PR/배포 결과 세션 MD 후속 기록. 운영 직원 실제 저장 미검증.
- 검색어: au44-import-access Woolly bush Authority4 Authority7 DeptName 수입부 관리자오류 41002

## 2026-10-27 호주 품목검색·분류적용·CNF 안내
- 영문 ProdName 대신 한글 DisplayName만 datalist에 노출되어 Woolly검색 실패. 한/영/코드 후보검색·명시선택, 분류적용시 임시검색어 제거·성공안내·고정오류표시.
- AU CNF 새입력 추가운임0 준비, 기존 양수보존/중복가산차단. CW미기재 진행 가능 안내(중량값 자체 보존).
-101관련테스트,44-01 11행65박스 fixture 원가/XLSX 생성,CW null통과. Chrome 격리화면 Green/Red 선택→이슈0 확인. 운영 실제 저장 미검증, Product SELECT외 쓰기없음.
- 검색어: au44-flow Wolly Woolly DisplayName productSearch CNF CW 2997 2998
## 2026-10-27 태국39차 사진 승인 중량 (DB 불변)
- 사용자 확인2026/39-01 AWB21710637233 EXCEL7474에 GW164kg/CW225.5kg 사진 근거를 보고서 읽기 계산에만 연결. SQL 운임772.315USD 및 원장·수기·확정 revision 쓰기 없음.
- 다른 연도/차수/AWB/전표/농장/원문 지문은 거절. 신규 실제 중량·수기0 우선, 부분 실제값과 사진이 역전쌍을 만들면 사진 필드만 보류. 기존 NULL0 보조행 분류·상품분모는 그대로.
- 수정 전후38~41차 baseline4034/after4037SELECT, 독립1070검사 실패0, 원장·수기·확정본 관측지문 동일.39H미확정→412050(승인 추정),39F/40E105268.700315→95032.543002. 다른 국가/차수auto값 불변.
- 최종after4038SELECT/1070검사실패0 재확인. 전체verify:erp-change/webpack·dnSpy·manifest163·쓰기guard·guardian표적회귀 통과. PR/CI·배포는 진행 중/미검증. 상세 docs/work-sessions/2026-10-27_thai39-weight-evidence.md.
- 검색어: thai39-weight-evidence EXCEL7474 AWB21710637233 GW164 CW225.5 772.315 412050 photo 39F40E

## 2026-10-27 호주 기존 입고 원가 다운로드 진입·출하단가
- AU 기존연결 미지원으로 원가패널 숨김. 동일연도/차수/송장 native 조회·계산본 다운로드 진입 추가. 운영 DB 쓰기 없음.
- 사용자가 RedTip5100 확인. 출하단가=TPrice총액, EXE도 UPrice/TPrice 별도. AU native 계산용단가=저장총액/실제단수(5100/120=42.5), 저장8.5 및 원장 불변. 실제수량비율 사용.
-72회귀,실제7863SELECT·TEST_ONLY XLSX·원장지문동일 확인. 배포진행 전, 최종결과 세션MD 기록.
- 검색어: au-cost-download TPrice5100 RedTip42.5 nativePriceBasis 기존입고 다운로드

## 2026-10-27 인보이스 기준 독립 원가 계산·다운로드
- 기존입고 미지원 국가를 강제연결하지 않고 업로드 원문으로 미승인 계산본 생성. Product SELECT-only, 입고/재고/초안/승인원가 쓰기 없음. 기존입고 TPrice5100 기준 경로 보존.
- 원가탭 업로드인보이스/기존자료 선택, 인보이스업로드→매칭→도착원가 준비. 미매칭/원문 불일치 행별 차단, 날짜/운송 직접 수정, 지문 재검증. 입력은 작업탭 전환에도 유지.
- 국가별 공식·양식회귀 및 격리Chrome 계산→XLSX 다운로드 확인. 운영실제7863 readonly지문 동일. 운영 업로드/승인실행은 미검증(금지). PR/배포 진행 전, 최종결과 세션MD.
- 검색어: invoice-cost-independent INVOICE_PREVIEW PREVIEW_ONLY 원가단독 인보이스 미승인 다운로드

## 2026-10-27 거래처관리대장1(채권) 구성 착수
- 사용자 범위 E040723 전표별/담당거래처/최근1개월/KST평일09~18 정시. 운영 메뉴 자료미수집 확인. ar 요약과 별개.
- 원본 전표37행 판매/수금/이월/잔액 대조일치. OrderCode는 이카운트코드와 다름을 확인해 유일한 사업자 식별값으로만 연결. 담당125/수집후보120/연결확인5. 전용API/UI/정시수집 연결, 일반snapshot API에서 ledger723 차단. 개인정보 대신 날짜·금액·내부키만 웹snapshot에 저장.
- 정책/권한/API/검증16테스트 통과. 전체ERP/build 통과(기존공유 node_modules 누락은 독립 npm ci로 해소). PR/배포/실제예약수집은 아직 미검증. ECOUNT와 공유ERP원장 쓰기없음.
- 세션: docs/work-sessions/2026-10-27_ecount-ar-hourly.md
- 검색어: E040723 거래처관리대장1 전표별 담당거래처 최근1개월 평일09-18
## 2026-10-27 주차별·월별 보고서 수요일 계산본 저장
- 요청: 수요일에 이번주 직전1차수를 저장하고 과거조회 재계산 제거. 실제 PeriodDay로10/28current44→43저장, KST06시·지연슬롯고정·DB잠금/멱등/원천변경검사. 기존 WebProfitReportSnapshot INSERT만, ERP·수기·확정원장보존.
- v1 row.calc/totals 저장값을 웹·엑셀·월별이공유,legacy/miss409,확정CALC우선. 과거패널자동원천조회제거·명시수정후캐시갱신/실패분리·UI경합보호.
- 사용자 선택 "저장된 차수 우선, 최신 차수는 별도 조회": 월별기본현재미만hasData만,진행/미래는체크명시. 캐시미준비합계를0으로숨기지않음. 일반GET쓰기0.
- 실제SELECT-only검증:41차26.4초/1174SELECT→저장형식17행/합계exact일치. 기본월별472ms/6SELECT/live0(아직missing42). 원장guard로쓰기0;동시운영3테이블변화는전체불변이라고과장하지않음.
- 전체verify:erp-change/webpack·신규3회귀·manifest166·dnSpy·쓰기guard통과. PR/CI/배포/최초2026 1~42준비/운영스모크는이기록시점미검증. 결과는 docs/plans/profit-weekly-cache-2026-10-27.md에 이어 기록한다.
- 검색어: profit-weekly-cache 수요일06시 PeriodDay43 44 cachePolicyVersion 저장된계산본 월별최신차수포함 BACKFILL

## 2026-10-27 계산본 최초 준비 가드 보완
- PR1316 master a6a7619, CI40458268697 및 Cafe24배포40458808503 성공. 배포 ping/hydration 통과.
- 최초 준비는 조건부 테이블 존재 확인 SELECT를 가드가 차단하여 1차에서 중단(INSERT시도0). 좁은 IF OBJECT_ID SELECT 허용 및 실제 함수회귀 추가, DML/DDL/SP 차단과 실패 latch 유지. 운영원장수정 없음; 최초저장 완료 여부는 후속 검증 기록 참조.
- 검색어: profit-cache-backfill-guard sourceWorkbookFx IF_OBJECT_ID CACHE_ONLY_SQL_BLOCKED PR1316

## 2026-10-27 원가표 Woolly 품목 변경
- 원가표가 ProdKey만 보여주고 분류버튼은 입고탭에만 있었음. 원가탭/행 버튼에서 기존 합계검증 분류모달 연결, 영문/한글 매칭명 표시. 운영원장·공용매칭·원가식 쓰기없음.
- 품목 변경→새 prepare지문/미리보기 필요, 환율·통관비 보존, 변경된 행 관세/배분입력 재확인. 다른 문서/연도 입력승계 금지.
- dnSpy 재실행 및 Product2997/2998 활성AU SELECT확인. Chrome 격리 전체Workbench에서 Red→Green 선택/적용→관세0 시험값→원가2560000→TEST_ONLY XLSX 다운로드 확인. 실제원가 승인 아님. 75표적검사66통과9선택원본생략. 전체검증/배포 진행중.
- 검색어: woolly-cost-edit onEditAllocation invoiceCostEditing GreenTip RedTip 원가표 품목변경

## 2026-10-27 호텔+미우 주문전용
- 기본 호텔 주문등록 탭: 요청/발주 TXT·Excel·이미지·텍스트 매칭, Product.OutUnit 합산, 발주→라움/완성박스잔량→호텔여분/잔여→선택업체. 기존 합산·이력 보조탭 유지.
- 기존 my-customer ADD/expectedCurrentQty writer 사용, 원장 직접SQL 추가0. 로그인별 브라우저 초안·등록전 pending저장·실패재등록차단·서버 previous/final 결과·이력보관. 공용/호텔 저장 매칭1035행146품목, 충돌 수동선택.
- 실제 dnSpy·SELECT-only downstream 확인, 신규6회귀 및 전체ERP/dnSpy/manifest/writeguard/화면틀 통과. 격리Chrome 정상/응답유실 시험 통과. 빌드·PR·배포는 이기록시점 진행중이며 실제업무주문/외부OCR사진 전송은 미검증.
- 검색어: hotel-order-only 요청수량 발주수량 호텔여분 분류필요 expectedCurrentQty 호텔주문전용
## 2026-10-27 호주 관세율 기본값·실제44-01 검증
- 기존 호주39-1 원가파일 SHA7cb66c 품목별율: CopperGlow6.9%,9품목0%. RedTip은 사용자 별도0%승인. 활성ProdKey+정확이름/2026이후39차/AU AIR만 자동입력, 근거표시·수기보존·품목변경시기본율재준비.
- 실제44-01 PDF SHA994541과 저장분석본11행 일치SELECT. Chrome 격리Workbench에서 Red/Green검색선택·합계적용·관세변경·환율보존·미리보기·다운로드 완료. 파일11행2385단20443.75AUD, 전체수식차이1전미만/렌더확인. TEST_ONLY1090원/AUD·통관10000원, 원가22370401.7. 운영쓰기0.
- 표적76검사67통과9선택원본생략. 전체회귀/webpack/CI/배포 진행중. 자세한근거 docs/work-sessions/2026-10-27_au-tariff-defaults.md.
- 검색어: au-tariff-defaults CopperGlow6.9 GreenTip0 RedTip0 39-1I18 44-01TEST_ONLY

## 2026-10-27 계산본 1~42차 준비·운영 다운로드 검증
- BACKFILL 1~41 새 버전41개, 42차는 운영 예약저장본을 그대로 사용. SQL22429조회/INSERT시도41/차단0. ERP·수기·확정원장 쓰기 금지 유지.
- 저장본 조회 18/26/31/41/42 모두 stored, 각100~331ms/4~5SELECT. 월별42차 missing0,753ms/5SELECT/live0. 월별156개 금액·이익률 대조통과(부동소수점 최대차2.78e-17, 음수0은 JSON상0).
- 예약42차는WEEKLY/weekly-scheduler:2026-10-21/version1. 보호20테이블중17관측동일,OrderMaster/OrderDetail/ShipmentMaster는동시업무로변화. 수기/확정/환율/통관비웹테이블은동일. 본작업 원장쓰기0.
- 운영 다운로드 run40460713452 성공:18차985ms/36315bytes,41차943ms/36444bytes,각HTTP200/1시트/화면금액차이0/업무쓰기0. 원가미확정 null은0으로대체하지않는다.
- PR1319 후속보완은 동시 master WORK_MEMORY 추가내용을 모두 보존하여 병합 후 CI 재실행. 최종배포는 후속 기록 참조.
- 검색어: profit-weekly-cache 1-42 materialized monthly753 18xlsx 41xlsx 40460713452

## 2026-10-27 거래처관리대장 운영 검증 보완
- PR1317/28c8e8e3 Cafe24 배포 성공, 운영 worklist120·관리자 무배정 빈목록·웹snapshot 첫8전표 적재 확인. PC 런처 백업(.bak-1027) 후 독립 .orbit/ecount-runtime으로 교체, 원래 로그인 프로필 유지 및 자동 로그인 성공.
- 실제 빌드의 40행 가상자료 브라우저 검증에서 공통 .table-scroll max-height 충돌 발견: 고유 클래스명으로 수정. 원본 검색 실패 팝업이 다음 고객에 영향을 주지 않도록 매 고객 새 문서 및 실패 복구를 추가하고 실패단계만 기록(원문/개인정보 로그 없음).
- 정책/API/산술/실패격리18테스트와 webpack build 통과. 보완 PR/배포 및 전체 첫 배치는 진행 중. 첫 운영 배치 전체 성공으로 판정하지 않음.
- 검색어: E040723 ledger723 팝업격리 ledger-table-scroll 수집복구

## 2026-10-27 채권 무전표 이월잔액 및 연결 확인 상태 보완
- PR1320 병합(64d4d6db), Cafe24 배포 진행. 실제 수집에서 이월잔액 한 행만 있고 합계가 없는 원본 형식 확인, 기존 대기 조건을 보완. 날짜 단축키 첫 조회도 표가 완성된 뒤 다음 조건 설정.
- 번호 불일치/검색 불명확을 이름으로 추정 연결하지 않음. 안전한 원인코드·시각만 RED snapshot에 추가하고 마지막 검증 자료를 유지하도록 API/화면 구성. 원장·거래처 정보 수정 없음.
- 해당 변경은 테스트/CI/배포 및 다음 실제 배치 검증 진행 중이며 전체 고객 성공으로 판정하지 않음.
- 검색어: E040723 이월잔액 단독행 balanceOnly LINK_CHECK_REQUIRED RED GREEN 갱신실패

## 2026-10-27 채권 최종 배포 및 날짜 입력 확정 보완
- PR1317·1320·1323 병합. 최종 웹 04b3c958 Cafe24 배포40464469344 성공, 운영 DOM 버전 확인. 22개 채권 테스트·전체 ERP 계약·webpack build·필수 guard 통과. 가상자료 실제 빌드 화면에서 이월잔액/연결 실패/이전 정상자료 유지 확인, 운영 담당 외 접근 및 수집 API 쿠키 접근 차단 확인.
- 수집기 독립 .orbit/ecount-runtime 경로에 04b3c958 적용, 기존 로그인 프로필/예약작업 유지. 초기 전체 배치 검증 중 날짜 편집 확정과 검색 클릭을 분리해 보완. 원본 1개월 결과·식별 일치 재검증, 원장 수정 없음.
- 기존 임시 작업트리 경로가 외부에서 정리된 상태여서 origin/master의 새 작업트리 C:/Users/USER/nw-ecount-ledger-final로 이어서 검증(잠금 설정). 커밋·운영 수집기는 독립 경로라 보존됨. 전체 배치 최종 건수는 아직 미검증.
- 검색어: E040723 날짜 blur Tab 입력확정 04b3c958 거래처채권 최종검증

## 2026-10-27 채권관리 운영 배포와 원본 조회 완료 검증
- PR #1317/#1320/#1323 운영 반영(04b3c958). 본인 담당 거래처, 최근1개월 전표별, 이월잔액 단독·안전한 실패 상태·마지막 검증본 유지. 원장 변경 없음.
- 계약22테스트 및 기존 전체 ERP/webpack CI 통과. 실제 운영 권한403/우회404/토큰전용401, 빈 담당목록 및 테스트 자료 데스크톱40행/모바일390px 검증.
- 원본 날짜 fill/Tab 확정, 전월+금월 요청 완료와 실제 기간 확인, 페이지 검색 버튼 클릭으로 조회. 모호한 거래처 팝업은 즉시 차단. PR #1324 전체 회차 최종 검증 진행 중.
- 런타임 .orbit/ecount-runtime 및 기존 로그온 런처 사용. 임시 작업트리 외부 정리에 영향받지 않음. 실행 이력 최종 수치는 세션 문서 후속 기록 참고.
검색어: E040723 ledger723 최근1개월 전표별 이월잔액 networkidle 담당자 자동갱신
## 2026-10-27 호주 도착원가 원본 내용 복원
- 스타일만 보존하고 내용이 비던 AU 엑셀에 38-1 해시검증 고정값/통관/판매/이익 수식을 기본활성 원본시트로 복원. 승인 계산본은 변경하지 않음.
- GW*460+33000+품목수*10000+90000 기본값은 수정 가능한 과거 추정근거. GW 누락은 입력필요, 명시0/직접 통관총액 보존. 현재 판매가 O열과 과거 참고판매가 구분.
- 로컬 Chrome44-01 11행 Woolly 검색/적용, 통관비 계산, 다운로드 완료. 65박스/2385단/AUD20443.75, 시험FX1090/GW265.5 원가22715531.7. 독립 재계산/판매가 입력 후 총손익 검증. 운영 DB 쓰기0.
- 대상79테스트 중70통과/9선택적 원본fixture skip, 전체 계약·최종빌드·배포 후속 기록 예정. 세션: docs/work-sessions/2026-10-27_au-template-restoration.md.
- 검색어: AU template restoration 원본고정값 매주확인 판매 총이익률 44-01

## 2026-10-27 호텔 주문 초안·결과 서버 보관
- 사용자 요청: 다른 PC에서도 연도·차수별 초안/결과를 불러와 이어서 작업.
- data/runtime/hotel-orders의 사용자별/연도/차수/작업UUID 서버 저장. immutable revision + fsync + atomic exclusive link로 동시 덮어쓰기409. MSSQL 스키마/ERP writer 변경 없음.
- 입력 텍스트/매칭/업체배정/결과 자동저장, 명시 저장/목록/복구, 기존 localStorage 초안 deterministic ID 가져오기. pending 서버저장 완료 후 기존 주문 POST, frozen/완료결과 보존.
- 신규 실행형5검사 및 전체 ERP 계약/dnSpy/manifest167/변경API1 writeguard/UI layout 통과. Chrome 두 창90→120 공유·오래된150 차단·격리 등록5→125 결과 새로고침 복구·응답유실 조회복구 Enter 확인. 실주문 쓰기0.
- 최종빌드/PR/운영배포는 후속기록 참조. 검색어: hotel-server-drafts 서버초안 차수별 CAS immutable revision 응답유실

## 2026-10-27 업체비중·이월 포함 판매마진 / 38→39차 감사
- 기존 주차별 보고서의 수익률·확정본·계산 저장본은 유지하고 독립 새창을 추가. 국가/품종/단위→업체 비중→품목 근거, 청구/실물 수량·VAT·미확정 원가를 구분한다.
- 품목별 실제 0재고 앵커 이후 수량 연속성과 전체 매입행 원가를 대사한 주기 가중평균만 사용. 판매단가·최근 다른품목 평균·부분원가 대체 없음. 새 SQL은 SELECT-only. 기존 원가3모듈은 추가 coverage metadata와 named export만 변경.
- 실38→39 API 5.9초/875SELECT/쓰기0,49그룹,기존 N/L/O대조 차이0. 39차176품목 원가확인/119미확정, 매출기준23.8%(승인추정포함);38차23.2%. 모두 확정된 판매마진이라고 보고하지 않는다.
- 기존총수익률−0.889945%→34.813893%. 38음수/39양수 재고조정과매입·판매규모 변화가 중요. 원시수량차이8품목은39차native ROUND2로맞으나 다른 원가부족은 남음. 과거모든기간ROUND2재현은미검증.
- 본표독립검산1292건,신규42회귀통과. ERP전체/webpack1차통과,최신master통합 후 최종검증·CI·배포·운영브라우저는 진행중(완료미판정). 문서: docs/work-sessions/2026-10-27_profit-customer-margin-38-39.md.
- 검색어: profit-customer-margin 업체비중 평균도착원가 38-39 23.8% 재고조정 Shapley ROUND2

## 2026-10-27 도착원가 다운로드 사유·버튼 통일
- 기존 다운로드 gate를 바꾸지 않고 서버 오류/누락값/확인/미리보기 필요를 버튼 안과 인접 상태에 표시. 입력변경 시 기존 오류 지움.
- 원가 품목변경·입력수정·보기필터·업로드 진입 버튼을 파란색/흰색 테두리·포커스·줄바꿈 디자인으로 정리.
- 격리 Chrome44-01 GW 누락→시험265.5→미리보기→실제 다운로드→GW삭제 재차단 확인. 운영DB 쓰기0. 로컬빌드 통과, CI/배포 후속 기록.
- 검색어: cost-download-feedback 다운로드 비활성 버튼 GW 44-01

## 2026-10-27 호텔 주문전용 버튼 디자인 통일
- 요청: 버튼 모양을 통일하고 색감으로 구분. 호텔 페이지 전용 CSS Module에서 공통ERP radius/font를 사용하고 높이32px·13px·padding6/12로 통일. 탭/파일선택/기존탭 버튼도 동일 형태.
- 저장청록·조회보라·매칭파랑·주문초록·삭제연빨강·재시도황토, 비활성 회색과 focus ring. 이벤트/disabled/서버저장/ERP SQL 변경0.
- Chrome 격리실화면 요청30/분류표·버튼높이32px·색상·Tab초점 확인. build/dnSpy/manifest167/writeguard0/UI57 통과, 전체회귀/PR/배포 진행중.
- 검색어: hotel-buttons 버튼통일 data-tone 32px 청록 보라 초록

## 2026-10-27 업체 판매마진 원가 미확정·운영 대사 경고 보완
- 사용자 요청: DB를 변경하지 않고 미확정119품목과 저장본·SQL 경고를 진단/보완/검증/배포. 별도 nw-profit-margin-evidence, base cb485cbc.
- 정확한 WdetailKey 대신 동일 ProdKey 첫 입고로 연결하던 부분을 새 분석 strict 옵션에서 보완. 기존 주차별 보고서 기본 호출/원가/수익률은 보존한다.
- 실제 0재고 앵커 이후 입고 조회한도와 native ROUND2를 검증. 원가원천 raw 입고/출고/조정과 native 원시합계가 다르면 잔량이 맞아도 원가 승격 금지.
- 경량 대사 GET와 SQL/저장본 차액·분류 적용·시점·합계 제외범위 표시. 운영 원인은 운영 응답 확인 전 미검증, 로컬 일치를 운영 전체 일치로 보고하지 않음.
- 39차119→98/38차86→45, 기존본표/판매값19,629비교·기존도착원가371품목 불변. SELECT1238/쓰기0/8.255초,52회귀·전체verify/build·manifest168/writeguard1·production로컬UI 통과. CI·배포·운영 브라우저 아직 미검증. 기록: docs/work-sessions/2026-10-27_profit-margin-evidence.md.
- 검색어: profit-margin-evidence 원가미확정119 WdetailKey strictReceiptLines nativeROUND2 원천범위 reconciliation 저장본SQL

## 2026-10-27 ECOUNT 담당 거래처 채권 최신화 요청 및 메뉴 노출
- Finance 상단 `ECOUNT 채권` 바로 옆에 `거래처관리대장1(채권)` 링크를 추가해 전표별 최근 1개월 화면 진입점을 노출.
- 기존 정시수집을 KST 평일 08:00·11:00·14:00으로 변경(09시·정오·15시 전). 놓친 회차는 따라잡지 않음.
- 선택한 담당·식별값 연결 거래처만 평일 08:00~18:00 수동 최신화 요청 가능. 요청은 WebEcountSnapshot ledger723 대기 이벤트에 append-only 저장하고 원본 PC 수집기가 예약 배치 종료 뒤 순차 처리; 요청 중복 억제, 실행상태 15초 폴링, 10분 cooldown, 2시간 이상 정지한 건 재시도 가능.
- ECOUNT 조회 전용 유지. source code/요청자 정보는 대기 이벤트에 저장하지 않고, ECOUNT 및 공유 ERP 원장/테이블은 수정하지 않음.
- 정책/API/큐 회귀 25건 통과. `npm run test:erp-contract`, `npm run test:nenova-dnspy-evidence`, `npm run test:erp-manifest -- --changed-from HEAD^`, `npm run guard:erp-writes -- --changed-from HEAD^`, `npm run build` 통과. 원본 PC 예약 작업과 배포 후 실브라우저는 PR/배포 후 확인 예정.
- 검색어: ecount-ledger refresh-request 거래처관리대장1 E040723 08:00 11:00 14:00
## 2026-10-27 호주 44-01 CI·AWB 결합/도착원가
- 44-01 CI와 AWB 동시 업로드 흐름 구현. AWB 번호·65박스·GW/CW 805kg은 원문 근거/지문/사용자 확인 없이는 입고 검증 통과 불가. CI가 C+F라 AU AWB 운임을 원가에 중복 가산하지 않음.
- AUD/KRW는 업로드일의 Yahoo Finance 시장 일봉, 비거래일에는 직전 quote를 사용하고 고시일·출처를 보존. 인보이스 작성일은 KST 2026-10-26, 업로드 기준일은 2026-10-27.
- AU AWB 자동화 5/5, import-team 120 pass·18 선택 원본 생략, exporter 35 pass·9 선택 원본 생략, ERP 계약 전체 통과. `npm run build`, write-guard, dnSpy golden, ERP manifest, 격리 SQL writer 테스트도 통과. 운영 DB 쓰기 0.
- 실제 PDF는 로컬 격리 브라우저에서 업로드 UI까지 확인했으나 OCR/AI 호출과 실제 입고 writer는 mock. 이어지는 전체 UI에서 원가 다운로드를 클릭해 끝내는 E2E는 미검증이므로 실입고·배포 완료로 주장하지 않는다. PR·CI·Cafe24 배포 상태는 별도 작업 세션 기록을 따른다.
- 검색어: AU AWB 44-01 805kg 65박스 AUDKRW C+F 업로드환율 도착원가 다운로드

## 2026-10-28 SS3 관리자 전체 거래처 채권 조회
- 채권대장 GET에서 관리자 계정 `nenovaSS3`는 전체 활성 거래처 목록과 유일한 ECOUNT 식별값이 연결된 검증 대장을 읽도록 범위를 추가. 담당자 계정은 기존 배정 범위를 유지.
- 무담당/중복담당 거래처도 관리자 목록에 표시하되, 식별값 누락·중복 거래처는 비활성 선택. 관리자는 타 담당 거래처 최신화 버튼을 사용할 수 없도록 구분.
- 계약에 관리자 조회 범위와 제한을 반영. targeted ECOUNT 28/28, ERP contract, dnSpy evidence, ERP manifest 168, write guard, build 통과. PR/CI/배포 후 브라우저는 미검증.
- 검색어: ecount-customer-ledger nenovaSS3 전체 거래처 관리자 refreshable

## 2026-10-28 호텔 차수·카톡 입력
- 기본차수 ±5 및 세부01~04 버튼, 초기 기본차수 선택. 빈 작업 자동저장 잠금 방지.
- 자동저장 중/실패에도 텍스트 입력 유지. Chrome 8초 지연 중 요청·발주 추가 paste→revision2 전체원문 보존,503후 편집 유지 확인. ERP writer/API 변경0.
- 검증/배포 진행중. docs/work-sessions/2026-10-28_hotel-input.md 참조.
- 검색어: hotel-input 카톡 붙여넣기 autosave disabled ±5

## 2026-10-28 도착원가 작업대 client exception
- 운영 Console 증거: `ReferenceError: documentCountry is not defined` at `InvoiceReceiptWorkbench` AU AWB render condition. `documentCountry`는 비용검토 파일 내부 비공개 함수였고 작업대에서 미정의 식별자로 호출되어 선택 문서 렌더링을 중단.
- 작업대에 local `isAustraliaReceiptDocument` predicate 추가(AU/AUSTRALIA/호주) 및 regression test. `invoiceReceiptWorkbench`, `invoiceReceiptSourceResume`, `auAwbFlow` 28/28 통과; 전체 `verify:erp-change`가 계약/manifest/writeguard/build까지 진행되어 빌드 성공.
- 동일 콘솔의 receipt GET 404는 `readExistingReceiptSource`가 `INVOICE_DOCUMENT_NOT_FOUND`에 대해 신규 초안으로 이어가도록 설계된 사전 조회 miss이며 테스트로 확인. 입고·원가 저장 API/DB 쓰기 0.
- 적용 기준: 기존 작업대 UI의 국가 렌더 조건만 수정, 메뉴 기준선·페이지 스크롤/키보드 동작은 해당 없음. PR/배포 상태는 후속 기록.
- 검색어: documentCountry is not defined ReferenceError AU AWB workbench expected receipt GET 404

## 2026-10-28 ECOUNT 채권 요약 및 평균 매출
- `/ecount/receivables` 표를 거래처명·매출합계·수금합계·기타할인등차액·잔액·미회수월 + 월평균·차수평균으로 확장하고 메뉴명을 `ECOUNT 채권 요약`으로 명확화.
- 일반 담당자는 유일하게 이름·담당자가 확인된 거래처만 조회, `nenovaSS3`는 ECOUNT 행 전체 조회. ECOUNT 행을 ERP 거래처에 유일 연결할 수 없는 경우 평균은 추정하지 않음.
- 평균 매출은 KST 최근 12개월 `ShipmentDetail.isFix=1` 확정 출고의 `Amount+Vat` 기준. 월평균 분모 12, 차수평균은 매출 발생 `OrderYear+MajorWeek` 단위(세부차수 합산).
- ECOUNT 스냅샷·공유 ERP 원장 읽기 전용. policy/API mocked UI tests, ERP contract, dnSpy evidence, manifest 169, write guard, Next build 통과.
- 검색어: ecount-receivables etcDiff manager-scope rolling-12-month major-week average

## 2026-10-28 ECOUNT 채권 업체 검색 및 담당자 필터
- `/ecount/receivables`에 업체명/담당자 검색창, 담당자 선택 버튼(전체/개별), 검색 결과 수를 추가하고 업체명 옆에 담당자 표시 이름을 붙였다.
- 읽기 전용 Customer/UserInfo 조회에서 이름을 전달하며, 일반 사용자의 담당자 권한 필터와 nenovaSS3 관리자 전체 범위는 유지했다. 미매핑·모호한 행은 `담당자 미확인`으로 표시한다.
- policy/API 회귀 테스트와 ECOUNT 계약 설명 갱신. 정책/API 테스트, `test:erp-contract`, dnSpy evidence, manifest 169개, write guard, Next build 통과. 빌드가 재생성한 개발 이력 JSON은 작업 범위 밖이라 복원.
- ECOUNT 및 ERP 원장 쓰기 없음. 운영 화면 스모크는 미검증.
- 검색어: ecount receivables company search manager filter 담당자 버튼 업체명 검색
## 2026-10-28 호텔 원본 대조·번호별 수량 저장
- 원본 이미지/텍스트 옆 품목·수량 편집표, pending 서버 검토 → 명시 요청수량1·2/발주수량1·2 저장, 합산 반영. 기존 행은1로 보존.
- 이미지 원본은 인증 사용자별 immutable runtime 파일(15MB), pending/batches는 기존 차수별 CAS 초안. ERP/SQL 쓰기 변경 없음, frozen 보호 확장.
- Chrome 합성 이미지303→305 수정/503실패 보존/요청수량2=103/합산408/재불러오기 원본 복원 확인, 주문 호출0. build·단위/API 검증 통과; CI/배포 후 결과 추가. 실제 업무 OCR·주문등록은 미검증.
- 검색어: 호텔 원본 이미지 나란히 매칭 요청수량1 pending batches hotel-order-images

## 2026-10-28 호주 Woolly 분류 버튼·AWB 차단 안내
- 실제 운영 웹 화면(44-01 AU)에서 Woolly 행의 빨간 분류 버튼을 눌러 재현: 행 포커스만 바뀌고 분류 작업대로 진입하지 않음. 원인은 `PackingResults`가 ALLOCATION 상태도 일반 DB 매칭 콜백으로 보내고, 부모의 `prepareReceipt`가 AWB 확인을 먼저 요구해 분류 모달이 있는 입고 작업대를 마운트하지 않은 것.
- ALLOCATION 전용 콜백으로 분리해 해당 행 버튼/상단 분류 CTA가 입고량 분류 작업대를 먼저 열도록 수정. 이 분류 단계는 AWB 확인 전에도 열리지만 입고·도착원가 이동은 계속 AWB 검증·완료 확인을 요구함.
- AWB 차단 시 원인 문구를 CTA 옆에 표시하고 버튼 문구를 `AWB 대조 항목 확인`으로 변경, 클릭하면 AWB 검토 구역으로 스크롤·포커스. 안전 차단 조건은 완화하지 않음.
- 회귀 테스트 추가: Woolly 상태 버튼/원문 품목 버튼이 분류 콜백으로 가고 일반 DB 매칭 콜백으로 빠지지 않는지 확인. `test:import-team`, `test:erp-contract`, `test:erp-manifest -- --changed-from origin/master`, `guard:erp-writes -- --changed-from origin/master`, `test:ui-layout`, `build` 통과. 빌드 후 생성된 이력 스냅샷은 정리.
- 입고/원가 승인이나 ERP 원장 저장은 하지 않음. 운영 브라우저에서 수정 전 결함은 재현했으나 수정 후 브라우저 E2E·CI·배포는 미검증.
- 검색어: Woolly bush 파일별 품목 입고량 분류 onAllocate AWB 검증 focusReceipt disabled button 실제 웹 재현

## 2026-10-28 Woolly 분류 버튼 배포 확인
- PR #1344 CI 통과 후 squash merge `300f0294`; Cafe24 배포 run `40652729466` 성공. GitHub 빌드·SSH 배포·Hydration 실브라우저 스모크 모두 통과.
- 사용자의 Chrome CDP 탭 연결은 `Emulation.setFocusEmulationEnabled` 10초 타임아웃으로 재시도 후에도 연결 실패. 따라서 배포 후 운영 UI에서 Woolly 버튼을 직접 클릭한 E2E는 미검증. 수정 전 실제 운영 클릭 무반응은 재현했고, 변경 후 콜백 회귀테스트/로컬 빌드 통과.
- ERP 입고·재고·원가 저장 없음. AWB 근거 대조 가드는 보존.
- 검색어: PR1344 300f0294 Cafe24 40652729466 Woolly onAllocate Chrome CDP E2E 미검증

## 2026-10-28 자동수집 일괄등록
- 자동수집 영업지원 등록 허용. 혼합 등록과 주광·태림 43차 양성/출고 없음/0원 단가/중복 fixture 통과. PR #1339 검증 진행.
- 검색어: 자동수집 주광 태림 43차 AUTO_SOURCE_REVIEW_REQUIRED

## 2026-10-28 자동수집 일괄등록 전수 검증
- 43차 전체400행 중 자동146행/31업체 대조: 137행 preflight/preview 정상, 기존등록1/동일견적5/단가없음3 정상제외, 원천차단/화면서버불일치0. 44차 추가 확인 중.
- 계획 함수에 남은 과거 자동원천 차단 제거. 96개 업체/연도/확인/현재·과거원천 조합을 CI 독립 실행. 실제 ERP 원장 쓰기 없음.
- 검색어: 자동수집 전수 31업체 146행 137행 provenance parity 43차 44차
- 44차 자동151행/32업체도 전수 완료: 정상90행 preflight/preview 오류0, 기존등록1/출고없음58/단가없음2 정상차단. 양 차수 원천차단/표시검증불일치0. 기존등록469 실제9509/38-01 연결 확인. PR1340 CI 진행.

## 2026-10-28 원문 없는 과거 불량차감 재노출 정리
- 사용자 희경15단 오류 확정 및 레바논2단/주광화이트 포함 전체 해결 요청. 대상722/740/859/868/877. 과거40차9955/9913 실제 견적과 혼동하지 않는다.
- 전체 SELECT: 자동원천+과거ESTIMATE_UNLINK78행/24업체, 연결견적없음65행/17업체(중복집합있음). 전부 오등록으로 삭제하지 않고 공통 SQL/순수 판정으로 SOURCE_REVIEW 격리. 목록/preflight/preview/planning/final잠금/완료/선택에 적용.
- 기존 정상 자동/수동96조합 및 실사례5행의 변조preflight/preview/register 쓰기0 회귀 통과. 사용자확인5행은 배포 후 기존 버전검증 manage-archive로 실제견적/적용이력 보존하며 정리할 예정. 원문 범위는09/14까지이므로10월 미게시 여부를 역추정하지 않음.
- 검색어: 희경15 레바논2 주광화이트 rejectedAutoSource missingLinkedEstimate ESTIMATE_UNLINK 722 740 859 868 877

## 2026-10-28 92건 원문 대조·정상 후보 복원 진행
- 사용자 제공10/28 불량 공유방 원문5392항목(05/13~10/28)을 메모리에서 대조. 원문·발신자는 저장소에 복사하지 않고 SHA/ordinal/업무키만 감사계획에 기록.
- 운영43차 검토92건=과거해제자동73+유효연결부재19. 고정계획62 archive/4 release/26 hold. 실제보존견적·수량·단위/다른규격까지 재검증. 26건은 실제차감과 원문수량차이·원문부재·다른신고 구분 등 미확정 판단으로, 사용자가 기준 선택 중.
- 관리자 원문 근거/현재버전/실제견적부재/부분적용부재를 확인하는 review-source preview/apply 추가. 웹원장/감사만 변경하고 ERP/Estimate/Application 보존. 복원603/1010/1013/1015는 정상일괄등록의 EXE/단가/중복 검사를 다시 통과해야 함.
- 실제 MSSQL SELECT-only CTE9반례(정상/교차연도/업체/품목/수량/단위/원천/비고/이후unlink) 통과. 단순 등록버전 증가는 원문 재승인을 무효화하지 않음. 실제dnSpy ClassEstimate 저장대상 재확인.
- 검색어: 92건 원문 5392 source review release 603 1010 1013 1015 SHA ordinal 다른규격62 26hold

## 2026-10-28 42차 이후 우선 정정 (진행)
- 사용자 정정: 과거 수량차이 소급보다42차 이후가 중요함. 앞선92건62/4/26계획은 실행하지 않음. PR1342 CI→81536c32 배포성공 뒤 정상1010/1013/1015만 복원, 운영preflight3건 오류없음.
- 제공 원문 기준으로 1019브르트15는5단,대한1066/1067의15/15는원문25/6과 달라 잘못된추가후보. 같은표식/항목원문없음1048~1060의 업체·품목·수량 오매칭 추가확인.
- 현재43차 오등록Estimate12개(10803,10806,10807,10809,10810,10811,10812,10813,10814,10817,10818,10819)는 고정계획 후 기존감사선택삭제API/비강제ERP편집lease로정정예정. 정상10808/10815/10816은보존+원문검토확인.
- 잘못된현재후보17archive,원문정상5초안(4정상+유칼립투스6단환산미확정표시) 준비. 나머지과거행은 격리유지하며현재재등록하지않음.926안시리움사진원문과유칼립투스환산2사항은사용자질문중.
- 재발방지: 항목근거없는자동원천/여러업체공유표식은검토대기,정상확인된실제견적은보존검토확인.원문업체줄·동일품목줄의수량단위검증회귀추가.선택외ERP전후지문보존확인예정.
- 검색어:42차이후 10806브르트5vs15 대한25/6 17archive12withdraw 926 유칼립투스환산 SOURCE_EVIDENCE_INCOMPLETE SOURCE_UNIT_REVIEW
- 사용자 최종 답변:926안시리움과1052유칼립투스는직접입력같으니냅둬.두원장/실제10811견적보존,원문추정/환산/복원중지.최종범위16archive/11견적삭제/정상3견적확인/4초안.두수기행전후스냅샷확인.

## 2026-10-28 Woolly 분류 버튼 실제 UI 차단 재현 및 수정
- 로컬 `격리 테스트` 웹앱 화면에 실제 44-01 호주 CI/AWB PDF를 선택, mock 분석 응답으로 11행 결과를 렌더링. 실제 AI/OCR가 아닌 UI 흐름 검증이며 운영 DB 미접속.
- 9개 유사매칭 미확인 상태에서 10/11행 Woolly 분류 버튼을 누르자 앱이 `전산 품목을 확인할 행이 9건 남았습니다` 안내로 분류 화면 진입을 막는 것을 직접 재현. 원인은 분류 검토용 준비 요청이 일반 입고 진행과 같은 전체매칭 완료 검증을 공유한 것.
- 수정: Woolly 행별 분류 검토 진입만 잔여 일반 매칭 검증을 우회. 팀 매칭 로딩/저장/분석/최신 revision 보호는 유지하고, 일반 입고 진행은 계속 모든 매칭 완료를 요구. pure gate 회귀 3건 및 packing-team 관련 138건(120 pass/18 optional skip), `npm run build` 통과.
- 수정 후 최신 빌드의 실제 격리 웹앱에서 동일 인보이스/AWB를 다시 선택. 9개 유사매칭이 남은 상태에서도 버튼이 분류 대화상자를 열었고, 검색에서 Wolly Bush Green Tip(#2997), Red Tip(#2998)을 각각 골라 `합계 검증·문서에 적용` 후 10·11행에 반영된 것을 UI로 확인. 분석 결과/AWB 필드는 로컬 fixture 응답이며 실 AI/OCR은 호출하지 않음.
- 입고 등록·원가 승인·다운로드는 실행하지 않았고, API fixture는 DB에 연결하지 않음. 격리 UI에서 분류표시·검색·선택·문서 적용까지 검증 완료. 화면 검증 시 가로로 넓은 모달의 일부 DOM 클릭은 위치가 어긋나 실제 화면 좌표 조작으로 후보 버튼을 선택함.
- 검색어: 44-01 AU actual UI Woolly classification 9 fuzzy unresolved packingPreparationBlockReason test build
## 2026-10-28 최종 수기입력 보존 정정
사용자 “수기입력 묶음은 모두 보존” 확인. 앞선16archive/11견적삭제/4초안 계획은 실행 전 철회했고 해당 JSON은 executable:false로 봉쇄했다. 브라우저 혼합저장에서 첫 자동행의 sourceFileName이 수기행까지 공통 적용된 실제 저장버그를 확인했다. 1019 및1048~1060 총14수기와1139~1142 다음저장4수기는 수량·견적·원장버전 전부 보존하고 감사 이력만으로 출처를 정정한다.926도 보존한다.1066/1067 자동2건은 원문5233(25/6)과15/15 불일치로 삭제 없이 검토표시.별도 과거해제자동864→43차10803만 기존 선택삭제/편집잠금으로 정리한다.최종 고정계획 defect-manual-provenance-final-2026-10-28.json 및 reconcile-defect-manual-origin.mjs가 이전 계획보다 우선한다.
검색어: 수기입력 모두보존 sourceFileName 혼합저장 MANUAL_SOURCE_CONFIRM SOURCE_FACT_REVIEW 10803

검증: 전체 test:erp-contract, dnSpy evidence, 변경분 manifest/write guard 통과. 운영DB CTE SELECT-only로 수기확인 양성1/다른원천·다른근거종류·false3음성 통과. 원인코드는26bf5a555(2026-07-22)부터 있던 공통파일 우선순위이며2026-10-26/28 혼합저장 감사로 실제오염 확인. build/CI/배포는 진행중.

로컬 production build 통과. PR1346 CI 진행. 이전현재정정계획 문서 상단에 철회 고지, 감사조회도 수기확인 이력을 존중하도록 정합성 보완.

## 2026-10-28 PR1348 CI 보완
- PR1348 첫 CI에서 `importPackingHardening.test.js` harness가 새 `packingReceiptPreparation` 모듈을 mock registry에 등록하지 않아 한 테스트가 실패함. 앱 로직 실패가 아닌 테스트 harness import 누락으로 확인, helper를 harness에 등록해 수정.
- 검색어: PR1348 CI packingPreparationBlockReason importPackingHardening harness dependency

## 2026-10-28 호텔 차별수량/원본 행정렬
- 저장자료1~4차 및 총수량 우측표, 셀수정/원본 hover비교. 반복출처 제거, 원본 경계선 행정렬과 수동조정. ERP SQL/API 불변.
- 단위11개/Chrome 행좌표·수정·원본보존 검증. 필수검사·배포 진행, 실제주문 미검증.
- 검색어: HotelQuantityMatrix HotelMatchReview 1차 총수량 원본 줄정렬
## 2026-10-28 다음차수 차단 유지
비고재저장으로 SOURCE_FACT_REVIEW 차단이 풀리는 경로 보완. 감사이력의 차단도 조회하며 뒤의 원문재검토만 해제.43/44/45/53차 목록·preflight·preview·최종등록의 잘못된클라이언트플래그 반례와 쓰기0 검증.수기확인·원장·견적은 보존. 검색어: 다음차수 factHistory laterFact SOURCE_FACT_REVIEW

## 2026-10-29 도착원가 독립 작업대
- 도착원가 메뉴 기본 진입을 기존 입고 조회로 분리. 새 인보이스 원가도 같은 메뉴 내부 처리, 입고 업로드와 초안 저장소를 분리하여 재업로드/재매칭 왕복 제거.
- 실제 Nenova Desktop에서 기존 44-01 호주 입고 #7863 조회 확인. 관세율 기본값 누락 발견 후 승인된 호주 품목별 기본값을 읽기 전용 계산에 연결.
- 격리 웹화면에서 실제 입고 SELECT 복사자료 11행으로 조회→AUD/항공/GW·CW805→시험환율950→미리보기→엑셀 다운로드 완료. Green/Red 매칭 유지, Red 저장총액5100 유지. 다운로드 3시트 및 계산 수식 확인; 합계23967723.5원(시험값, 승인원가 아님).
- production build/packing-team/native-cost 테스트 통과. 운영 DB 쓰기 없음. PR CI/배포 및 배포 후 설치 웹앱 다운로드는 이 기록 시점 미검증, 완료 후 추가 기록.
- 검색어: IndependentCostWorkspace cost draft native-cost AU 44-01 7863 tariffDefaults 재업로드 재매칭 분리
## 2026-10-29 거래처관리대장 검색/담당자 및 미반영 입금 비교
- 실제 /ecount/customer-ledger에 업체/담당자 검색, 담당자 토글, 업체명 옆 담당자 표시. 서버의 담당자 범위/SS3 전체조회 유지.
- E010205 입금의 회계반영 이력 정확 패턴과 코드로 연결, 미반영 전후/대장 수금합계 대조. 중복식별/이미반영/수금합계불일치/코드충돌/자체이체/수집실패 보류. 같은 대장 snapshot에만 계산근거 저장하며 누적차감하지 않음. 원문 계좌/입금자는 저장하지 않음.
- dnSpy ClassCustomer와 SELECT-only probe(활성675/유일담당125), 실제 UI13열/전월/빈입금/회계반영 숫자footer 확인. 관련38테스트, 전체ERP계약, dnSpy/manifest/write guard 통과. 빌드/CI/운영배포 및 원본PC 적용은 이 기록 시점 진행중(미검증). 실제 미반영 입금 양성 사례는 원본에 없어 fixture로 검증.
- 검색어: customer-ledger managerName pending-receipts BANK_CHANGED ACCOUNTING_RECONCILIATION 중복차감 미반영입금
## 2026-10-29 호텔 원본 연결선·여백
- 다중표 OCR sourceBox 추가,hover/focus 연결선·원본강조,기존자료 명시원본클릭 위치수정.행30/컨트롤26px.수량/ERP쓰기 불변.
- 단위/API14개·Chrome 우측표연결 및좌표수정후 수량보존 확인.실업무OCR·주문등록 미검증.배포후추가.
- 검색어: 호텔 sourceBox 연결선 다중표 여백


### 2026-10-29 좌우 표 분리 비교
- 원본 행 좌표의 가로 영역으로 2~4개 표를 구분하고 각 표 이미지와 해당 매칭 행을 나란히 표시. 이미지 바깥 공백을 잘라내고 패널 간격 8px, 이미지-매칭 간격 4px, 행 높이 30px/입력 높이 26px 적용.
- 좌표가 없는 기존 자료는 전체 원본 비교와 위치 지정 기능 유지. 좌표 변환은 표시 전용이며 수량/업체/ERP 원장 변경 없음.
- 검색어: 호텔 좌우 표 이미지 분리 매칭 여백 hotelSourcePanels

- 검증 완료: 실제 parse API/좌우 분리 포함 15개 테스트, 전체 ERP 계약, dnSpy, manifest, write guard, build 통과. PR #1353 CI 40795078246 성공, squash d002020acbc1e62d2d1c2f5be74cec1953cf1fde. Cafe24 40795499275 배포 대기(운영 스모크 미검증).

- Cafe24 배포 40795499275 attempt 2 성공: 최초 Chrome 시작 timeout 후 재검사·빌드·서버 전송·hydration smoke 전부 통과. 운영 수동 두 표 이미지 검증 진행.

- 2026-10-29 운영 OCR 검증 보완: 위치 좌표가 원본 행보다 짧거나 위로 치우치면 세로 crop이 품목을 숨기는 문제 확인. 표별 가로 분리는 유지하고 원본 세로 범위는 전체 보존. 검색어: 호텔 원본 세로 잘림 crop safety
- 추가: SS3은 담당자 배정/식별 검증된 업체 최신화 요청 가능, 일반직원 범위 불변. 확인보류 입금이 있으면 부분 계산잔액도 숫자로 제시하지 않는다. 소스 상하단 복수 페이지컨트롤은 첫 표시 컨트롤로 한정했다.

## 2026-10-29 입금 수집 후속 보완
- PR1355/727d2ba2 배포40796947094 성공. 운영검색 미정→미정화훼유통·정재훈, 담당자 버튼 교차필터,SS3 최신화요청 확인. 수집PC3파일백업교체/재시작/로그인복구 확인. 실제최신화채권성공,은행비교실패로보류되어 후속수정.
- ECOUNT 폭에 따른 기간단축버튼 숨김 확인,연월일 위젯 직접입력 공통helper로 교체. 빈입금처는 공통매칭패턴으로 학습하지않음. 운영후속수집은 아직 미검증.
- 검색어: bank history unavailable setReportPeriod dropdown-menu-selectbox responsive shortcuts
### 2026-10-29 주차별 수익률 원천 검증 표시
- DB 변경 없이 본표 저장 참고값/검증보류 라벨과 명시적 SQL 원천 검증 추가. 산술 일치만으로 환율·통관비·재고 평가를 인증하지 않음.
- 38차 카네이션 입고 단수/현재환산195단 충돌,39차 순양수 재고조정2059.05단 및 중국중량·미국운임 누락 확인. 실제 첨부 원본은 다른PC 경로로 미확인.
- 신규 회귀·전체 ERP 계약·webpack 빌드·격리 Chrome 컴포넌트 검증 통과. 최신master 병합후 최종검증/CI/배포 진행. 운영 로그인 브라우저는 도구 초기화 오류로 미검증.
- 검색어: profit-validation-gate 수익률 검증보류 38차195단 39차2059.05단 SQL입고원장

## 2026-10-29 네덜란드52차 연도
- DB확인:37-2 NL 파일의 연도근거없는52-2 54행이2026 현재본. 공통파서에서 파일차수보다 뒤인 미확인연도 시트 차단,2025/2026 회귀통과. dnSpy/manifest/write guard 통과.
- 원본연도 미확인이라2025 재배정 금지. 코드배포후 정확54행 IsCurrent-only 감사격리 스크립트 준비. 전체테스트/빌드/CI/배포/운영격리 미검증(진행중).
- 검색어: 도착원가 네덜란드 52-2 Import23 37-2 연도미확인 rolloverUnproven

- 2026-10-29 범위 보완: 동일 Import23의47-1(73),48-1(66),49-1(66),50-1(15),50-2(51),51-1(7),51-2(50),52-2(54), 총382행 모두 연도근거/수동수정이력0. 같은원인의 미확인 연말범위 전체를 격리 대상으로 확정(위54행 한정계획 대체).1~37차 및 다른Import/연도/국가는 보존. 아직 실행 전.

## 2026-10-29 카네이션 엑셀 분배 적용 멈춤
- 44-01 카네이션381행 Audit135/136 시작상태와09:59/10:14 배포reload 중첩 확인. 현재DB 실행요청0. 특정 업로드 rollback 여부는 미확정, 운영원장/이력보정 없음.
- applyImportRows 전체 공유flock, 배포gate+exclusive drain(20분 timeout시 배포중단), 진행정보소실/네트워크대기 제한. EXE CLI 확인, 원장SQL/환산/기존주문보존 불변.
- 업로드회귀/dnSpy/manifest/write guard 통과. 전체검사/빌드는 기존공유node_modules 누락으로 독립의존성 설치후 재검증중. Linux 실제flock·CI·배포·실브라우저는 아직 미검증.
- 검색어: 카네이션 381행 Audit135 Audit136 IMPORT_DEPLOY_BUSY IMPORT_PROGRESS_LOST flock deploy drain

## 2026-10-29 송이 기준 웹 원가 전수 검증 — 진행 중
- DB 쓰기·기존 보고서 계산/확정본 갱신 없이 실제 원행 송이와 WdetailKey별 도착원가 금액으로 새 비교 엔진을 검증했다. 표시 단·박스와 계산 송이를 분리하며 현재 Product 계수로 과거 단위를 역산하지 않는다.
- SELECT-only 확정 출고43,253행/104세부차수/14.174초(105조회), 입고22,786행 및 실제 재고·조정 원천. 1~43차+진행44차 실행 후 독립 WAC/기말액 산술위반0. 무활동0재고는 양수원가 성공과 별도 집계.
- 38/39 실제 통합조회에서 품목 도착원가합계와 본표G+H 배분 범위 차이를 발견해 K를 보류. 산술검사 통과를 전체 수익률 정상으로 설명하지 않는다. 원가 원천 보완·최종 재검증/CI/배포는 미완료.
- 1차는 전년도 기초원가 근거 미지원,8차는7차 이월/현재마스터 환율뿐이라 보류. 자세한 수치와 엑셀26~31 비교는 `docs/work-sessions/2026-10-29_profit-stem-independent-audit.md`.
- 검색어: 송이기준 원가 stemCostLines 43253 Master키300 38·39 G+H 비용대사 8차환율


## 2026-10-29 호텔 원본·매칭 같은 가로줄
- 원본 표 경계선을 패널별로 검출해 첫 행 위치/최소30px 행 높이를 이미지와 매칭표에 공통 적용. 표별 수동 줄 조정은 기존 서버 초안 alignment.panels에 보관. 제목/노란 배경/연한 빈 격자/행 개수 불일치 방어. ERP/API 쓰기 변경 없음.
- 22행/14행 서로 다른 제목 높이 합성 이미지 실제 컴포넌트에서 1920px/800px 정렬·수량 격리·Tab/Shift+Tab 확인. 16개 단위/API 회귀 통과. 전체 검사/빌드/CI/배포는 진행 중(미검증).
- 검색어: 호텔 같은 줄 행 정렬 hotelImageRowBounds alignment.panels
## 2026-10-29 관리대장 담당자·업체 버튼 선택
- 담당자 전체/개별 및 업체를 aria-pressed 버튼으로 변경. 담당자 변경시 업체선택/상세 초기화, 업체 재클릭 해제, 연결불가 disabled. 검색과 기존 권한 유지.
- 방향키/Home/End 초점 이동, Enter/Space 선택. UI만 변경하며 API/SQL/ECOUNT/공유 원장 보존. 기존 교차연도 fixture 유지.
- 검증/배포 진행 중. 추가 요청의 부호는 입금-판매(초과+,미수-), 차수귀속 기준은 사용자 확인 대기.
- 검색어: customer-ledger 담당자 업체 버튼 aria-pressed signed balance

- 추가 결정: 입금일 기준 차수 비교, 입금−판매(초과+,미수−). PeriodDay read-only 및 dnSpy CommonLogic 근거 확인. 달력31일/유일31/202639~44. 검증 반영입금+미반영deduct−ECOUNT판매, 이월 제외/부분차수 표시. 관련33테스트 통과, 통합검증/배포 진행중.

## 2026-10-29 카네이션 완료 후12분 결과확인 경고
- SELECT-only Audit137:2026/44-01,10:53:24 시작→11:05:53 SUCCESS(12분29초),381중324반영/57동일,사후381MATCHED/불일치0,스냅샷648. 재적용 불필요.
- UI 총12분 제한을 진행정보updatedAt 미갱신12분 기준으로 변경. 실제진행만 대기연장,같은/역행/잘못된timestamp와정보소실은 연장하지않음. POST재전송/원장SQL변경없음.
- 13분지속후성공·정체·역행·잘못된timestamp 회귀7개통과. 전체검사/빌드/CI/배포는 진행중(미검증). 검색어: Audit137 381 324 57 12분29초 idle timeout updatedAt

## 2026-10-29 송이 기준 원가 최종 독립 읽기 검증
- 사용자 확정: 기존 실제중량/AWB 비용 배분 유지, 송이당 환산만 변경. 본표 총액에 맞춘 송이비례 재배분·금액 보정 금지. DB 쓰기0.
- 최신90세부차수 비용 원행 재수집2431SELECT/41.353초/오류0. 캡처한 물량으로1~43+진행44차 재실행, 독립 WAC·기말평가·수량대사 산술 위반0.
- 양수원가4266 차수·품목 조합 모두 추정 포함. 무활동0원123750, 원가보류10612. 본표 비용과 AWB 비용 풀 차이/역사원가 누락이 해결된 것은 아님.
- 최종38차36.857초·39차31.928초, 전체수익률 보류. 기존 대사차이는 금액을 억지로 맞추지 않고 표시. 상세 `docs/work-sessions/2026-10-29_profit-stem-independent-audit.md`; 원천 `.verify/`는 커밋 제외. CI·배포 결과는 부모 작업에서 확인 중(미검증).
- 검색어: stem v3 2431 4266 DEFAULT_CUSTOMS gw_auto AWB 송이 평균원가 no_activity


## 2026-10-29 카톡방 재고관리
- 페이지 전용 재고장/원문 분석/직접입력/시작재고 정정/카톡 복사 구현. UserFavorite 별도 저장본, ERP 원장 변경 없음.
- 예시·0·취소초과·단위·교차연도 테스트와 메뉴/write guard 통과. 전체검사/빌드/브라우저/배포 진행 중(미검증).
- 검색어: 카톡방 재고관리 kakao-stock-ledger 시작재고 업체수량 변경내역

- 검증 완료: 전체 test:erp-contract, dnSpy, manifest, ERP write guard, UI layout, webpack build 통과. Chrome 1920/390에서 예시 계산·복사·저장재열기·Enter/Escape·정정·시작재고 수정 통과, ERP 쓰기 요청 0. PR/배포는 후속 진행.

## 2026-10-29 이전 초안 위치 복구
- 동일 계정/연도/차수/원본이미지 후보 중 원본품목명+원본수량 유일일치 위치만 복구. 기존 edited qty/unit/prodKey/배분/로그 보존. 실패/중복/충돌/잠금은 적용 안 함. 별도 원본 위치 다시 읽기 제공. 위치만 기존 서버CAS로 보관. 26개 회귀 통과, 전체검사/배포/실자료확인 진행 중.
- 검색어: 호텔 이전초안 위치복구 recoverHotelSourceRows 동일이미지

- 실제 구형/신형 초안은 같은 이미지·35행·원본 수량 전체 동일, OCR 명칭 6행 차이. 동일 이미지의 단일 전체 후보에서 rowNo/sourceRowIndex·모든 원본 수량/단위가 일치하고 80% 이상 명칭이 일치할 때만 위치 복구 허용. 부분·재정렬·원본 수량/단위 차이·다중 후보는 이 보조 경로 거부. 편집값은 그대로 보존.

## 2026-10-29 카톡 재고장 원문·이력 상시 표시
- 접힌 원문 영역을 상단 2열로 분리: 최근 3일 자동 조회/검색/페이지 이동/선택 원문 전체 및 최신 전산이력. 원문 30초/선택 이력 10초 갱신.
- 선택 원문 분석 → 적용 전 확인 → 명시적 재고 적용. ERP 이력과 독립 적용표시, 중복 적용/다른 연도·차수/복수차수 차단. 조회 실패는 목록·선택·입력 유지.
- 기존 sales-feed GET 및 distribution-live-history 읽기 전용 재사용, SQL·EXE 저장순서·ERP 원장 변경 없음. 교차연도 fixture/계약 갱신.
- 빌드/manifest/dnSpy/write guard/UI layout 통과. Chrome 1920/390: 원문 선택→분석→예시 적용, 전년도 정확한 이력범위, 중복 차단, 조회실패 보존 통과. 기존 복사/저장재열기/정정 smoke도 통과. 전체 회귀/CI/배포는 진행 중(미검증).
- 검색어: 카톡방 재고관리 영업방 원문 최신 전산이력 KakaoStockInbox stockSourceWeek

## 2026-10-29 재고 우선 배치
기초재고와 현재재고·변경내역 나란히, 카톡 원문은 뒤에 배치. 최근 변경 한건/품목별 전체본 토글, 변경 클릭시 해당 품목 직접입력 펼침. ERP 계산/저장 API 불변. 검증 진행 중.
검색어: 카톡 재고 최신변경 전체본 directOpen
## 2026-10-29 호텔 특수매칭·최종등록
- 특수 이름/단위 차별합산, 차수수정, 최종수량 조절/누락복원, 소수3방식, 등록 snapshot/잠금히스토리.32개 테스트와 격리 UI(3차합산/수정/누락/round/ADD/부분실패) 통과. 필수검사·배포 진행중. 운영주문 쓰기0.
- 검색어: 호텔 특수매칭 누락 최종수량 registrationSnapshot hotelOrderEdits
## 2026-10-29 재고 우선 배치
기초재고와 현재재고·변경내역 나란히, 카톡 원문은 뒤에 배치. 최근 변경 한건/품목별 전체본 토글, 변경 클릭시 해당 품목 직접입력 펼침. ERP 계산/저장 API 불변. 검증 진행 중.
검색어: 카톡 재고 최신변경 전체본 directOpen

## 2026-10-29 도착원가 입력 순서 안내·호주 글꼴
- useCostStepGuide: 미입력/유효성 오류→공식확인→미리보기→활성 다운로드 강조. 입력 중 focus 탈취 없이 blur 후 다음 위치 안내. 기존 서버검증·승인·ERP 쓰기 불변.
- 호주 원본 8/9pt·Calibri 혼합을 맑은 고딕11pt로 통일. 판매가 O열 미입력시 N/Q:T 및 상단손익이 공란인 기존 수식 정상 확인, 파일에 입력대기 안내 추가. 임의 판매가/손익 생성 금지.
- 단위/엑셀 관련105통과18선택적skip. 전체검사·실웹앱·배포는 진행중(미검증). 운영 DB 변경 없음.
- 검색어: costStepGuide data-cost-next AU font 맑은고딕 O열 판매가 입력대기
## 2026-10-29 이카운트 실제 코드 후보 조회
- 로그인 후 E040723 거래처 조회에서 다원플라워 동명2건(서로 다른10자리코드), 대지원예(X)/대지원예2 각각 다른10자리코드 확인. 원문코드 저장/출력 없음.
- Customer340의11자리값은 두 다원후보 코드와 불일치(앞/뒤1자리 제거도 불일치).351/646 공유10자리값 역시 원본 두 코드와 불일치. 기존 사업자번호=거래처코드 가정으로 자동연결 불가.
- 동명 다원후보 지정 및 대지원예(X) 유지여부 사용자 확인 요청. 조회전용 수행, 매칭/원장 변경/배포 없음. 사용자 확인 후 웹전용 명시매핑과 source-code/business-identity 분리 검증 필요. 같은source코드 2개고객 귀속 금지.
- 검색어: verified-customer-links 다원플라워 동명이인 대지원예(X) sourceCode businessIdentity 340 351 646

## 2026-10-29 다원플라워 거래내역 비교
- 사용자의 거래내역 비교 요청에 따라 E040723 개별거래처/전표별로 두 실제 코드를 각각 직접 조회. 후보0은 날짜 거래행0, 후보1은 거래행11.
- 네노바 CustKey340 확정 출고매출 2026-09-02~10-21 8개 날짜의 금액이 후보1의 09-08~10-27 판매금액과 8건 모두 일치. 모든 건 이카운트 판매일이 출고일보다6일 늦음. 다원 후보1 식별 근거 확보, 원문코드 미기록. 웹 매핑/배포는 아직 미완료.
- 검색어: 다원플라워 거래내역 비교 8건 일치 6일 날짜차이 후보1

## 2026-10-29 검증된 원장 연결 구현
- 사용자 다원 두번째후보 승인. 대지원예351/대지원예2 646 같은원장 공유 승인. canonical646 수집/요청/조회1개, 웹 원장공유 표기.
- sourceHash/localIdentityHash/name 고정, 전체활성업체 충돌 검사, 현재 소유권/단일담당/별칭 원장조건 유지. Customer/공유ERP 변경없음.
- DB675업체 읽기전용 사전검증:3대상linked, 유일한 수집대상122개. 관련21검사통과. 전체검사/배포/운영스모크 미검증(진행중).
- 검색어: verified-links 다원플라워 대지원예2 canonical646 중복차감방지

## 2026-10-29 호텔 박스계수 없는 주문
- 동일단위 주문의 불필요한 박스계수 차단 제거. 계수없는잔량은 직접업체배정, 다른단위 환산검증 유지. 검증/배포 진행 중.
- 검색어: 호텔 박스 환산계수 Graciosa 호텔여분 직접배정

추가: 최종표 직접 올림/반올림/내림, 단/박스·송이/박스 표시, 서버 quantityHistory/frozen보호 및 등록 snapshot, 작업저장 버튼. 품목→수량280px·행33px. 33개 검사와 격리 UI 3방식/저장재열기/키보드/무계수배정→ADD/히스토리잠금 통과. 전체검사/배포 진행중.

## 2026-10-29 채권 관계기준 정정 진행
- 사용자 미카엘4,997,800원 실제 상세대장 기준 수정/남은업체매칭/배포끝까지 요청.
- 원본 관계기준=4,997,800, 기존 개별기준=115,902,350 원인확인. relation-v1 수집·표시, 구개별snapshot 원문보존/재수집안내.
- 446신라호텔 실제5자리code와원본거래확인, 689태림A 매출3건 기존565태림원예 일치/담당동일, canonical565 원장공유. 현재담당유일미연결0건.
- 담당미배정 등 관리자134곳은 범위질문대기. 권한/담당임의추가 없음. 관련24테스트pass, 전체검증/배포/운영스모크진행중(미검증).
- 검색어: 미카엘 relation-v1 관계기준 4997800 신라호텔 태림A canonical565


2026-10-29 누락 고정예외 착수. 수량다름 중복차단 변경안 철회. 체크누락 버튼과 재업로드 고정예외 요청. 동일신고 수량변경 범위 질문중. 구현/테스트/배포 미완료. 검색어: 누락 고정예외 defect-permanent-omit

2026-10-29 누락예외 기준확정:연도+원차수+업체+품목+수량+단위. 새차수/다른수량허용. 버튼/API/History-only 예외 구현,테스트진행. 검색어:PERMANENT_OMIT omissionSql
## 2026-10-29 최신화 응답의 거래처 선택 경합 수정
- 관계기준fd1545c0 배포/실수집: 미카엘4,997,800,신라81,730,453,다원676,500,태림90,128,148 실제원본GREEN. 646재수집진행중.
- 운영 빠른업체전환에서 이전POST응답이현재선택을덮는경합발견. 별도selectionId/고정key로성공·실패응답을선택범위에묶고unmount/ABA차단. 선택요청에대한부작용은웹조회뿐,전체ERP보존.
- 관련25개검사pass,전체검증/추가배포진행중(미검증). 관리자미배정134곳범위질문답변없어원래영업담당배정업체범위진행.
- 검색어: ledger-selection selectionId 늦은응답 거래처전환 미카엘 관계기준

2026-10-29 호텔 후속: 분류업체 이름검색/차수삭제(원본 batchHistory 보존·frozen잠금)/원본 클릭열기/검색결과 더블클릭 적용. dnSpy 재추출 및 동일키 읽기 probe0. MD 오래된 my-customer ADD 재고계산 설명 정정, 현행 코드 주문전용 재고보존 확인. 테스트/배포 진행중. 검색어: 호텔 차수삭제 업체검색 더블클릭 batchHistory

## 2026-10-29 기존 채권 확인 자료 복구 진행
- 사용자: 전체자료안보임,기존확인건유지요청. 기준변경시구자료ledger=null분기가원인. currenthash와권한유지,관계기준GREEN우선/없으면이전GREEN을이전기준참고자료로보존. 미카엘4,997,800유지,옛115,902,350으로회귀없음.
- 담당125개:현재기준7(별칭포함),이전기준80,현재연결에맞는검증본없음38. 87개모두날짜/숫자/합계재검증pass/invalid0. 기존자료삭제없음.
- 실제읽기31영남꽃소재25,362,700/확인시각11:01:58KST복구,13미카엘4,997,800유지. 시간외requestAllowed=false지만둘다조회가능. 시간외버튼비활성/안내,COMPLETE와없음안내동시표시차단.
- 전체계약/dnSpy/manifest/writeguard/webpack exit0,관련28개테스트. 배포/실웹최종확인진행중(미검증). ECOUNT/공유ERP원장쓰기없음.
- 검색어: ledger-recovery legacy-reference 기존자료유지 80곳 28검사 requestAllowed

2026-10-29 차수 품목수정 후속: 수정 중 차수 원본 비교창 편집 허용, 수정 버튼은 편집영역 이동/초점. frozen/CAS 및 ERP등록경로 유지. 검증/배포 진행중. 검색어: 호텔 차수 품목 재매칭 batchEditor

2026-10-29 관세 양식 승인추정 표시 독립검증: nw-profit-template-duty에서 DB SELECT만 실행. 1~41차164국가행 산술·원본불변·멱등 위반0. 기존 AWB 운임 절대액 보존 후 원행 단/박스 또는 실제 송이로 bucket내 환산. EC41 관세445,176.58원·이월기초증가96,793.67원, 표시K4.8694→−17.3591%. 태국38/39 미승인품목 보류 유지. 실제 주차38/39/41 및 월별43차수 대사5.052초/28SELECT/쓰기0/불일치0. 전체CI·배포·다운로드 파일·브라우저는 부모 최종 확인 전 미검증. 근거 docs/work-sessions/2026-10-29_profit-template-duty-release.md.
- 검색어: 관세 양식 승인추정 AWB 절대운임 445176 96793 41차 에콰도르 templateDuty

2026-10-29 관세 양식 표시 배포 후속: PR1381 최종CI40856429505 통과, squash a3de9d96bb939e311daf94afb1500f51e435b75f, Cafe24 deploy40857166305 SUCCESS. 부모가 운영Chrome41차 에콰 E499547/H581177/J−423246/K−17.4%,38·39태국 보류, 월별43차까지 저장본우선·44~50제외·누락합계공란 확인. ping200/DB연결·hydration 성공. DB쓰기·저장·확정 없음. 41차 실제XLSX 파일대사는 아직 미검증/대기. 근거 docs/work-sessions/2026-10-29_profit-template-duty-release.md.
- 검색어: 관세양식 배포1381 a3de9d96 40857166305 에콰41 태국보류 XLSX대사

2026-10-29 운영다운로드 검증완료: Downloads/매출이익_2026_41차.xlsx 실제1시트41차, 에콰A14에서헤더추적 E14=499547.13826/H14=581176.577125/J14=−423246.023885/이익률L14=−.17359068219830806 독립값일치. SHA256 aa6ea41a2fb4852d90816dae98cff1825aceea7c35d954f6509730d60056b105 읽기전후불변. 파일수정없음. 감사요약첫8경고제한으로새에콰관세추정문구는직접표시안됨(환율추정·외33건웹확인만표시),설명제한별도보고.
- 검색어: 41차 단일시트 다운로드 검산 L14 581176 관세추정 설명제한

2026-10-29 출력 설명 후속진행: 운영XLSX 관세추정 라벨 누락으로 완료보류. codex/profit-template-duty-export-label에서 선택시트/합본/인쇄 안내보존만3파일수정, 계산·DB불변. E/H/J/K 선택→단일41시트→binary읽기/인쇄회귀통과,독립소스리뷰추가핵심문제없음. 전체guard/build진행중;새PR·CI·배포·운영재다운로드확인전미완료.
- 검색어: 관세추정 라벨 export-label A1 A2 combineOutputBooks 인쇄 실제납부확정아님

2026-10-29 출력라벨 후속 전체검증: npm run verify:erp-change exit0 PASS(webpack build포함,.verify/erp-export-label.log),명시writeguard origin/master대비0API PASS. 후속PR/최종CI/배포/운영재다운로드는대기. 문서커밋전상태동결.
- 검색어: 관세라벨 전체검증 PASS export-label 재다운로드대기

2026-11-02 채권 통합표: 차수 요약과 원본 전표를 한 표로 통합. 각 차수 아래 전표 전부 표시, 은행 입금은 차수 합계에만 표시. 원본/기존자료/수집/DB/권한 변경 없음. 대상34검사 통과. 전체검증·배포·운영확인 진행 중. 근거 docs/work-sessions/2026-11-02_ecount-unified-ledger.md.
- 검색어: 차수 전표 통합표 ledgerTableGroups 원본잔액 은행중복합산금지
2026-11-02 누락 내역/취소 착수. 원HistoryKey별 취소감사만추가,기존ERP보존,재누락시옛취소무효.검증진행. 검색어:PERMANENT_OMIT_CANCEL 누락취소

2026-11-02 세션오류해결/유지보수기준 문서화. docs/DEFECT_DEDUCTION_MAINTENANCE.md에 원인·사용자최종결정·수기보존·누락키/취소·철회계획·검증한계 정리,AGENTS/ERP가드/계약에연결. 검색어: 불량차감 유지보수 누락취소 수기보존
2026-11-02 주차별 매출이익 상태·버튼·빈 값 원천 안내: 표시전용 및 진단메타 추가, DB쓰기0. 43차 TH14/CN39/EC1 입고행 승인정책 key부재와 CN15행 운임배분대사실패를 확인; 태국 재고null은통관비후속보류, 중국기초는웹평가방식지원제약. WebCustomsWeekly2026/43 실제저장행0 확인. baseline31시나리오금융출력·50버튼handler보존 타겟PASS. fullguard/CI/배포/실브라우저검증은아직미완료. QA정본 docs/work-sessions/2026-11-02_profit-report-status-toolbar.md.
- 검색어: 매출 상태툴바 어떤DB 원천대조전 관세규칙미매칭 운임배분대사 재고평가 진단메타

2026-11-02 상태툴바 검증갱신: 전체 verify:erp-change2차 exit0(계약/dnSpy/UI/manifest/쓰기가드/build), 명시 manifest174/쓰기0API PASS. 이후합계K의정상0분모행오인만표시보완, 상태/parity31/50handler 재PASS. 최종build·PR/CI·배포·운영스모크대기. 최초소스앵커실패와수정기록은QA에보존.
- 검색어: 상태툴바 전체가드2차 PASS 합계K C+F 원천누락 분모0

## 2026-10-29 네덜란드 자동원가·주광 비교 진행중
- 사용자 정정: 별도 주광 원가식 불필요. CL2주광 주문수량과 기타주문합계, 입고량/단가/원가 비교 목적. 고객별 실제입고량은 총입고에서 임의 배분하지 않음. 미입고 '-'와 실제0 구분.
- nw-nl-cost-split-1029 branch: 현재시세+15원6통화 helper/GET API, 원가화면 자동조회 연결(빈환율만, 승인/기존값보존,통화경합차단). 주광/기타 순수비교 helper 교차연도·미입고·0 테스트4pass.
- 기존37-1/37-2NL 원가파일 역검증: GW*460+33000+품목수*10000+90000+검역차감/소독추가, 운임=항공기본료+CW*요율; 상품금액비 배분. 개별차수 운임요율/추가비를 무근거로 추정하지 않음.
- 미완료: 화면/엑셀 주문조회·비교표 연결, NL 자동비용기본값, 실제파일 무입력 E2E, 회귀/CI/배포. 운영DB쓰기0. 미배포 상태.
- 검색어: invoiceLiveExchangeRate netherlandsCostCustomerComparison CL2 주광 현재시세15 미입고

## 2026-11-02 네덜란드 실제 다운로드 차단 수정
- 43-02 Holex 7814 SELECT-only: 상품71행, GW1226.1/CW1364, 운송료3689.69EUR. 중량행 보조Box/Bunch=1 때문에 기존 strict 중량판정이 null이 된 원인 수정. 서로 다른 실제중량 충돌과 명시header0 보존.
- 기존 NL 관세표/통관상수 재사용, native 단/송이 비율로 Nicholii50단=150송이 환산. 현재EUR시세+15, 통관비는 서식기본 추정으로 표시. 승인/ERP 쓰기없음.
- 실제71행 계산 issues0, XLSX48356bytes 생성. 회귀·전체검증·배포·실웹앱다운로드는 진행중(미검증).
- 검색어: nlNativeCostDefaults Holex7814 GW1226.1 CW1364 보조수량1 Nicholii 다운로드


## 2026-11-02 업로드 품종 경계 재발 방지
- Audit140 수국파일에서 카네이션42행76박스가 엑셀누락 삭제된 사건 수정. 원본 국가/품종 검증을 자동·명시키·수동 연결에 공통 적용; 혼합원문의 명시 Ruscus 정상허용.
- 교체범위 CountryFlower+FlowerName, 원본근거불명은 실제품목만. 모든 preview에 정확 제품키목록 서명/source-species-scope-v3; 기존 미리보기 재검증 필요. 명시 skip/주문보존/환산/native writer 유지.
- 40개 대상검사 및3359품목6175원문/전분류 경계/교차연도 통과. dnSpy·manifest·write guard 통과, 전체ERP/build/CI/배포/브라우저는 진행중(미검증).
- 운영DB SELECT-only: 2025/2026 44-02 대상3분류 ViewOrder202/137, ViewShipment148/128, Date148/128,Farm0/0,Estimate1/0,견적노출148/65. 운영보정/시험쓰기없음.
- 검색어: 수국 카네이션 WHITE 76 Audit140 source-species-scope-v3 import-category-guard

- 2026-11-02 검증 보완: 전체 ERP 검사에서 기존 replacementCategories 응답값에 표시용 화종을 덧붙인 3개 회귀 실패를 발견. 기존 응답 의미를 보존하고 replacementScopeLabels를 별도 표시값으로 분리. 관련 재검증 통과 후 CI 진행. webpack 빌드/dnSpy/manifest/write guard 통과. PR1386.

2026-11-02 상태툴바 CI·병합 갱신: CI41370537123 SUCCESS, PR #1387 squash master d61bc68cfa1a2171abe149e601ea610e315515d3 병합 완료(01:10:26Z). Cafe2441371056883 진행 중, 배포·실브라우저는 아직 미검증. DB 쓰기0, 추가 commit/PR/push 없음.
- 검색어: 상태툴바 PR1387 CI41370537123 d61bc68c 배포대기

2026-11-02 상태셀 compact 후속: 기존 배포 운영에서 긴 원문 반복으로 행1000px 초과 발견. 원인/DB위치 기본 요약과 전체원문 펼침으로 표시만 보완. 실제CSS·113px·18열 로컬Chrome TH157/CN170/EC153px,142원문보존·Enter PASS. 타겟5/금융parity31/50동작, dnSpy/manifest175/쓰기0API/build PASS. 후속 CI·배포·운영최종은 미완료. DB쓰기0.
- 검색어: compactCause 180px 142원문보존 상태셀 원인상세

2026-11-02 자동수집 복구 착수: 8시124건전체실패·8:56재로그인뒤오전실패분재개없음. 수동미카엘갱신성공(10/31수금4,947,800→잔액50,000). 공용로그인복구/해당작업1회재시도/일회복구마커중복방지/이카운트잔액라벨. 대상59검사통과, 전체검증·배포·카나리·전체재수집대기. docs/work-sessions/2026-11-02_ecount-collector-recovery.md
- 검색어: 자동수집 LOGIN_EXPIRED singleFlight recoveryRequestId 124건 8시실패

2026-11-02 자동수집1차 PR1389 CI41371944528/79bb5f0a,수집기6파일백업·적용/새PID42352/10:26로그인복구/미카엘canary성공. 추가45분제한후미시도원장누락확인→continuation후속:원자적미시도key/같은KST날짜·period/수동요청우선/중복업로드없음. 대상63검사PASS. 최종배포·전체재수집대기.
- 검색어: 45분 continuation deferred 원장누락 PR1389 79bb5f0a

### 2026-11-02 이카운트 조회탭 격리·계속수집 보완
10:44 전체재수집117 중2검증 뒤 화면전환/reset 실패가 나머지를 실패로 집계하는 증상. 작업별 소유 조회탭 분리/정리, 미확인 커서의 거래처별 원자 저장, API 장애시 커서 보존, context 소실시 커서 후 launcher 재시작. 은행불가 사유는 고정 enum 진단만 보존, 미검증 금액 null/기존 검증본 보존/중복차감 방지 유지. 회귀67 PASS, CI/배포/최종수집 미검증(진행 중).
검색어: ecount isolated reads SOURCE_CONTEXT_UNAVAILABLE per-customer checkpoint bank unavailable diagnostics

## 2026-11-02 분배 업로드 중단·결과 복구 수정
- 최신origin/master383520ae5 기반 codex/import-timeout-recovery. Audit137381행749초정상완료;135/136STARTED와기존배포재시작중첩. 기존lease/진척기준대기는유지.
- private aggregate저널+owner해시/감사키, 새로고침동일GET복구, 결과불명새POST차단, 기존job상태/성공감사보호. ERP writer/품종범위/환산/금액/확정불변.
- 관련shipment-import전체통과.750행15분진척, 실child종료/교차연도/권한/보관실패/중복/unknowncommit검증. 전체ERP/build/CI/배포/브라우저는진행중(미검증).
- 검색어: import-timeout-recovery importProgressJournal IMPORT_COMMITTED_REVIEW_REQUIRED 749초 Audit137

### 2026-11-02 채권 최신화 거절/캐시 조회 피드백
새 수집기11:45 실제조회와 은행수금5건 대조 확인. 직전 처리10분 내 재요청의 거절 오류가60초캐시 polling에 지워져 이전완료만 보이는 UI문제 보완. 요청오류 분리유지, 새선택/새자료/새요청에 해제, 거절때이전COMPLETE숨김. 일시 network/5xx는 현재 확인본 유지하며 권한4xx는 비움. 이전선택의 늦은거절은 새거래처에 반영안함. 원본ERP/금액/서버10분제한 불변. 최종CI/배포 미검증(진행 중).
검색어: ecount request feedback rate limit cached polling preserve 503 clear 403

2026-11-02 영업지원 기본목록은 등록완료 숨김. 원장삭제없이 isSupportPendingRow 서버필터. 부분잔량/검토필요/다른수량 유지. 입력/이력 보존. 검색어:영업지원 미등록목록 SUPPORT_PENDING_LIST

2026-11-02 실페이지검증추가:44차161개이월행은잔량양수지만ALREADY_REGISTERED.미등록목록은잔량보다실제등록판정을우선해숨긴다.모든원장보존. 검색어:ALREADY_REGISTERED 이월잔량161

2026-11-02 네덜란드·중국 물량표 업체명 상단 고정/위쪽정렬. 원래 헤더 셀을 공통 useVolumePageHeader로 이동해 페이지/팝업 스크롤·가로 정렬·기존 입력 보존. API/SQL/ERP 원장 변경0. ERP전체/pivot/dnSpy/manifest179/쓰기0API/build PASS; 실제Chrome 1366/760, 일반/팝업,3/4행,print/복귀/가로정렬 PASS. CI·운영배포는 진행중(미검증). docs/work-sessions/2026-11-02_volume-customer-sticky.md
검색어: volume-customer-sticky 업체명 고정 위쪽정렬 네덜란드 중국

2026-11-02 이카운트 반복조회 감소: 최신master e08e8007 분리worktree. sanitized은행after→다음before(<90초/동일기간·세션), source직렬화, legacy6종평일08/11/14, 동일연결실패당일보류(수동/변경우회). 상세원본시각·금액·중복차감·공유원장 보존. 대상60 PASS; 전체ERP/build/CI/배포/runtime카나리는 진행중(미검증). 전체요약으로 변동업체선별은 로그인근거 미확정으로배포제외.
검색어: ecountReadReuse sharedPendingReader scheduledReadCycle lookupFailureMemo 원본시각보존

2026-11-02 반복조회감소 로컬검증 완료: 대상60/전체test:erp-contract(후처리포함)/dnSpy/manifest178/ERP쓰기0API/webpack build 모두PASS. CI·배포·owner-PC카나리는 아직미검증.
검색어: read-reduction local gates PASS 60 fixture

2026-11-02 반복조회카나리시작후 실제logincc/ec56/view/login/erp_login을 기존auth감지가놓치는문제추가보완. 실제ERP경로만base, networkidle대신DOM15/30초, browser180초, 단계enum로그. 원본source수식·PII출력없음. 대상62 PASS. CI/runtime재확인대기.
검색어: ecountSourceBootstrap logincc erp_login bounded DOM 180000

2026-11-02 15:15 사용자계정정지보고. ecount전용launcher/collector즉시종료, NenovaEcountDaemon Disabled. 저장정보DOM읽기/로그인클릭/5분자동재시도삭제, 수동URL로그인대기만. 잠금해제/패스워드변경/추가로그인시도없음, user계정복구확인전재가동금지. 원본그대로,canary0/2미검증.
검색어: ecount manual login only account locked Disable-ScheduledTask password retry removal

## 2026-11-02 네덜란드 물량 재조회 단가 복원
- `네노바웹 물량 바로 불러오기`가 같은 연도·차수 출고의 preview.currentCost를 표시하도록 수정. 단가 0/빈칸, 업체별 서로 다른 값 유지.
- 수량·엑셀 주소가 바뀌어도 미반영 단가만 같은 업체·품목으로 복원. 자동 표시한 DB값은 임시수정으로 저장하지 않아 최신 DB 단가를 가리지 않음. 연도·차수/업체·품목 교차 복원 금지.
- 원장 writer 변경 없음. 설치 EXE UpdateCost 확인 및 운영 SELECT-only 2025/2026 44-02 조회 근거: docs/work-sessions/2026-11-02_volume-price-restore.md.
- 단가 순수/실제 페이지 함수 검사, 기존 작업/엑셀 회귀, pivot, dnSpy/manifest/write guard, build, 격리 MSSQL fixture, 실제 Next 브라우저(단가 입력·수량 변경 재조회·전체 새로고침) 통과. 전체 ERP 계약 재실행 중(첫 실행 Node 네이티브 초기화 실패), PR/배포/운영 스모크는 아직 미검증.
검색어: 네덜란드 단가 재조회 바로 불러오기 dutchLivePriceRestore currentCost pending price

2026-11-02 업로드 성능 원인 진단 진행: Cafe24 배포 SSH를 통한 읽기 전용 PM2/nginx 집계 경로 추가. 운영 로그·DB 대기 원인과 수정은 미검증.
검색어: upload performance diagnostic pm2 nginx read-only
2026-11-02 업로드 느림 조사: 운영 nginx 7일 532317요청 중 activity me GET 308792/POST8549; 업로드504·DB timeout 유형280·OOM은10/26만. 기록권한폴링5→60초/숨김탭중지, 기록 fsync worker 이관. 활동 테스트PASS, 로컬build는페이징부족으로 page-data 단계실패. CI·운영개선효과 미검증. docs/work-sessions/2026-11-02_upload-performance-audit.md
검색어: activity me poll 308792 fsync worker upload 504 db timeout

2026-11-02 라움·신라 손익 HTTP 413 원인 보완: 운영 무인증 무해 본문 probe에서 /api/raum/pnl-import 30MiB는 401(nginx 통과), 33MiB는 413. /api/raum/pnl 및 /api/raum/pnl-image-import는 2MiB도 413으로 nginx 기본 제한 확인. exact 경로에 각각 8m/32m 추가, JSON 결산 저장 Next bodyParser 8mb 일치. WebRaumPnl 및 ERP 원장 로직 변경 없음. nginx helper·전체 ERP 계약·dnSpy·manifest·write guard·build PASS. CI/운영 적용은 진행 중(미검증).
검색어: 라움 신라 손익 업로드 413 nginx pnl-image-import pnl JSON bodyParser

2026-11-02 네덜란드 도착원가 원본 세율·검역 차감: PR #1416(f16cae97)은 원본 품목/원산지 세율, 종류별 최저 도착원가 품목 선정, 원본 차감 송이수×선택 FOB/송이×환율을 계산본에 연결. 샘플표에 없는 Amerine·Onisogallium·Weigelia는 담당자 결정대로 차감0을 표시. PR #1418(2268c3e1)은 Excel 감사표 AA:AC 폭/FOB 표시 소수 둘째 자리 수정. CI·Cafe24 배포 41413705901·Aside 실다운로드 성공. 2026/43-02 Holex 입고7814 재다운로드 파일 71품목, 검역24종 수수료240000원, 차감323124.70원=감사합계, 통관비823881.30원, Excel 오류0·판매/이익 수식 PASS, 감사 설명 잘림 없음. EUR 실시간 환율1518.8원 기준 추정 계산본이며 운영 DB 입고·재고·확정 원가·손익 쓰기 없음. 다른 국가 전체 실파일 Aside 다운로드는 미검증. 근거 docs/work-sessions/2026-11-02_nl-tariff-quarantine.md.
검색어: NL quarantine FOB sample stems cheapest landed tariff 43-02 Holex 7814 Aside audit Excel 2268c3e1
2026-11-02 활동기록 33건 보류 원인: 운영PM2 `MODULE_NOT_FOUND` 4259건, 원본 lib/worker 존재·Next번들 위치 worker 부재. worker 경로를 process.cwd()/lib 기준으로 수정하고 번들경로 재현 테스트 추가. 로컬 활동 테스트 PASS; CI·배포·33건 재전송은 미검증. docs/work-sessions/2026-11-02_activity-retry-recovery.md
검색어: activity pending MODULE_NOT_FOUND worker bundle path retry

## 2026-11-03 공식 관세·중국27 운임·26~31 검산 (진행 중)
- DB 쓰기0. 공식2026 HS4종의중국89 exact품목+동일보존형태3210추정1개를90조건부로연결. 특혜자격/실제납부확정아님,다른국가공식율미검증.
- 27-02실운임4269.5CNY 대비legacy4580.2183 배분불일치수정은관세전용.입고원가출력보존.27원본J10빈칸은SQL행없는역사fallback만null복원,실제0/수기보존.
- 26~31입고25반차수중완전14,숫자원본12중11이±1만원/29-01중국+56289원.미완전11·빈칸2는정확도판정제외.27H+621939.946원,F/28E+102092.029원.엑셀/SQL운임655CNY차이는별도미해결.
- 표적18·진단parity31·freightCalc238/pivot PASS. 전체verify두번째실행중·PR/배포미실행.사용자Aside요청은오른쪽열기queued,Work browserdisabled로실브라우저미검증.
- 정본 docs/work-sessions/2026-11-03_official-duty-freight.md.후속완료증거는추가기록할것.
검색어: official-duty-freight 관세90조건부 27-02 40cm J10빈칸 655CNY 621939.946 Aside disabled

2026-11-03 공식관세후속: 초기90/11of12는중간결과.3212PreservedPink가3210Blue와동일보존형태여서조건부8%로일관화,최신91/표적19PASS.숫자원본12개±1만원이나미완전11·빈칸2·27/29운임655/917CNY차이·오차상쇄위험잔존.29실제관세739050원보존,DB쓰기0.전체verify3차진행중(manifest필수명령누락수정180PASS),PR/배포미실행/실브라우저disabled.정본추가기록참조.
검색어: 관세91 PreservedPink3212 sameform 12of12 917CNY 오차상쇄 verify3차

2026-11-03 공식관세 로컬최종gate: 최신91정책포함verify:erp-change3차exit0,ERP계약/posttest19·dnSpy·manifest180·SQL쓰기guard·webpack58초컴파일/전체페이지build PASS. PR미생성·CI/배포/운영smoke대기,브라우저disabled·DB쓰기0. `.verify` 및generated history두JSON커밋제외.
검색어: 공식관세91 verify exit0 manifest180 webpack58s 로컬gate완료 PR대기

2026-11-03 신규 인보이스 정상경로 1차 수정: nw-invoice-full-route-1103에서 등록 후 같은operation/WarehouseKey readback 성공에만 cost 자동이동, 등록 문서는 원가계산기 직접 표시. 기존원가 조회는 E2E 대체증거 아님. 실행형 성공/조회실패/키불일치/선택변경 회귀PASS, 워크벤치17PASS. dnSpy 실제설치 EXE/7863 SELECT-only 재확인. Docker engine 미연결로 격리SQL/Aside 업로드→입고→다운로드 미검증, 전체gate/배포 미완료. 운영DB쓰기0. 계획 docs/plans/invoice-full-route-2026-11-03.md.
검색어: invoice-full-route 등록후자동원가 readback Aside 격리Docker 미검증

2026-11-03 Aside 재연결 확인: Aside REPL로 실제 nenovaweb.com/import/tools 탭 연결 및 작업 선택 화면 조회 성공. 로컬 격리DB를 위해 Docker Desktop 재시작했으나 backend 로그에서 initializing Inference manager/dockerInference 파일 접근 오류로 시작 실패 확인. Docker 초기화/파일삭제/운영DB 대체쓰기 미실행. 실제 신규 업로드→입고→도착원가 다운로드는 여전히 미검증, 배포하지 않음. 운영DB쓰기0.
검색어: Aside 연결정상 Docker dockerInference 파일접근오류 격리E2E 미검증

2026-11-03 농장 검색 장애 1차 보완: InvoiceReceiptWorkbench 농장 조회 실패를 빈 결과로 숨기던 catch 수정, 응답 배열 검증·abort 뒤 늦은 결과 무시·재검색·후보 직접선택·선택 FarmKey 상태 표시 추가. 기존 자동매칭/워크벤치 실행형 회귀 28 PASS. Aside 운영 탭 연결/입고 작업 탭 진입 확인, 저장 문서 조회 버튼은 element-ready timeout 후 해당 작업대가 snapshot에서 사라져 실제 농장 검색 재현 미완료. 운영 화면 작업기록 저장 경고 존재(원인 미확정). 사용자에게 실패 파일명/국가 요청. 운영DB쓰기0, 로컬수정만/배포미완료. 총금액 원문캡처 확인과 등록건 새창 연결은 아직 미구현.
검색어: 농장검색 farmError 후보직접선택 Aside timeout 28PASS 총금액확인 미구현

2026-11-03 45-1 중국 로그 SELECT-only 진단: SystemActionLog에 45-1 중국 CI-2026-NN009_변환_NN007.pdf UPLOAD_FAILED 3건(11:20,11:50,13:17), detail NULL. WebInvoiceDocument 2026/45-01 및 NN009/NN007 파일명 조회0. Farm 전체97 활성87 중 HUB/KUN 이름0. 반면 WarehouseMaster HUBFRESH 입고 존재(7771/7770/7769,2026/43-01,XJ-2026-NN007). 현재 자동입력/검색은 Farm만 조회하므로 기존 입고 FarmName HUBFRESH를 선택할 수 없음. dnSpy golden은 WarehouseMaster.FarmName=C2 문자 입력. 농장ID 필수 웹 계약과 native 이름 저장의 차이 수정 필요; 임의 Farm 행 생성/가짜ID 금지. 실패 원문 supplier는 저장초안 없어 미확인. 로그 상세누락은 InvoiceUploadIssues가 error를 Boolean으로만 이벤트화하고 detail을 안보내는 코드 확인. 운영DB쓰기0.
검색어: 45-1 중국 NN009 NN007 HUBFRESH Farm없음 WarehouseMaster FarmName 로그 detail NULL

2026-11-03 기존입고 농장 연결 로컬 구현: invoiceFarmSource 후보 Farm+활성 WarehouseMaster 이름/PK, auto-fill GET/POST와 UI 연결. historical FarmKey=null 유지, writer preview/locked 재검증으로 실제 PK·농장명 대조, 기존 중복입고 검사 유지. null FarmKey 문서의 공급자 이름 business hash/기등록 이름변경 방지 추가. UPLOAD_FAILED에 bounded/redacted detail 기록. dnSpy 실제 EXE FarmName=excelTable.Rows[1][2] 재확인. 핵심49 PASS, 최종 Farm/로그/워크벤치24 PASS. Docker inspect 무응답으로 해당 테스트 docker PID만 종료; 격리SQL/Aside 실제45-1 입고/전체gate/배포 미완료. 총금액 원문캡처 확인 및 등록건 새창 연결 미구현. 운영DB쓰기0. 로컬 코드 아직 배포 금지.
검색어: historical farm invoiceFarmSource FarmKey null HUBFRESH 45-1 error detail SQL Aside 미검증

2026-11-03 45-1 중국 실파일 후속검증: Docker socket 디렉터리 이름변경 백업 후 복구(초기화/데이터삭제 없음). 운영 GET/SELECT로 원본·캐시·품목만 복사, loopback14339 격리DB로 Aside 실제 업로드/미매칭1건 선택/총액확인/입고등록/새창조회 2회 성공. 54행 180박스 1905단 21900송이, 상품39720+부대비37375=총액77095CNY. 부대비 상품중복등록 없음. 최신 실행은 원본 같은 송장 HUBFRESH 헤더로 Cloudland 오인식 정정 및 기존입고 농장 자동선택 확인. 입고날짜와 GW1684.8은 원문보고 수동입력, CW 공란이며 자동입력 성공으로 간주하지 않음. PDF2페이지 총액 표시·확인버튼·로그·WarehouseKey91001 새창 상세합계39720 확인. 격리 주문/출고 sentinel 보존. SQL 전체fixture PASS, dnSpy/manifest182/writeguard/build PASS. 최종 ERP 전체gate 진행중, 배포 아직 안함. 운영DB쓰기0·추가유료AI0. 계획 docs/plans/invoice-full-route-2026-11-03.md.
검색어: CN45 Aside E2E HUBFRESH 77095 39720 37375 180박스 FarmName 총액확인 새창 원본2페이지 Docker복구
2026-11-03 후속 상태 정정: 직전 공식관세 작업은 PR1426/merge d0651146b47ce22d28a031b4248e3e31901bfe4f, CI41559970111 및 Cafe24배포41560482584 성공. ping200/dbConnected=true, 운영읽기전용smoke41561388031·41561410862 성공(부모세션증거). DB migration false, SQL repair/recalculation 없음. 위 PR대기는 당시 중간 기록이다.
검색어: 공식관세1426 d0651146 배포41560482584 smoke완료 DB쓰기0

2026-11-03 전체차수 조회 후속 진행: nw-profit-all-weeks-load/codex/profit-all-weeks-load, DB절대쓰기금지. SQL등록01~50/저장01~43/활성보고서확정키0. 저장감사12SELECT, live재실행5233SELECT 모두쓰기0(최초4748는환율읽기분기차단으로불완전). 44진행/45~50미래분리. K공란328중무활동180제외. 재고보류122측면=평균식H의존42+비지원80, 후자원본재고값없음28. 원문국가혼재와웹CHINA재분류로통화충돌,운임총액일치여도품목분모불완전보류. 관세정책누락702행/고유216품목. 숫자03지원·진단보완diff독립검토중이며 수기1/2합계와03중복위험가드검토필요. 변경후1차 E/F/G/H/R/I/J/K변동0. 실제근거부족을0으로채우지않음. 정본 docs/work-sessions/2026-11-03_profit-all-weeks-load.md 및 work-reports 변경전1426진단행CSV. 이번전체gate/PR/배포미완료.
검색어: profit-all-weeks-load 전체50차 5233SELECT 미확정1426진단행 no_inbound CURRENCY_MISMATCH 03중복관세

2026-11-03 전체차수 로컬gate후속: verify:erp-change exit0, Next134페이지/50초compile,별도dnSpy/origin-master쓰기guard PASS(부모증거).03양수합계범위중복가드반영core독립승인.최종저장본목록1302진단행/재고155품목행(31EC정상분모0제외),관세미연결705행/217품목.숫자변동0,DB쓰기0.44최종조회수신및PR/배포/운영스모크대기.정본과final.md/CSV참조.
검색어: profit-all-weeks-load gatePASS 134페이지 1302 217품목 localverified 배포대기

2026-11-03 44차최종검증: v3 raw포함SELECT1291/쓰기0,전후C/E/F/G/H/I/J/K변동0.중국33입고행/32고유품목관세미연결·legacy비용분리부족등59진단행CSV별도생성.산출완료후상주핸들로자연exit0아님/해당probePID만종료.45~50는수정전조회성공,배포후브라우저검증대기.로컬gate/core독립승인완료,커밋/PR/배포는아직미완료.
검색어: 44최종 v3 1291SELECT 59진단 중국33행32품목 금액변동0

2026-11-03 운영출력대사후속: PR1429/CI41566371024성공,merge4ffcdccf410d56dabdbe63c36bab9ae6cb76bc6a,Cafe24배포41567162600성공/ping200·DB연결/CODE_ONLY_DEPLOY·DBmigrationfalse.운영41567880503(26~31)/41567888169(38~43)/41567904134(01/09/18/50)성공.41567895590은44/45성공후46수국E대사실패,47~49해당run미실행(별도진행).새nw-profit-live-output-consistency에서smoke의confirmed전용재계산분기를실제웹profitDisplayCalculation과통일,1e-8/assert유지·금액차이/원천basis/응답시각진단추가.금융API·웹계산변경0/DB쓰기0.표적·manifest·쓰기guard·dnSpy PASS전달및독립승인.46직접원인미확정,새진단운영run대기.정본 docs/work-sessions/2026-11-03_profit-live-output-consistency.md.
검색어: profit-live-output-consistency 46수국E smoke공통표시 epsilon1e-8 PR1429 배포성공 직접원인미확정

2026-11-03 추가운영검증: 별도run41568834599는47·48PASS후49콜롬비아루스커스E불일치로실패.46과49의실제차이금액은아직없어새진단로그필요.전체운영완료아님.
검색어: 49루스커스E 41568834599 47·48PASS 진단금액대기

2026-11-03 원천연결보완: 중국exact71추가(동일형태32+공식장미문언39), 총162정책. 실제0/수기/실납부우선·E1조건보존·신규AWB직접증거복제금지.01~43메모리재검산추가SQL0:미연결705→443입고행/217→146품목;38중국H3705660.52/F3945448.56,39중국E3945448.56만복구.수익률전체해결아님.18공식환율조회가능하나legacyFIFO원천FX/평균불가/19연쇄미확인으로제외.표시는중립계산기준/제목보고서,상세미확정유지.독립diff검토blocker없음(계약표현정정요청),전체gate진행중/PR배포미완.정본docs/work-sessions/2026-11-03_profit-source-completion.md 및work-reports동명final/remaining.csv1092진단행.
검색어: profit-source-completion exact71 162정책 146품목 38중국 39중국 3셀복구 18환율FIFO 계산기준 DB쓰기0 gate대기

2026-11-03 원천연결최종로컬gate: verify:erp-change session30084 exit0,webpack60초/134페이지.별도dnSpy exit0,origin/master manifest183PASS·쓰기guard exit0(변경API0),운영smoke nodecheck/mock PASS. 독립정책/표시/옵트인DOM검증 승인.정책연결파생3셀복구와표시금액불변을계약/계획/최종보고서에분리정정.운영옵트인클릭검증은basisLinks>0/detailsOpenedtrue로그필요.커밋/PR/배포/운영스모크아직대기.
검색어: profit-source-completion gatePASS 183manifest 134pages source_completion_checks 배포대기

2026-11-03 평균 대체 및 원본 관세 조사: 누락 평균가 허용 후 최신 요청에 따라 중국·태국 도착원가 Excel 원본 대조를 우선했다. 중국 장미21.4/유칼립투스8/일부Preserved25%, 태국 확인품목5% 실제 셀 확인. 중국27-2 비짜루·PreservedBlue 원본21.4 예외 및21-2 K30→J31 참조 오류 보존. CO는 원산지증명서이며3.2%는 검사 원본 셀에서 미확인(콜롬비아와 무관). 정확 태국36 ARAN Azima 원본5%는638 연결후보. 기존25%와39차형태추론8% 정책우선순위 충돌은 미수정 조사결과다. 국가 전체 평균 확대는 미승인. 평균 설계·계약 초안만 작성했고 금융코드/정책/원본Excel/DB 변경0, 신규PR·배포0. 정본 docs/work-sessions/2026-11-03_profit-average-and-duty-source-review.md 및 docs/work-reports/2026-11-03_china-thailand-original-duty-cells.md.
검색어: average-fallback 원본관세 중국21.4 소재8 Preserved25 태국5 CO원산지증명3.2미확인 27-2예외 21-2행참조 정책우선순위 국가평균미승인 DB쓰기0

2026-11-03 원본 관세 적용 승인 후: 조사 단계와 달리 사용자가 웹 적용을 승인했다. codex/profit-workbook-duty-apply 기준961bad438 보존. exact상품213/직접세부차수1087,실제납부·명시0·수기우선,원본예외17/27/28/32보존,K30오참조제외.원본후보1238행/214키는runtime규칙수와별개다.재생01~43 신규SQL0/DB쓰기0,미연결443→371입고진단행/146→128품목.태국34~38 K5행복구,중국27−0.359%p/28−0.102%p(관세/이월).매출있는520행중K389/보류131,0매출192(완전무활동180)완료집계제외.39태국JamesStory/Sonia/Sunrise·CO3.2·18환율/원가/단위잔여보존.독립core승인·표적5PASS,v4및구파생재적용차단.전체gate진행/PR배포대기. 정본 docs/work-sessions/2026-11-03_profit-workbook-duty-apply.md 및 work-reports/workbook-duty-apply-final/remaining.
검색어: workbook-duty-apply 213상품 1087차수 128품목 태국34~38복구 39태국3품목 27관세28이월 131보류 v4 DB쓰기0 배포대기

2026-11-03 후속승인: 사용자가 수익률보류금지 후 국가평균 및 유사품목 단/송이환산을 명시승인했다. 이전 '국가평균미승인'은이후승인으로대체. 기존실제/명시0/수기보존·결손만보완,샘플가능성은추측일뿐확정표기금지.131행 rawK59/원본K도없음72(재고E/F50,H만8,G/R13,G/H/R1).raw59무조건복원금지(중국시네신스101906원/단+2025live출처등검증필요).이전연도읽기허용하되평가시점이하 OrderYear+fullWeek,미래/재귀fallback donor금지.원본category_average255는AU/US0·NL최초16/TH27/EC15/CN16으로재사용만으로전부해결불가.국가평균/유사환산보완구현진행,관세코드보존·배포잠시보류. 독립설계 docs/plans/profit-no-hold-average-independent-2026-11-03.md.
검색어: 국가평균승인 유사품목환산승인 raw59 공란72 131보류해소 평가시점이하 이전연도읽기 미래donor금지 DB쓰기0 배포보류

2026-11-03 관세단계gate PASS:verify:erp-change2479 exit0,별도dnSpy PASS,origin/master manifest185/writeguard변경API0 PASS. 후속국가평균·유사환산진행으로배포보류.2025독립원천지도조사:추가SELECT2성공+구문오류1정정/쓰기0. ArrivalCostLine·CustomsWeekly·ProfitReport≤2025 및FreightCost2025헤더0.그러나2025입고운임상품205행/169AWB그룹과호주연초5품목exact매입이있으므로과거원가전혀없음단정금지.2025당시FX/통관·호주운임포함여부는별도부족.정본 docs/work-reports/2026-11-03_average-2025-source-map.md.2026전체구현차단으로확대하지않는다.
검색어: 관세gatePASS185 2025도착원가 원입고운임205 호주기초5품목 과거환율통관부족 국가평균진행 DB쓰기0

2026-11-03 평균기간정책추가: 국가평균·공란보완승인에맞춰historical donor(이전연도포함평가시점이하)우선,없을때같은국가완전원도착원가의후대참고평균 country_reference_period 허용을주담당이사용자에게안내.후대자료를당시실매입으로인증하지않고sourcePeriods/참조시작끝/평가시점보존.과거근거있으면후대로교체금지,대체결과재귀/다른국가혼합/판매단가/실제0·수기덮기금지유지.초기설계동일연도/미래절대금지는최신독립설계의두경로정책으로대체.
검색어: country_reference_period 과거우선 후대국가참고평균 자료기간명시 실제매입인증아님 DB쓰기0

2026-11-03 국가평균 최신 독립검산: 저장01~43차712행/매출비0인520행중K514. 관세후기준선대비공란125회복·기존율86변경·303동일,미분류6잔존. 미분류는ProdKeyNULL입고16행Q합계일치이며송장통화미확인. NZ01/JP01·02 Hmissing0 및 CO양수partial11은완전비용인증아님. 실제런타임SELECT3/쓰기0,cold14.373초/warm0ms;43최신원본별도1292SELECT/쓰기0,중국재고147→210단StockKey297파생메타반영. canonicalStockKey/혼합단위/실제Q/S보존/중복donor차단보완. 우선순위는품목past→품목reference→품종past→품종reference→국가past→국가reference. 전체gate·배포·운영스모크대기. 정본 docs/work-reports/2026-11-03_average-fallback-final-review.md 및 docs/work-sessions/2026-11-03_profit-average-fallback-final.md.
검색어: 평균보완514 공란125회복 기존율86변경 미분류6 NULL입고16 partialH11 43중국210단 DB쓰기0 배포대기

2026-11-03 평균보완 코드동결 독립검토: 현재발견P1없음,전체gate·운영스모크조건부승인. 평균상세UI페이지연결/80품목성분환산기간/실납부미인증/원본메타분리확인. 최종재생F→E재사용75쌍불일치0,보완행양수매출100%초과또는−50%미만0. 이전prototype극단값은최종값아님. 원천불변fingerprint재사용629ms는주담당측정이며운영성능인증아님. 전체gate·배포대기유지.
검색어: 독립P1없음 조건부승인 E/F75쌍 극단값해소 상세UI80 gate배포대기

2026-11-03 운영후속정정:18차스모크41597970882 화면/Excel금액일치후rateEstimated false!==true실패. 전체스모크미완. 공식참고시점환율fallback의source/auto만갱신되고rateEstimated/rateDetail/auditcanonical메타누락이원인. base53eb9e4ca codex/profit-average-rate-evidence 메타전용보완진행,숫자불변·수기R보존·actualDeclarationDateVerifiedfalse·assert완화금지. 후속배포/재스모크성공전완료판정금지.
검색어: 운영18스모크41597970882 rateEstimated 메타회귀 숫자일치 전체미완 환율근거hotfix
2026-11-03 불량차감 후속 진행: nw-defect-support-1103. 사용자 최종정책: 같은연도 직전5차수 업체단가우선/없으면타업체최신동일품목단가, 전년도제외. 적용차수 업체분배없음 보류/후속차수대기 유지. ClassEstimate dnSpy CLI와 FormEstimateAdd ShipmentKey/ProdKey 독립저장 확인. 오류로그16519 견적10930중복; 현재10930 실제연결조회0건으로 업체확정미완. UI13px/핵심열/오류업체품목표시 수정중. 기본불량/원문보존 회귀PASS, 전체가드진행중, 배포미완. 검색어: 최근5차수 타업체단가 등록보류 10930

2026-11-03 후속검증: 독립 npm ci 후 verify:erp-change exit0, dnSpy/manifest/write guard PASS. 실제SQL CTE 업체5차수우선/타업체최신/6차수·전년도·현재차수제외 PASS. PR1433 CI41586734943 success, master25fc0530, Cafe24배포41587424121 success. 운영버전25fc0530 확인, UI최종검증진행. 검색어: 최근5차수 타업체단가 PR1433 25fc0530

2026-11-03 15:34등록중단: 수경원예1073(44차)/1080(43차)동일품목10단이 같은트랜잭션에서 모두사전검사통과후앞행견적10936생성→뒤행중복throw→전체rollback. 현재10936없음SELECT확인. typed duplicate만 쓰기전skip,기타오류rollback유지,preview전체선택묶음중복경고. 실제registerDeductions 모의3행 정상2/중복1/다른수량허용/중복행쓰기0 PASS. 검색어: sameTransactionDuplicates 1073 1080 10936

2026-11-03 문제 해결 창: nw-defect-resolution-1103. 단가/매칭/원문대조/중복한건선택 후 기존 register 실행. 정상 자동원천 단가 감사허용, source flags 보존. 실제SELECT1073=10943(사용자등록 추정),1080미등록으로 자동보정안함. 신규행동/다른연도·수량·단위/실제manual-cost 모의쓰기2건 회귀PASS. 전체검사/빌드/UI/배포 진행중.
검색어: defectResolution 문제해결창 manualCost 자동수집 원문대조
2026-11-03 15:34등록중단: 수경원예1073(44차)/1080(43차)동일품목10단이 같은트랜잭션에서 모두사전검사통과후앞행견적10936생성→뒤행중복throw→전체rollback. 현재10936없음SELECT확인. typed duplicate만 쓰기전skip,기타오류rollback유지,preview전체선택묶음중복경고. 실제registerDeductions 모의3행 정상2/중복1/다른수량허용/중복행쓰기0 PASS. 검색어: sameTransactionDuplicates 1073 1080 10936

2026-11-03 중국45-1 날짜/GW: 원문 HUBFRESH DMY 02/11/2026→2026-11-02, A.G.W.T. TOTAL1684.8kg 보완. Aside 실제 업로드/미매칭1선택/자동 날짜GW/총액77095확인/격리SQL입고91001/새창조회 PASS(54행180박스1905단21900송이39720CNY). CW미기재보존, 운영DB쓰기0/AI0. 빌드PASS, 전체gate진행·배포미완. 정본 docs/work-sessions/2026-11-03_cn45-header.md.
검색어: cn45-header 45-1 DMY GW1684.8 Aside 자동입력 격리91001

2026-11-03 문제 해결 창 검증: verify:erp-change exit0, 변경기준 f10c1057 manifest184PASS/쓰기guardPASS. 최신운영빌드 모의UI 단가/매칭/원문TXT/중복한건/최종ids/재조회실패잠금/Tab·ShiftTab·Enter·Escape초점복귀 PASS. 수경44실제SELECT10943=-10단한건, DB보정없음. PR1443 최신CI/배포대기.
검색어: defectResolution UI PASS 원문파일 키보드 10943

2026-11-03 주차별 평균원가 공식환율 메타 보완: 운영 smoke41597970882에서 18차 웹/엑셀 금액은 일치했으나 rateEstimated 누락으로 실패. 공식환율 적용 행의 rateEstimated/rateDetail(연도·차수·승인 일정·고시기간·실제신고일미인증)과 canonical 감사 issue를 메타만 복원한다. 파생 v1 재입력도 숫자 재계산 없이 복구, 기존 rateDetail 보존, 실제/수기/명시0 및 교차연도 보호. 표적22 PASS, 실제43보고서9행 메타수정·calc/totals 변경0·SQL호출0/쓰기0. 기존 production smoke assertion 완화 없음. manifest186/쓰기guard/dnSpy PASS, webpack build EXIT0(.verify/average-rate-metadata-build.log), 독립리뷰 P1없음. 운영 재배포·18차 재스모크는 아직 미검증.
검색어: average-rate-evidence 18차 rateEstimated rateDetail APPROVED_CUSTOMS_TIMING_ESTIMATE metadata-only

2026-11-03 주차별 매출 인쇄: 사용자 비고 보존·자동 상태문구 인쇄 제외·22열 기본·선택 한 차수 A4 가로 한 장·바로 인쇄 요청·컬럼 메뉴 viewport/키보드 보완. 독립 실제 Chromium PDF 1주1장/3주3장/긴 비고50줄1장 PASS, PDF 렌더 시각확인. 긴비고 fragmentation 결함 수정, 숫자/빈칸/0/음수/마지막 비고 보존. 금융 계산/API/DB 쓰기0. 브라우저 연결 비활성으로 headless 사용, 물리 프린터 미검증. 앱통합/전체gate/운영배포는 진행 중. 정본 docs/work-sessions/2026-11-03_profit-print-layout.md 및 docs/work-reports/2026-11-03_profit-print-layout-qa.md.
검색어: profit-print-layout A4 22열 비고 fragmentation 직접인쇄 viewport

2026-11-03 인쇄 후속 검증: .next-print-production 빌드 EXIT0, 실제 Chromium 모의 UI EXIT0. 직접 print1회/41차 한 차수/전체41시트/비연속27·31/18차502 재시도/2025격리/화면v4·출력v1 선택지속/빈선택·복사/390px fieldset·컬럼popup 경계/End·Escape 초점복귀 PASS, API쓰기0. 전체 verify14986 및 PR1447 CI41604410811 진행 중, 배포·운영 인쇄 미완. QA/세션 정본 최신화.
검색어: profit-print-layout production-build mockUI 390px PR1447 41604410811
2026-11-03 데스크톱 앱 1.3.11 작업: 1.3.2 사용자 화면에서 로그아웃·오늘의 내 업무가 보이지 않는 문제 확인. 네이티브 홈에 로그아웃/계정 변경, 서버 세션 해제 후 탭·저장 구성 정리·로그인 진입 추가. 오늘 업무 '보관'을 복구 가능한 '삭제'로 표시하고 수정·삭제·보관함·계정 전환 Electron smoke 보강. 탭 닫기 기본 선택은 최신 코드에서 이미 닫기이며 smoke 확인. 데스크톱 AI 도구/버튼별 사람용 작업 원장 설계 docs/plans/desktop-ai-action-ledger-2026-11-03.md 작성; 신규 API는 미구현. desktop 단위28·smoke·restore·updater PASS, 전체 ERP 계약/웹빌드·PR/릴리스·운영 설치 스모크 진행 중으로 미검증.
검색어: desktop 1.3.11 로그아웃 계정변경 오늘업무 수정 삭제 탭닫기 기본 닫기 AI MCP 작업원장 actionId operationId

2026-11-03 공동 AWB 원가 작업: nw-shared-awb-1103/base84f37724. 43-1/44-1 레퍼런스상 공동 전체 운임을 품종중량/부피·송이수 배분하므로 농장별 CW 미기재로 차단한 판단 정정. 13농장 버전/연도/AWB/통화/실입고 검증 코어·읽기전용 API·미승인 엑셀/UI 구현. 그룹75/API3/원가34 및 기존export35 PASS, webpack PASS 후 후속 서버검증 추가. Aside 실제13농장 입고→최종다운로드/다른국가/최종전체gate/배포는 진행 중 미검증. 운영DB쓰기0. 정본 docs/work-sessions/2026-11-03_shared-awb-cost.md.
검색어: 공동AWB 콜롬비아45-1 13농장 3483 4307 12777.65 FB환산 미승인계산본

2026-11-03 공동AWB 실제 Aside 후속: 13농장 격리입고91001~91013, 37행663박스20010송이/상품13452.20USD. BOX입고/STEM단가·단수null 환산차단 수정(입고불변). 원가운임12777.65USD, 시험FX1400/통관1000=총36722790원. 실제엑셀다운로드3시트1050수식/37행차이1전미만, 오류셀0. 전체ERP계약EXIT0·신규8PASS, 격리종료보호주문출고불변. 최종build진행/다른국가전체E2E·배포미완. 상세 docs/work-sessions/2026-11-03_shared-awb-cost.md.
검색어: shared-awb Aside 13농장 37행 BOX STEM 663 20010 36722790 운영DB변경없음
2026-11-03 공동AWB 최종 webpack EXIT0, manifest187/쓰기guard1/diff-check PASS. 다운로드 최종 (1).xlsx 13농장37행 수량/원가/수식대조 assertion PASS. 다른 국가 전체/배포는 아직 미완.
검색어: shared-awb final build PASS 다운로드 16017338005

2026-11-04 국가별 부속표 후속: 원본11개 hash 재확인. 일부 국가 통관 상세를 합계/내역미보유로 바꾸는 exporter 확인. NL 전체 검역종류 표/FOB×환율 수식 연결·짧은시트 범위 확장. 사용자 확인: Ornithogalum/Cordyline 각10송이는 Nerine/Leucothoe와 별도 종류로 추가. 관련검사 실패0. Aside 격리19431 자동 GW/CW/환율 연결, 다운로드 재시도중. 전체국가/Excel 실제재계산/배포 미검증. 운영DB쓰기0. 정본 docs/plans/cost-auxiliary-tables-2026-11-04.md.
검색어: cost-auxiliary 1104 Ornithogalum Cordyline 별도종류 검역차감 FOB 환율 부속표 배포미완

2026-11-04 후속: Aside NL43-02 71품목 실제 다운로드 완료, 검역수식21행/통관표/판매총액29836746.07·총이익4565022.15 캐시 확인. 실제Excel재계산/글씨겹침 미검증, 고객비교는합성fixture로실제검증아님. 6프로필 통관 원본 기준표 복원(기존적용합계보존/차이표시),56PASS9SKIP. 중국해상·태국 부속표 및 국가별Aside/배포미완. 운영DB쓰기0.
검색어: cost-auxiliary NL Aside 다운로드 customsReferenceCells 6프로필 판매합계 미배포

2026-11-04 태국 원본 후속: 사용자 요청으로 기존 TH40 및 36~39/23/27~29 시트 역추적. 검역 P6=샘플송이×수동원화단가 합, N10=기본비+P6+P7(차감 아님). 40차 285500+44678.8868042371=330178.8868042371. 단가는 수식없는 과거값/상수나눗셈이고 최저FOB 자동선정 근거 없음. TH 부속표는 과거 참고단가 명시, AB5실제적용값 보존. CN SEA11개 통관항목/합계 복원. 관련129개111PASS18SKIP, manifest187/쓰기guardPASS/diffPASS. artifact 재계산 입력변경 TH/CNSEA/NL 정상, 오류검색0; TH 캡션 클리핑 병합 보완 후 시각확인. Aside NL43-02 실제 다운로드 `(1).xlsx` TEST_ONLY 확인용(합성CL2), 통관823157.95→시험수수료변경791157.95 재계산; 운영DB쓰기0. 전 국가Aside/Excel네이티브재계산/최종build/배포는 미완. 현재격리서버55172/38004, Aside64694는 이 세션 소유.
검색어: TH 원본 검역 가산 P6 N10 44678.8868042371 과거수동단가 CNSEA 6510302 Aside NL TEST_ONLY 미배포

2026-11-04 미완료 작업 재개: origin/master dda84a65 fetch, 원가 주요4파일과 현재base간 원격겹침 없음. 전체 ERP 계약 재실행 session88928/outputs/aux-final-contract.log, packing-team 구간까지 실패보고 없음이나 아직 종료미확인. Computer Use로 기존 원가 Excel창75574598 확인했으나 응답없음 지속(사용자 업무문서도열림), 강제종료/저장/수정하지 않음. 실제 Excel 재계산·남은국가 Aside·최종빌드·배포 미완. 운영 DB쓰기0.
검색어: 미완료 1104 Excel 응답없음 75574598 aux-final-contract 88928 dda84a65 배포대기

2026-11-04 재개 후: 앞선 전체ERP 7실패는 복원 전 통관합계/내역미보유를 기대한 구 assertion이었다. 실제 원본 중량요율/검역비/적용AB5불변 검사로 정정. 실제 Excel에서 TH L9 박스비율이 원화로 보이는 추가결함 발견, 원본스타일 불변+퍼센트 복제서식 적용. 표적64중55PASS/9선택SKIP/0FAIL, 11프로필 시험파일 재생성44중35PASS/9SKIP. Excel에서 TH L7:L9=4%/1%/95%, 참고검역44678.89/참고합계209438.89 표시 확인(합성시험자료, 실제 원가 인증 아님). 판매가 R14 제목 잘림은 추가 미완. Aside19431 NL43-02 실제 버튼 다운로드 Downloads/도착원가_계산본_2026_43-02_7814 (2).xlsx 성공(TEST_ONLY/합성CL2). manifest187/writeguard1/dnSpy PASS. 전체ERP 재실행70364 outputs/aux-contract-retry.log 아직 진행, 최종빌드/전국가Aside/배포 미완. 운영DB쓰기0.
검색어: TH L9 95퍼센트 numberFormat9 Excel 실화면 aux-percent-regression Aside NL 다운로드2 판매헤더잘림 미배포

2026-11-04 검증 요청 결과: 전체ERP aux-contract-retry session70364 EXIT0 확인. 11프로필 파일 artifact 재계산/오류검색0/원파일SHA불변. 10프로필 판매·이익·총액 행합계 일치, CNSEA는 시험자료CBM누락으로 입력필요 유지(정상완료아님). VN은 headerRow12를 사용해 합계11행 검사, 첫 진단스크립트의17행 조회오류 정정(제품코드문제아님). Aside19431 실제 NL 다운로드(3).xlsx/71행 총판매29825523.632578906 총이익4563305.115784571 행합계 일치. TH/CNSEA/NL 부속표 입력변경 재계산PASS, 결과xlsx 저장안함. TH R14 XML에 wrapText없음 확인: artifact렌더는 정상이나 실제Excel잘림 기존증거 유효, 아직 미수정. 전체국가Aside/Excel네이티브완료·최종build·배포미완. 운영DB쓰기0. 검증용 스크립트만 outputs에 추가, 업무코드변경 없음.
검색어: 검증1104 전체ERP EXIT0 11프로필 10합계일치 CNSEA CBM누락 TH R14 wrapText없음 NL다운로드3 71행 운영DB0
# 2026-11-04 CBM·태국 제목 후속 (진행 중)
- 원본 중국해상 41-1 SHA 검증 후 품목→박스규격/CBM 96개 추출. 동일 이름+박스당 단수만 파일 계산 기본값, 직접입력/승인값/운영DB 보존. 근거 AD열 표시.
- 태국 R14/S14 wrapText 누락 수정; 실제 Excel 두 줄 정상 확인. 글씨체/색/너비 보존.
- 관련61검사52 PASS/9 SKIP/0 FAIL. 11개 시험양식 재계산 오류0, 총판매/총이익 행합계 일치, 파일 SHA 불변. outputs/cost-cbm-wrap-1104. 테스트 자료이며 실제 국가별 E2E와 구분.
- manifest187/dnSpy/write guard PASS. 전체계약 session63002, webpack 별도 dist session42130 진행중. 나머지국가 Aside 실다운로드·CI·배포 미완.
- 검색어: 중국해상 CBM 96품목 원본포장 일치 TH wrapText R14 S14 cost-cbm-wrap-1104
- 후속: webpack .next-cbm-verify EXIT0; 원본CBM/통관10검사 PASS. Aside NL 실제 다운로드 (4).xlsx 확인. 전체ERP63002 진행중, 다른국가 Aside/CI/배포 미완 유지.

2026-11-04 국가별 Aside 다운로드 완료: 격리19441 실제 웹의 승인 원가 다운로드 버튼으로 11프로필 각각 다운로드. CO구형/42-1, TH, US, VN, AU, NZ, EC, CN항공/해상, NL. 3행 합성 TEST_ONLY 승인 스냅샷이며 실제 인보이스 전구간 정확도 검증 아님. 모든 API 비GET 차단/운영DB연결 없음. Downloads/*_ASIDE_TEST_ONLY.xlsx를 그대로 복사하여 artifact 재계산: 11개 오류0·판매/이익 행합계 일치·원파일SHA불변. 판매영역 렌더11개 글씨겹침 없음, TH native Excel 두줄 검증은 앞선 결과. 전체ERP63002 EXIT0 확인. CI/배포는 후속 진행중.
검색어: Aside 11프로필 실제다운로드 TEST_ONLY aside-download-1104 재계산 오류0 운영DB0
2026-11-03 업체별 불량목록: 영업 입력/영업지원 검색·업체버튼·행별 입력출처 표시. 선택업체 전체선택/문제해결 범위 일치, 원sourceIndex 보존. SQL/권한/원장쓰기 변경없음. 계획 docs/plans/defect-company-filter-2026-11-03.md. 단위회귀통과, 전체검증/배포 진행중.
검색어: defectCompanyFilter 업체버튼 입력출처 직접입력 자동수집
2026-11-03 AI 작업 원장 1단계: 개인 업무 조회/추가/수정/삭제/복구 5개 capability, 미리보기→명시확인→기존 개인업무 저장→재조회 검증 API와 계정별 작업 상태 원장 구현. /work/operations에 처리/확인 결과와 본인 버튼·API 활동 기록 표시. 기존 개인업무 revision/requestId 및 결정적 taskId로 중복 재시도 보호. 표적·기존 개인업무·활동 테스트 PASS, 웹 build PASS, ERP 가드 진행 중, PR/배포/운영스모크 미검증. ERP 원장 쓰기 도구 미등록.
검색어: AI 작업원장 operationId capabilities preview confirm personal-home 버튼로그 내작업기록 재조회검증

2026-11-03 차수별 출력·가로 비고: 완료된 연도/from/to 범위에 출력 연결, 부분실패·stale·dirty·입력범위변경 출력차단 독립검토 P1없음. 인쇄 userNote만 줄trim/가운데점 연결, 원문/Excel/금융값보존. 실제Chromium PDF1주1장/3주3장/22열/문라이트1~50가로흐름·마지막50·workbook불변 PASS, 실제PDF PNG확인. 운영weeks_view옵트인추가(연속1/3주,기본false), 모든변경요청abort. 앱통합/전체gate/배포운영은 진행 중. 정본 docs/work-sessions/2026-11-03_profit-weeks-output.md.
검색어: profit-weeks-output 차수별출력 가로비고 문라이트 범위완료 stale dirty

2026-11-03 차수별 출력 후속: production build EXIT0, 실제Chrome mockUI PASS(27~29기본3→27/29선택2,2025격리,28부분실패차단,늦은응답·범위변경차단,미저장비고차단,직접print총3,가로비고,390pxbounds,API쓰기0/pageerror0). 첫시험입력실패는tripleclick→Ctrl+A테스트만정정. 실제FormStockView dnSpy재확인EXIT0,앱freeze,PR1453 CI/전체verify28427 진행·운영미완. QA/세션정본갱신.
검색어: weeks-output mockUI PR1453 partial stale dirty 390px

2026-11-03 차수별 제목 후속완료: production build34802/ChromeUI61340 EXIT0. 2026 27~29→미조회→2025 27~29→부분실패미조회→2025 27~30·category원제목복귀 exactPASS. 기존3/2주선택·dirty·late·부분실패·print·가로비고·390px·API쓰기0 재검증PASS. PR1453head4be68df3e CI41610146868 및전체verify28427 진행,배포운영대기. 문서최종로컬append만,커밋없음.
검색어: weeks-title header 2025 27~30 61340 41610146868
2026-11-03 불량 업체필터 검증: verify:erp-change exit0, manifest186/dnSpy PASS, 모의UI 두탭 필터·출처·선택·원인덱스·검토창ids·키보드 PASS. 기능PR1449=90820b27, CI41608005201 성공. UI모의 빈창/location 이동 및 preflight 조회POST 구분 수정.
검색어: defect-company-filter-smoke 업체필터 UI검증 90820b27
2026-11-03 입고 재업로드 수정 조사: 최신 origin/master 6428f624e 및 실제 dnSpy 3타입, 운영 SP/View SELECT 확인. 현재 웹/EXE 업로드는 신규 추가이며 교체 불가. EXE A→B 수정 원래 품목 재계산 누락, 웹 삭제 Product.Stock 차감 부재 확인. 선택 WarehouseKey 기준 원자적 교체·양쪽품목 재고·원가연결 검증 필요. 구현/운영쓰기/배포 없음, 실제 수정 및 downstream 전후 미검증. 정본 docs/work-reports/2026-11-03-incoming-reupload-review.md.
검색어: 입고 재업로드 농장 품목 수정 WarehouseKey FormWarehouseAdd Product.Stock 교체업로드

2026-11-03 입고 수정 구현: /incoming 선택 원장의 FARM/REPLACE 미리보기·명시확인·UUID재시도·초안·감사 추가. 공용 staging 없이 차액 Product.Stock/입고이력/native V2 재고·후속음수 검증과 원장 사후대조 원자 저장. 원가/정산/확정/농장분배/미매칭 원장 차단. Unit10·격리SQL1·모의UI1920/390·기존입고3·UI-layout·manifest187·dnSpy·쓰기guard PASS. 운영7970 읽기전용 preflight 성공/확정 차단, 운영쓰기0. 전체ERP/최종build·PR/배포 진행중. 정본 docs/work-sessions/2026-11-03_incoming-correction.md.
검색어: warehouseCorrection 입고수정 파일교체 FARM REPLACE nativeGate UUID SystemActionLog

2026-11-04 불량단가·보류: nw-defect-cost-quote-1104, 기준b6e77b84. 태림983/986 품목3389/2473에최근단가없음,실분배후보3397=6200(41-01),2085=6500(43-01). 라움926/1007 기존견적10499/10707 실체없음. 사용자답변은 보류분별도분리,재등록아님. 단가후보/명시매칭정정/보류분리 구현,실SQL SELECT 및 CTE PASS/운영쓰기0. 전체검증·UI·배포 진행중.
검색어: defectCostCandidates COST_LOOKUP_FAILED 보류 이전차감견적 태림그로우 오션송 라움

2026-11-04 검증 갱신: 운영용 빌드 성공. API격리 UI에서 보류목록 분리, 업체/차수/단가 표시, 명시 매칭 preview/save만 전송, 수량80 및 유령견적10499 보존 PASS. 기존 문제해결창 단가·매칭·원문·중복선택·재조회실패잠금 회귀PASS. 실제SQL 후보조회는 그로우3397/오션송2085만 관련 후보로 노출(무관한 인기품목 제외). PR1463 전체검사/배포 진행중.
검색어: defect-cost-held-smoke defect-resolution-smoke PR1463 운영쓰기0

2026-11-04 보류 원차수 표시: nw-defect-held-week-1104 기준2f191418. 보류 첫 열을 불량 차수로 변경, 원장 orderYear/orderWeek 굵은 배지 및 보조번호. 원차수42/적용44·전년도·하위차수·누락값 단위검사PASS. 표시만 변경/DB쓰기0. 전체gate/빌드/UI/배포 진행중.
검색어: defectSourcePeriodLabel 보류 불량차수 원차수 42차

2026-11-04 선택보류: nw-defect-manual-hold-1104 기준068465f1. SUPPORT_HOLD/RESUME 웹이력만, 원장잠금+원연도차수/rowversion/최신보류키 CAS, sourceReview공통 등록차단. 단가/충돌 체크·혼합선택등록차단·수동보류해제·중복견적번호표시 구현. 단위/기존불량/실SQL CTE/실원장SELECT PASS, 운영쓰기0. UI/전체CI/배포 진행중.
검색어: SUPPORT_HOLD SUPPORT_RESUME manualHeld 선택보류 견적충돌
2026-11-04 개인 업무 반복·데스크톱 메모장: GPT 생성 시안 `docs/design/desktop-task-notes-2026-11-04.png` 기준 세로형 고정 창 구현. 없음/매일/매주/매월 및 월말·윤년 보정, 홈 수정·메모장 추가/제목수정/완료/보관/클립보드 복사/계정별 알림·고정/Windows 실행 바로가기. 네트워크 직접 접근 없는 IPC, 계정 잠금 시 창 종료. 개인 JSON만 변경, ERP 원장 쓰기 없음. 월말·계정/IPC Electron smoke·패키지 포함·계약/manifest/dnSpy/쓰기 가드 PASS. 전체 ERP·웹 빌드/PR/배포/실설치 검증은 진행 중.
검색어: desktop notes 1.3.12 월말반복 메모장 맨위고정 알림 바로가기 GPT시안

2026-11-04 선택보류 UI검증: 로컬 운영빌드 성공(메모리 절약 worker1), API격리 실Chrome에서 이슈체크/혼합등록차단/보류이동/새로고침유지/수동해제/CAS descriptor·수량·기존견적보존 PASS. 초기 dev instrumentation crypto 오류로 운영빌드로 전환. PR1469의 WORK_MEMORY 병합충돌은 양쪽 기록 모두 보존해 해소. 전체CI/운영배포 대기.
검색어: PR1469 defect-manual-hold-smoke UI PASS
2026-11-04 메모장 새 디자인: GPT 이미지생성 시안 `docs/design/desktop-task-notes-v2-2026-11-04.png` 기준 상단 브랜드·원형 진행률·카드형 업무·파란 빠른추가·알림 카드로 380px 창 재구성. 날짜·업무·반복·알림 데이터 경로 유지, 아이콘 버튼 접근성 이름 추가, 숨김 요일 필드 CSS 보정. Desktop 1.3.13 단위28·Electron smoke PASS, 시안 대비 380px screenshot 확인. Windows installer CI/PR/병합/배포/실설치는 진행 중.
검색어: desktop-notes-design-v2 1.3.13 GPT이미지 시안 원형진행률 카드형업무 380px

2026-11-04 실제 확정 주문 분석비교: PR1479, read-only53원문110그룹, 동일8건30그룹 A/B 최종 기존30/30 개선28/30+장미규격확인2/오선택0. 호출16→14, input192994→168230, 총86.470→73.619초. 자동률하락6.67%p 명시, 별도50/60cm오선택을확인필요전환. 헤더차/출고메모보완, readonly진단workflow. 전체ERP/dnSpy/manifest/쓰기guard/build/Chrome복원PASS, CI·운영배포계속진행. 상세 docs/reports/paste-confirmed-comparison-2026-11-04.md.
검색어: paste-confirmed-audit PR1479 28/30 장미규격확인 Claude14회

최종 API제외 보완 실측: 기존27/30 개선28/30+규격확인2/오선택0, 호출16→14, input193033→166937, 총86.078→74.342초, 중앙10.176→9.579초. 기존반복27~30변동 및 보호단계30→28 자동률하락도 보고서보존, 최종한번만골라 일반성능향상주장하지않음. 별도장미최종2→0호출/330ms/확인필요. 원장쓰기0.

2026-11-04 입고 정정 메뉴 연결: 승인업무3탭(수정요청/매칭·확정/처리이력) 기획. /incoming 입고정정업무 버튼→/import/tools?tab=incoming, 업무도구에 동일버튼·입고조회수정탭 추가. 기존 Incoming/correction 재사용, 선택번호·기간·필터·팝업 전달·탭선택 보존. 새승인엔진 미구현 사실 표시, API/SQL/원장쓰기 변경없음. 신규 URL 정책검사 PASS, 전체ERP/build/UI/배포 진행중. 정본 docs/work-sessions/2026-11-04_incoming-tabs.md.
검색어: 입고정정업무 incomingWorkspaceNavigation tab=incoming 수입부업무도구 승인3탭

2026-11-04 중국 자동물량표 단가 입력: inline 단가→CellsJson 작업저장/복원→preview/apply 공유 writer 연결. 중국 price 거부조건 제거, 단가 공란보존/0유효·공통정규화·인보이스 재적용보존. dnSpy 실제 FormShipmentDistribution/ClassShipmentDate, 운영 SELECT-only, 중국/네덜란드 격리SQL 저장재조회·rollback, 브라우저 Enter/저장재조회 PASS. 전체ERP/최종빌드·PR/운영배포 진행중. EXE GUI는 미검증, 운영시험쓰기 없음. 정본 docs/work-sessions/2026-11-04_china-price-input.md.
검색어: 중국물량표 단가입력 unitPrice normalizeVolumeUnitPrice 격리SQL 분배단가

중국 단가 후속 검증: 전체 test:erp-contract exit0, dnSpy/manifest/write/UI-layout PASS, worker1 webpack build PASS. 최신 master 입고정정 변경 FF 통합(업무파일 충돌없음). 운영 CUA 브라우저 연결은 Work 설정 disabled라 로그인 UI 직접확인 제한; PR/Cafe24 진행중.

2026-11-04 입고 정정 승인 구현: nw-incoming-approval-flow-1104, web_mgmt 전용 TargetKind 요청/매칭/최종확정 단일트랜잭션. 농장-only 보존, 감소/이동/독립추가, 양수 대체주문 명시연결, native 후속연도/견적매출 readback. Unit11 및 격리SQL 실제writer/권한CAS/2025보존2027cascade/native감사실패음수롤백 PASS. 모의Chrome1920/390 PASS, 전체ERP 및 첫build exit0. 원가연결/확정손익/농장배정 수량변경 지원제한, 최종build/CI/배포 미완. 운영쓰기0. 정본 docs/work-sessions/2026-11-04_incoming-approval-flow.md.
검색어: incomingApproval WAREHOUSE_CORRECTION_V1 수입부수정요청 영업지원매칭확정 원자반영

2026-11-04 웹 작업흐름 로그: 기존 전역 activity 보강. workflowId/requestId/순번·요청시도/응답·단절 미확인·허용 집계/감사키만 기록, 계정분리/위조배제 회귀 PASS. 실제 dnSpy 로그인/DBMSSQL/분배 저장 조사, 운영 EXE/원장 보존. EXE 별도 계측본+로컬저널 권장, 패치/격리 호환성 미검증. 전체 ERP/빌드/배포 진행중; 정본 docs/work-sessions/2026-11-04_web-audit-coverage.md.
검색어: workflowId requestId userActivity EXE 작업파이프라인 dnSpy 계측

웹 로그 추가발견: 운영 관리자 이력의 모호한 Descr와 없는 ShipmentHistory.ColumName 조회 오류 수정. 실제 dnSpy ShipmentDtm 표시+Master 거래처 조인 동일화, 실제 SELECT-only stock200/order160/shipment157 HTTP200. 원장쓰기0. 전체ERP/build/Chrome1920/800 PASS(PR1499 초기), 추가 readonly API 회귀 PASS 및 CI 재검증 진행.
검색어: adminActivityRead Ambiguous Descr ShipmentHistory ColumName ShipmentDtm

2026-11-05 입고 연결 정정 확장 진행: nw-incoming-linked-approval-guide-1104. 명시 입고 물리키/농장 최종배정, 인보이스·운송원가 새버전, 실제 손익 loader의 트랜잭션 계산/확정본 개정 구현. 격리SQL core+원가+농장80→70·검토롤백·후행감사실패 전체롤백 PASS, 손익 실제SQL41/44/2027·2025보존·확정본·캐시실패롤백 PASS. 운영쓰기0. 초기build PASS, 전체gate/영상/PR/배포 진행중(미완).
검색어: incomingApprovalCosts incomingApprovalProfit linked approval workflow guide 1920x1080

2026-11-04 기술레이더 1호 시험(docling vs 현재): 실서류 6건 로컬 비교 — Holex 3건은 기존 로컬파서 100%·9ms 우위 유지, docling은 행 96.7~100%·숫자 오독 0·스캔 OCR 23/24·한글 통관청구서 필드 9/9·$0·페이지당 ~15초(CPU). 결론=비-NL 서류 Claude 판독의 "전처리+산술 교차검증"으로 채택 제안(코드 적용은 승인 대기). MinerU는 CPU-only라 생략. 산출물 C:\Users\USER\nenova-pm\radar-pilot\REPORT.md, 레이더 pilotResult 업로드 200 ok(/pm/radar UI는 아직 pilotResult 미표기 — 표기 추가는 후속).
검색어: docling MinerU radar-pilot pilotResult 인보이스 패킹리스트 OCR importInvoiceLocal

2026-11-04 기술레이더 1호 채택(docling 전처리): 비-NL 패킹 PDF Claude 판독(parse-pdf)에 docling 후보표 주입. 서버(Cafe24)는 python 불가 → 파일 큐 브리지(data/runtime/import-team/docling) + owner PC 워커(radar-pilot venv, scripts/docling-bridge-worker.py) 폴링. 인증=ORBIT_DRIVE_INGEST_TOKEN 재사용, 새 DB 테이블 없음. PDF는 bbox/quote 증거 계약 때문에 유지하고 후보표를 시스템 프롬프트에 추가(산술 실패행만 재확인 지시). 산술검증은 유럽 소수점콤마(1,41)·표 과반 통과시만 플래그. 플래그 DOCLING_PREPROCESS=off 한 줄 차단, 캐시키 분리([docling-preprocess-v1]). 2주 비교 로그 metrics.jsonl + scripts/docling-metrics-report.mjs. 골든: 파일럿 6건 docling 출력으로 플래그율 Holex 1~3%·스캔 0 확인.
검색어: docling 전처리 후보표 parse-pdf docling-bridge ORBIT_DRIVE_INGEST_TOKEN DOCLING_PREPROCESS metrics.jsonl bridge_worker

## 2026-11-04 심야 — /pm 3D(베타) 밤샘 작업 3~7단계 (PR #1520)
검색어: pm3d KayKit 리그 캐릭터 교체, 표정 데칼 face webp, 탈것 mounts.glb 주행 ridePath, 로봇 칩 겹침 declutter, 맵 1.5배 둘레 보드워크, 스킬 발사체 fx.glb
- 3단계: 캐릭터를 KayKit Rig_Medium(CC0)로 교체 — `scripts/pm3d/build_char_kaykit.py`. 클레이 바디 리지드 바인딩, 재질 top/bottom/skin/hair·모자 hat_* 유지. 클립 idle/sit_type(타이핑 팔 베이크)/walk/doze/cheer/wave + Kevin Iglesias 춤 3종 리타게팅(dance·dance2·dance3, 원본 FBX 미커밋=재배포 금지). 함정: KayKit sit 클립은 180° 안 돌아 있음(돌리면 뒤통수). 얼굴이 "뒤돌아 보임"의 실제 원인=눈이 커진 머리 반지름 안에 묻힘.
- 4단계: 표정 12종 `public/pm3d/face/<id>.webp`(`build_faces.py`, PIL) + char.glb 얼굴 데칼(재질 'face', 타원면 투영) + Scene3D faceOf 연동. 2D 레이어 렌더는 미착수.
- 5단계: 칩 겹침 버그 = declutter 고정 추정폭(로봇 70px, 실제 170px). 실측 offsetWidth 로 교체, 회귀 테스트 추가.
- 6단계: PM3D.THEMES.layout 데이터화(I=mapScale 1.5·ring), `lib/pm3dRide.js` 주행 경로(책상 틈→복도→스테이션, 81경로 충돌 0 테스트), Scene3D ride/park/크루징(출근 직후·휴식 추첨)·동시 3명·reduced 정지. 탈것 15종 glb+스프라이트+썸네일 `build_mounts.py`. 2D .bg-mount 이모지→스프라이트.
- 7단계: 발사체 기본 9종 `fx.glb`+스프라이트 `build_fx.py`(소비자 연출은 후속).
- 미완: 스킬 24종 상점 썸네일, 2D 표정 레이어(pm-char 일괄 렌더), 탈것별 전용 탑승 클립(현재 idle/sit_type 대용), 목표달성 트리거 주행(3D에 이벤트 데이터 없음 — danceEvents 연결 필요).
- 재현 도구: pages/pm3d-preview.js(임시, 커밋 금지) + puppeteer-core 캡처. kit 재생성 시 build_assets.py 가 char.glb 안 덮음(--legacy-char 게이트).

2026-11-05 입고 연결 정정 추가검증: 실제 승인원가2000→2200/20단 재고액40000→44000 loader PASS, 기존평균기준보존·원가의존해시·요청별memo. farm-only총량보존재배분허용. 부족재고는native결과에따른발생기간별최소증분/명시fingerprint동의/같은tx재계산; 2027 01만5조정·2026보존·감사실패롤백 실SQL PASS. FormStockAdd dnSpy/CodeInfo SELECT-only 확인. 전체gate/영상/배포진행중.
검색어: incomingApprovalStockAdjustment chronological 부족재고 명시동의 sourceDependencies

2026-11-05 입고정정 최종검토: 기존 미확정분배 유지+입고감소 예약부족 누락 수정 및 실제SQL100→70/예약80/부족10 명시동의 PASS. 수입부164.1초·영업지원383.1초 실제1920×1080 한국어가이드 제작, 두 진입점 연결과 strict해시검사 PASS. 전체suite/공식빌드/배포 최종확인중, 운영쓰기0.
검색어: incoming-approval guide-video 미확정예약 부족10 fullHD 수입부 영업지원

2026-11-05 PR1550 정식검증: 공식npm build/영상strict/실제플레이어 데스크톱·모바일 PASS. Linux CI41978488811 전체ERP동작·dnSpy·manifest·writeguard PASS, 최종빌드/배포대기. 로컬suite는병합중package읽기중단으로전체PASS아님을명시. 최종상태는PR1550·세션기록참조.
검색어: PR1550 incoming linked approval guide-player 41978488811

2026-11-05 주차이익률·금융비고 구현: 표시K=J/C(C0/null공란), saved/confirmed금액·원본JSON불변. 콜롬비아 report-profile GW/CW배분·반대기준 운임 및재고유보 반영이익/%p 참고, 실제StockHistory 품목/물리단위증감과 근거평가액, 실제PeriodDay인접 저장본의 기말→기초 평가차이를 구분. 사용자비고·원장보존, DB쓰기0. 실제dnSpy/31-01중량1420/3342·저장3342/3342 SELECT확인. 대상검사PASS. 첫ERPgate는오래된 WorkbookParity 소스문자열assert1건중단→수정PASS; 잔여gate/공식build/브라우저 및 PR·배포진행중(미검증 단계 완료아님). 세션docs/work-sessions/2026-11-05_profit-margin-impact-notes.md.
검색어: profit-margin-impact-notes J/C Colombia GW CW CBM StockHistory 평균원가 조정평가액
## 2026-11-05 도착원가 시트 검토 업로드
- 원본보존/검토/선택시트명시국가/차수/연도확인,재검토다이제스트/DB멱등/읽기검증구현.53/54分離134행은55통합1892행중해당134행과원본셀·수량·원가일치/수동변경0.
- 관련회귀/dnSpy/manifest통과,실제UI합성dryrun통과.필수전체검사·영상·CI·배포·정리미검증(진행중).
- 검색어: 도착원가 시트검토 업로드 원본보존 Import53 Import54 134행 arrivalUploadReview

2026-11-05 후속 단순화 착수: 이전PR1550/d0106f3f의CI41979093709·배포41979671264·운영두메뉴/영상재생PASS 확인완료. 새요청은기존농장입고내품목+수량/수량만/추가/취소 직접입력, 영업지원문제만조정후확정. nw-incoming-simple-1105에서Sol하위1개로진행, 기존원자writer재사용. 현재후속배포미완료.
검색어: incoming-simple-workflow PR1550 문제중심검토 사용량절약 Sol
## 2026-11-05 도착원가 업로드 컨트롤 디자인
- 부모 styled-jsx가 새 자식컴포넌트에 전달되지 않아 기본HTML버튼으로 보였음. CSS Module로입력/파일선택/분석·재검토·저장·닫기버튼을공통ERP규격에연결.32px높이·13px글자·간격8px·분석파랑/저장초록/보조버튼·비활성회색/파랑포커스 적용.표간격/행구분/가로스크롤·좁은폭줄바꿈정리.
- 적용기준:MENU_DEVELOPMENT_DEFAULTS,globals.btn와hotelOrderButtons의공통컨트롤규격.업무정책/API/SQL/ERP쓰기변경없음.
- 기존실행회귀통과.실제Chrome1920/1280에서버튼높이/페이지폭/Tab·ShiftTab검증통과.가이드재촬영·정식build/CI/배포/운영확인진행중(미검증).
- 검색어: 도착원가 버튼 디자인 CSS Module ArrivalUploadReview 32px styled-jsx

## [2026-11-06] 꾸미기 버그 6건 일괄 수정 (#1580 코드, #1581 애셋)
검색어: 피팅룸 옷 투과, 블롭, layer.outfit, 홀드아웃, 탈것 시승, equip lap, 상점 색 보정, saturate, 잠금 안내, 한글 셀렉터 curl 깨짐
- 옷 투과 원인: layer.outfit.*(39장)가 "몸에서 옷 재질만 남긴" 렌더라 가림이 틀려 뒤돌아선 덩어리 — 전 세대 공통 불량(피팅룸 확대 때 드러남). 수정=입힌 상태+몸 홀드아웃 재렌더(#1581, char.* 30장 중립 베이스 포함). 액세서리 레이어는 원래 정상.
- "탈것 구매 안 됨"=서버 정상(실구매 검증: 임재용 flower-cart 40토큰). 화면이 문제: 잠긴 품목 클릭 침묵→안내 문구 추가, "타도 안 탐"=평소 park만→장착 변경 즉시 시승 1바퀴+작업중 1/17 추첨 주행(#1580).
- 상점 색=3D 캔버스만 saturate(1.24) 보정돼 있었음 → 상점 이미지에도 동일 CSS 필터.
- 함정 재확인: Git Bash curl 한글 POST/셀렉터 깨짐(브리지 page/click에 [data-k="한글"]은 Node fetch로). 브리지 배율 입력은 불가, 맞춤 버튼은 button[aria-label="화면 맞춤"]. 로컬 dev는 JWT_SECRET로 nenovaSS3 쿠키 발급하면 관리자 화면 재현 가능.

2026-11-06 중국 관세·재고 읽기계층 복구: exact124품목 승인 워크북 참조 연결, 42차 승인64원가행 liveMATCH/expenseESTIMATED 성분 연결(실제 납부 인증 아님). 실제 단 수량 native-unit 평균 보완·기존FIFO/저장본 보존. 저장1~44차 중국 E/F/H/I/J/K누락0/정책미연결0, 원본JSON·기존 C/G/R/AC/AJ 보존PASS. 44H13,989,631=계산관세12,242,065+그외1,747,566; F현재17품목515단 vs저장351단위불명 비교불가 명시, J−31,328,602/K−77.4316%. 대상42검사/dnSpy/manifest/writeguard PASS; 전체gate/build·배포 진행중(미검증). 운영쓰기/SP/마이그레이션/계산본갱신0. 세션docs/work-sessions/2026-11-06_china-duty-valuation-recovery.md.
검색어: 중국 관세124 44차 product_cost native_unit_acquisition 515단 13989631 실제납부 미확인

2026-11-06 추가검증: 첫verify ERPcore통과 후 posttest구형v4버전상수1건중단→기대v5만수정/대상5PASS→잔여공식posthooks/manifest/writeguard/webpack1worker build exit0(전체verify단일exit0 아님). 실제Chromium1920×1080 합성44차 H/J/K·접힌현재515단/저장351단위미확인·수평스크롤K표시/유한셀오차단없음/JS오류0/API쓰기0 PASS. `.verify/china-44-ui-rates.png`; 로컬3245테스트서버종료. PR/CI/운영검증은부모진행중. 생성history JSON2개커밋제외.
검색어: china-full-gate china-gate-resume Chromium44 515단 v5 WorkbookDuty

2026-11-06 손익 고정·명시조회: 실제PeriodDay현재45/직전44, 과거<=43와활성확정전체calc/totals고정·monetaryoverlay차단. 최근current/prior전체SQL+취득원가reference분리, ERP/인보이스4table전후fence 및 source실패전체보류. actual44ChinaN44964933/VN6942000 최신SQL정합, 39/42/43/44원본JSON전후hash동일, 운영쓰기/생성/갱신/SP0. 진입/선택/탭 금융GET0·명시조회/abort/stale출력가드, 22열·비고보존. 대상5신규·기존회귀·manifest196·writeguard1API·dnSpy PASS. 실제1920×1080/20fps/48.9초합성가이드최종PASS/ready, 최초0·선택0·추가reload0. 첫전체gate는origin/master갱신통합을위해pretest중정확한소유PID중지(완주PASS아님). 통합후필수전체gate/build/builtUI·PR/CI/배포·운영smoke 미검증. 세션docs/work-sessions/2026-11-06_profit-frozen-explicit-query.md.
검색어: profit-frozen-explicit-query coherentLatest PeriodDay53 invoice fence 44964933 6942000 명시조회
## 2026-11-06 출고일 기준 매출 탭
- 최신 origin/master 기반 codex/shipment-date-sales. 견적서 관리에 별도 탭 추가, 기존 차수 화면 보존. 업체+정산 요일 사용자별 UserFavorite 저장, 업체 클릭→최근12기간 및 과거 더보기, 직접기간 조회.
- ShipmentDate 확정 견적수량/저장금액 SELECT-only, Estimate 적용일별 조정 별도. 품목·단위별 합계와 `90 = 30(44-1) / 60(44-2)` 원차수 구성, 날짜·단가 상세. 내부 연도키 유지. ERP 원장/확정/재고/보고서 쓰기0.
- 실제 dnSpy CLI 실행, 운영 SELECT 신쿼리12행/11품목/721000원/중복PK0 확인(고객명·인증정보 기록 없음). 계약·교차연도·경계/단위/차감·API테스트 PASS. manifest/writeguard/dnSpy/가이드검사 PASS. 실제 Chrome 데스크톱/390px/24기간/오류복구 PASS.
- 실제 1920x1080 한국어 가이드55.5초 등록. ERP core PASS 후 posthook이 촬영용 임시 instrumentation을 읽어 실패→원본복원 후 공식 posttest:erp-contract exit0. 최초 전체 명령 exit0 아님; 정식 build/CI/배포/운영확인은 진행중(미검증).
검색어: 출고일 기준 매출 업체 즐겨찾기 정산요일 원차수 90=30(44-1)/60(44-2) estimate-shipment-date-sales
- 2026-11-06 후속: 정식 npm run build exit0, 공식 posttest:erp-contract exit0, 빌드된 next start에서 새탭 재접속 즐겨찾기/24기간/모바일/오류복구/팝업 shell/Tab·ShiftTab/실제 가이드 재생·목차·한국어 cues·다운로드 PASS. PR1593 CI/배포는 진행중(운영 미검증).
검색어: PR1593 출고일매출 build0 production-ui guide-player

## 2026-11-06 최근 손익44 운영502 읽기 진단 및 요청 내부 중복 제거
- a11ff8178 기반 codex/profit-coherent-performance. 운영 GET-only44는118.767초/502, 요청중 PM2 restart266→267 확인. 1GiB memory restart 설정은 확인됐으나 정확한 재시작원인은 미확정. 원장/설정/DB쓰기0.
- canonical44 SELECT profiler로 invoice cost revision4회뿐임을 확인해 invoice bulk안 중지. arrival261호출/105고유/156중복 및 FX동일연도 GROUP BY259회가 반복됐다. request-local exact typed args+queryRunner identity, normalized FXyearset memo만 추가. 요청밖 기존동작/SQL/수식/과거취득원가 reference/fence/confirmed정책 그대로, clone격리/실패evict.
- 실제 paired44:46.229→34.294초,2699→1403SELECT, 전체 rows.calc/totals SHA동일 bc10325225a9df284f399d6a76905986678a4f646a91c0a96ddbef4a1ee19607, 반환변이0. 계측RSS486.17→497.26MB로 메모리개선 입증없음. 운영 main<120초+restartdelta0 확인 전 해소판정 금지.
- 새대상12회귀 PASS. 정식 verify는 기존 VM하네스 helper미주입에서 중단→실제helper 두하네스주입 후 관련8회귀 PASS. 실패지점부터 공식 잔여core/posthook/dnSpy/manifest/writeguard/build 진행중(최종 미검증), 최종 cleanCI/배포/운영GET44 대기. 소스freeze, UI/가이드변경없음.
검색어: profit-coherent-performance GET44 502 PM2 1GiB requestmemo sourceWorkbookFx 2699 1403 moneySHA RSS

## 2026-11-06 운영44 UI 초기조회 진단 추가 (앱 변경 없음)
- PR1595 배포 후 단독GET44 HTTP200/92256ms/live·PM2 restart268유지 확인. 뒤이은 UI+XLSX는 초기출력버튼 활성120초 timeout으로 파일 미생성. afterUI PID변경/restart269로 요청중 재시작1회 확인. 정확한 memory restart 원인은 아직 미확정, 무관45차쓰기→409 후보도 입증전이다.
- 기존 download harness에 관찰전용 진단 추가: main/context/output 요청개수, 선택/요청/응답scope일치, HTTPstatus·허용code·body상태·basis, 실패/abort/완료·pending, 조회클릭여부 및 UI출력/기준표시 boolean만 기록. 기존 main JSON을 재사용해 추가GET/중복heavy조회0, 원자료/URL/header/토큰/사용자오류문자열 로그0.
- 기존 runtime 진단에 PM2 daemon log bounded4MiB/최근30분/선택PM2id의 정확한 max-memory-restart 문구 count/latest시각/current/maxMB만 집계. 원문로그/경로출력0·앱/설정/DB쓰기0. 새필수helper 없이 node-stdin 실행 그대로 지원. 잘린tail/미가용/pmid범위도 구분한다.
- 대상8회귀와 두script syntax PASS. 추가 운영UIheavy 실행은 보류, 부모가 featurebranch runtime 읽기진단부터 실행한다. 앱/fence/cacheclear/UI수식 수정0. 운영 원인·해결은 미검증.
검색어: profit-ui-read-diagnostic UI120초 HTTP409502200 scope abort PM2 memory_restart_30m diagnostics-only

## 2026-11-06 요청 종료 ERP cache 참조 해제
- PM2 daemon42176449563에서 UI조회중1081MB>1024MB memory-cap 재시작1회 확정. ALS/cache 누수인과 자체는 미확정. 승인범위는 withErpReadContext finally taildrain끝 caches.clear 한줄뿐, 반환/캐시값/externalEvidence/오류순서/수식/DB/설정 보존.
- lifecycle+기존memo/독립감사16PASS, incomingApprovalProfit/DBretry/WeeklyCache16PASS, profiler2PASS. ctx관련 VM/global rg로 추가의존성누락 없음 확인. DB쓰기fixture 실행0.
- 실제44 동일process3회(강한source반환보관OFF/forcedGC0/응답해제):29.812/26.967/24.672초,1403/1402/1402SELECT, moneySHA 모두 이전baseline동일 bc1032…19607, 종료cache namespace 모두0. peakRSS493.96/526.15/534.47MB, 종료RSS467.68/471.00/471.13MB, 종료heap160.85/228.00/236.66MB. cache0·종료RSS평탄 확인됐지만 peak저감/운영해소 미검증.
- 계약/incidentguard/plan에 기록, sourcefreeze 및 정식gate/build 준비. 부모 PR/CI/배포 후 운영2회이상+PM2restartdelta0로 최종판정. UI/가이드변경0.
검색어: erpReadContext caches.clear taildrain cache0 PM2 memorycap sequential3 RSS534 lifecycle

## 2026-11-06 보조탭 차수 왕복 명시조회 의도 폐기
- fresh codex/profit-query-scope-final @3b18c03f3. 분석/원천시트44조회→45→44복귀시 이전intent가 살아 자동remount/GET되는 edge확인. 앱은 기존 year/week/view effect에 setQueriedAuxScope(null) 한줄만 추가. 원장·SQL·수식·금액·출력/키보드/비고/22열 보존, 운영query/DB쓰기0.
- 실제localhost1920x1080 paced syntheticbrowser PASS: 기존4chapter 동일흐름, 진입금융0/조건변경0/추가reload0, 녹화종료 후 분석·원천시트 각각44→45→44 GET증가0/미마운트, 다시조회 후에만각2번째GET. 총financial20(기존16+aux4), 모든API합성. 실행효과fixture는두탭·2025/2026 양성/반례 포함6PASS.
- 최종가이드 sourcehash변경으로 실제재촬영 필수. sourcefreeze ready, 부모가 output500 로컬probe 후 기존4chapter 재녹화 소유. 정식gate는 output원인확인/필수fix와최종영상 후1회예정(현재미검증). 기준선: shell/키보드/scroll/notes/출력기존보존 적용, 저장·매칭변경 해당없음, 가이드재촬영대기.
검색어: queriedAuxScope aux44 45 44 왕복 조회의도 explicit-query no-remount synthetic20
- 후속 진단: 운영 초기UI44 HTTP200/89.6초/exportEnabledtrue 뒤 output89초/500, PM2추가재시작0. oldworktree 로컬 output pipeline1회 SELECT-only PASS(본표25.824초/notes101ms/XLSX14ms/serialize1ms/총26.164초1413SELECT쓰기0)로 운영500미재현. bodyCode:null은 allowlist가 SQLcode를 숨길 수 있어 plainError확정불가. GET-only probe에 target(main기본/output)검증·고정8열/category1·context후target1회만 추가, codePresent+knownSQL 진단보강. 대상7회귀PASS, 추가운영실행은부모소유.
- 실녹화93777 흐름/auxPASS이나 최근44 fixture snapshot이saved banner와모순되어 녹화fixture만live/live/needsRefreshfalse로정정. 앱추가변경0, 기존4chapter/aux유지, 재촬영대기(영상완료판정아님).
검색어: readonly_api probe_target output EREQUEST codePresent guide-live-fixture output500
- 최종현황: PM2 memory-cap은cacheclear배포후 main44 200/89.6초+UI출력버튼활성 및 output호출 동안 추가restart0으로재현안됨. output500은1회발생했으나 단독42181336112 context200/1.071초→output200/85.888초로미재현, 정확원인미확정/해결확정아님. backend추가수정0, 다음실UI는codePresent/SQLcodes로추적가능.
- 최종fixture정정실녹화97144 PASS:1920x1080/4chapter/한국어VTT/aux2왕복/20GET/진입0/선택0/추가reload0. 부모중간22초live'현재원천으로계산'·끝42saved시각QA정상. 기존영상대체완료, 앱UI추가수정금지/sourcefreeze. 정식fullverify+build/빌드된guideplayer 및최종운영main+file1회검증예정(현재미검증).
검색어: guide97144 livebanner output42181336112 85888ms unknown500 no-backend-fix

## 2026-11-06 운영 Node 메모리 설정 읽기 진단
- fresh codex/profit-runtime-memory @31af4f81e. 최종44 main200/86.5초 후 output502,07:55:04Z RSS1032>cap1024MB 자동재시작확정. 기능·guide배포와운영반복출력실패를분리한다. 사용자runtime점검·조정승인이나현재는READ-ONLY확장만.
- 기존runtime진단에실제Node버전/PM2·proc heap숫자/flagboolean/CLI우선순위/Next title덮음unavailable/unverifiedmetadata/cgroup1·2·조상한도/procRSS/기존PM2heapmetrics추가. 원문args/env/jlist/개인경로로그·backup0, preload전달0/고정Node통계process1개만5초제한. freshheap은실제앱heap아님/동일cgroup여부표시. 설정·앱·SQL·DB쓰기0.
- 대상5회귀/syntax/diffcheckPASS,운영진단은부모dispatch대기(미검증). 다음heap/cap값미리결정하지않고설정확인후테스트·안전rollback계획필수. 최종실UI44 main+file연속2회/금액diff0/5xx0/추가restart0은미달성. 계정전체주간36%시작값(작업단독비용아님).
검색어: runtime-memory node_args NODE_OPTIONS actualargv unavailable cgroup heapLimit replica readonly

## 2026-11-06 최신 손익 overlap-only 읽기 공유·반복파일 검증
- 운영42188478063 Node20.20.2/설정heapflag없음/actualargv Next title관측불가/freshheap1995실앱값아님/cap1GiB/host3893.84MB.512후보 로컬Node24 3회돈동일/RSS낮음이나 운영동등성·latency원인 미입증, canary적용보류/설정쓰기0.
- main완료뒤 live week-check/notes/output fullcalc가겹칠수있어 exactyear+major/globalSymbol 최신normal read만 공유. 공동as-of/기존fence·수식·확정·historicalpolicy 보존, ERPctx bypass/clone/settle즉시삭제TTL0. 첫main완료값cache아님. UI/DB쓰기0/guide N/A.
- 대상18PASS+frozen6PASS, 별도 Next production 두APIbundle/source1회/owner실HTTPabort→waiter200·동일money/clone/ctxbypass/error evict PASS·원본hash불변/DB0. actual44 SELECT1회26.412초/1403/live/돈SHA bc10325225a9df284f399d6a76905986678a4f646a91c0a96ddbef4a1ee19607 동일/cache0/변이0/peakRSS503.91. 동시운영peak개선증거아님.
- 기존download workflow 명시repeat_recent_download exact2026/44만 UI+실XLSX2회/각120초/돈diff0/5xx0. 이모드만 독립감사분리·기본감사유지. 미완료canary helper/CLI/test는unstaged보존·이번PR제외, package는dedup/readonly회귀만 연결.
- sourcefreeze 뒤 부모필수gate/build/CI/배포 예정(미검증), 운영2회·PM2restartdelta0 미달성/이전output500원인미확정. runtime튜닝완료/운영OOM해소주장0.
검색어: profitLatestInFlight overlap-only TTL0 globalSymbol HTTPabort distinct-bundles repeat_recent_download bc1032 runtime-deferred

## 2026-11-06 읽기전용 반복파일 실패 진단 노출
- PR1600 cceaba 배포42196188246/필수gate·CI PASS. 운영repeat42197102612 Node20 합성fixture PASS 뒤 첫round133.6초FAIL, 원인미분리. afterdiag42197640781 PID1199984/restarts274 유지/RSS363MB/최근30분memoryrestart0이므로 이번실패를memoryrestart로보지않고512조정근거로사용하지않는다.
- two-round runner가 숨기던 기존 observer JSON을 event/kind/status/허용bodyCode/codePresent/enum basis·bodyState/유효yearweek/boolean·bounded counts·elapsed만 재출력. 중첩원문·URL·토큰·사용자오류·stderr는0. child exit/deadline/spawn/assess 실패는 고정reason/code만 출력.
- privacy/실행fixture 및 기존smoke6PASS/diffcheckPASS. 앱·SQL·운영설정변경0/새fullSQL실행0. 생성history dirty와미완료canary파일은보존·이번진단commit제외. 부모 featurebranch 읽기workflow 재실행대기, 실제main코드/abort/출력실패원인은아직미확정.
검색어: repeat133 profitUiReadDiagnostic allowlist child_exit deadline assess restart274 readonly-only

## 2026-11-06 반복검증 assessment 실패 분리
- 42197990812 main200/83.242초/live/scope일치→output200/82.419초→childexit0 뒤 assessment거절. child실파일assert 통과로보이나 전체5xx0·거절원인은아직미확정이며 차단시도수 때문이라고단정하지않는다.
- PASS결과의유효scope/요청·HTTP숫자/blockedWrites/actualBusinessWrites/diff개수/SHA/bytes/sheets만추가출력, HTTP실패는boolean/status+고정kind(main/output/week-check/stock-notes/other-api)만. 모든동일origin API5xx감지기준유지·URL원문0. 판정HTTP_FAILURE/READ_BUDGET_FAILED/FILE_MONEY_FAILED 고정code분리.
- blockedWrites는성공적으로차단한nonGET시도수이므로정수>=0허용, 실제businesswrites===0유지. 실제기존request handler를합성실행해POST/PATCH/DELETE모두abort·continue0 입증. 개인정보/중첩값/결과diff본문차단 및원인별fixture 포함9PASS. 앱/SQL/운영설정변경0/추가실SQL0, 부모읽기재실행대기.
검색어: RUNTIME_FILE_MONEY_FAILED blockedWrites intercepted actualBusinessWrites runtimeFileResult 42197990812 readonly

## 2026-11-06 ordinary live 손익 취소 실패 최소관측
- 운영42198999887 첫round실UI·파일46570bytes/1sheet/돈diff0 PASS 뒤 두번째main500/60.032초/ECANCEL. after42199923355 PID1199984/restarts274 유지/RSS429MiB/memoryrestart0. 이번실패메모리재시작아님/512조정근거없음, 실패SQL/대기원인은미확정.
- fresh cancel-diagnostic @50b264d8d. 일반shared live owner만 ECANCEL/ETIMEOUT 최대3회 fixedJSON: dispatch phase/PID/year+major/UTC/SHA12/elapsed/timerFired/dispatch+failure pool size·borrowed·available·pending bounded숫자. SQL/params/오류원문/응답trace0. 기존45/60초·retry·fence·수식·반환erroridentity/ERPctxbypass그대로, DB/설정쓰기0/추가실SQL·DMV0.
- 기존runtime4MiB tail 내최근30분 exactkey/type/enum whitelist count+최신3건 집계. 이전PID도보존해baseline대조가능, 원문라인출력0. poolgetter만읽고monkeypatch없음. source/VM관련globalrg검토후추가하네스의존성누락없음.
- 대상21PASS: 실제reader함수합성5phase·45000유지·erroridentity/loggerthrow·성공0로그/owner1/ERPctx완전bypass, profilerhash동일·pool0/null·교차연도/invalid0false·PID·privacy·실제runtime VM boundedtail. 첫합성fixture SELECT누락가드실패만정정. 계약/기준표/session연결, UI·workflow변경0/가이드N/A. fullgate/build/CI/운영판정은부모후속(미검증).
검색어: profitReadFailureDiagnostic ECANCEL ETIMEOUT preFence postFence queryHash explicitTimerFired poolAtDispatch PID bounded30m

## 2026-11-06 source fence 변경관측·stock-notes typed409
- 운영42203821147/42205610701 main200뒤output409 PROFIT_SOURCES_CHANGED+stocknotes500. quiet85초meta변경0/invoicefalse·이전실패창MAX시각후보0은원인미확정. GETcallgraph financialDB쓰기미발견·명시POST touch와구분. 현liveheap564.59MiB/RSS825.68/peak920.89 관측,512후보미적용유지.
- fresh source-fence-diagnostic @780bb. 기존before/after JSONshape/SQL/2회wholefence/연도·미래donor/failclosed409그대로, 불일치시ordinary sharedowner1회메모리diff만. 고정component/year/major/kind/timestampOnly삼상태/최대20/changedCount/truncated/invoiceChanged+coveredYears/PID·UTC·scope, C/H/M/digest/원문출력0. activeERPctxbypass/loggerthrow무해, 새SQL/timeout/수식/DB/설정변경0.
- runtime기존4MiB/최근30분 strict새marker집계·이전PID보존. stocknotes는statusCode409+PROFIT_SOURCES_CHANGED exact만409/code전달·기존generic문구유지, unknown/ECANCEL500/정상200/400405 그대로.
- 대상27PASS(실제reader 합성JSON·SQLsequence·2회fence·forceyear·owner1/logger409·ERPctx, privacy/crossyear/미래45/timestampOnly/PID, 실제runtime VM새marker와실제handler+scope파서). 기존2sourceassert는after변수whole비교형식만정정. 계약/기준표/session등록, fullsuite/build/CI/운영은부모후속(미검증). 추가probe/실SQL0·UI0/가이드N/A.
검색어: NENOVA_PROFIT_SOURCE_CHANGED timestampOnly coveredYears whole-fence stock-notes409 owner1 memory-only

## 2026-11-09 출고일 매출 주차 행렬 수정
- 사용자 요청: 카드형/넓은 여백을 품목×요일·날짜 가로비교표로 교체. 업체 검색 즉시 자동완성. 달력 범위를 7일 주차로 나누고 일별/주차별 매출 및 `90 = 30(44-1) / 60(44-2)` 표시.
- 기존 API/SQL/확정 조건/ERP 원장·재고 불변. 기존 UserFavorite 재사용. 실제 dnSpy 재실행 및 사전 SELECT12행721000원·중복0 확인. 새 helper 범위/일별·주별/부분주/교차연도/혼합단위/차감/금액0/입력불변 회귀 PASS.
- 실제Chrome 1920×1080 2주21품목 행27px, 자동완성/키보드/달력Arrow·Escape·두날짜 선택, 24기간이력/오류복구/390px 가로스크롤 PASS. 새 가이드 재녹화 진행 중. 필수 전체gate/build/CI/배포는 아직 미검증.
검색어: 출고일매출 주차행렬 달력기간 업체자동완성 일별매출 합계수량 estimateShipmentDateMatrix

2026-11-09 PDF 분석 응답 수정: nw-pdf-provider-stream-1109 기준73137437. 실제46-1콜카장CI4212KB 복구→AI1회약300초결과불명 재현. 비스트리밍fetch 헤더300초와일치(기존cause유실로최종원인확정불가). stream:true/SSE완료수집·부분응답차단·화이트리스트진단코드·오류로그boolean전달수정. 표적15개/전체ERP/dnSpy/manifest201/쓰기guard PASS. 빌드·CI·배포·실파일재분석 미완료. 사용자추가AI1회승인,아직미사용. 운영입고/재고/원가저장0.
검색어: PDF stream 46-1콜카장 UND_ERR_HEADERS_TIMEOUT PDF_ANALYSIS_UNCERTAIN 오류로그boolean
- 후속: 공식 npm run test:erp-contract exit0, test:erp-manifest origin/master exit0, dnSpy/writeguard/workflow-guides PASS, 정식 npm run build exit0. 빌드된 next start에서도 표·자동완성·달력/키보드/모바일/오류복구·54.1초 영상 재생/목차/한국어 자막/다운로드·popup shell PASS. PR/CI/배포는 진행 예정(운영 미검증).
검색어: date-sales-matrix ERP0 BUILD0 production-ui guide54.1

## 2026-11-09 입고 정정 영향 차수별 분배 검토
- 영업지원 요청 상세에 항상 열리는 분배 검토·수정 모달 추가. 연도·차수/업체품목 검색, 기존→최종 수량·판매단가, 상세 확정/최종 상태와 재검증 재고를 함께 표시. 임시값은 미검증, 최종 승인 전 ERP 영구변경0.
- 실제 dnSpy FormShipmentDistribution/ClassShipmentDetail 및 운영 FIX/CANCEL SP/상세트리거 SELECT 확인. 국가품종 전체 SP는 호출하지 않고 기존 receipt gate/locked writer 안에서 선택 기존확정 상세만0→입력→1복원. 미확정 유지, 대체신규는 원본상태상속/혼합확정합침차단. signed stockDelta/native cascade·정확부족동의·원가손익/전체rollback 유지.
- 대상20PASS/실제격리SQL45-01입고100→90 및45-03분배100→90 fixed/unfixed PASS. 현재190/후속100·190/2027동일 계산, Product.Stock차액1회,2025동일업체품목45-03·헤더·Estimate/WebProfit보존,날짜중간실패복구. 운영 표본7662/Prod22 출고9/날짜9/견적9/전년5/농장0, 운영쓰기0.
- production1920/390 실제모달·Tab20/ShiftTab/Escape초점복귀/Enter·수량수정·재검증 PASS. 양역할최종영상 import196초/support148.5초 실제촬영·한국어자막·목차·sourceproof 등록. dev촬영중단2회 뒤 production전환, nativeTab범위와 single-scenario fixture선택보완. 최종정식빌드/가이드재생 및 PR 전체ERP CI·배포·liveGET는 진행 중(미검증).
- origin/master3f91e0e1 통합, taggedstash 보존. 시작 계정전체41%/reset1794459857(작업단독사용량 아님). 운영저장시험·원장보정0.
검색어: incoming distribution-review 45-01 45-03 fixed unfixed stockDelta native rollback guide196 guide148.5
- 후속: origin/master3f91 통합 뒤 정식 `npm run build` exit0, 실제 MP4 재생·역할/목차·한국어VTT·다운로드·접기정지·1920/390 player PASS. 모달 Space 열기/체크, Arrow 차수선택까지 PASS. 최종 영상 중간/끝 프레임 시각확인 PASS. 전체ERP CI/병합/운영배포·GET smoke는 PR 후속(미검증).

## 2026-11-09 CO PDF 분할·완료 구간 재사용
- fresh nw-pdf-chunks-1109 @0a16fb9a. CO 최대3쪽/24구간 실제 PDF 분리, strict JSON/end_turn/페이지 매핑·coverage·상품+부대비 총액·manifest 송장/유일 농장 대조. supplier+invoice+currency 정확 이어붙임, 모호하면 차단. 텍스트 기반 송장 경계 탐지 완료로 주장하지 않음.
- 기존 job OS mutex/token 아래 구간 claim/result 보존. 명시 실패 job 재시도만 완료 구간 상속, 통신 실패 자동 재호출0. 전체 검산 실패 결과는 무효화. PDF 영구보관/운영 ERP 원장 쓰기/추가 유료 분석0.
- 표적34 PASS, 정식 test:erp-contract exit0, manifest201/writeguard/dnSpy PASS. 빌드/CI/배포 진행 중(미검증). 실제46-1 추가 유료 재분석 미실행이며 이전1회 승인은 소진됨.
검색어: co-chunks-v1 PDF_CHUNK_VALIDATION 46-1콜카장 구간재사용 manifest 원본페이지
- 후속: webpack1worker 정식 build exit0, workflow-guides/변경범위 검사 PASS. 운영 Chrome에서 이전 실패 원본4212KB 유지 확인, 분석 버튼 미실행. CI/코드-only 배포 진행 예정.
## 2026-11-09 즐겨찾기 즉시 조회·단가 표시
- 요청: 과거 정산맞춤이 아닌 앞으로 업체 클릭 한 번으로 매출·품목수량·단가 즉시 확인. 저장요일+클릭시 KST오늘로 기존 GET12기간, 최신2개만 compact 표시. 이전/다음2기간·전체이력/더보기 유지. 직접날짜 범위는 축소하지 않음.
- 저장판매단가(VAT포함) 항상 표시, 복수/0단가·단가별 표시기간수량 보존(평균없음). 공급가/실제VAT/합계 별도 요약. 기존 API/SQL/정산귀속·품목키·날짜·가격 원장 변경0.
- dnSpy 실제CLI 재실행 및 SELECT12행721000원중복0. 대상helper·실제1920/390 브라우저 원클릭/재조회변경단가·최신2/과거경계추가·실패페이지보존/0복수단가/요약/키보드/캘린더 PASS. 가이드 재촬영 및 fullgate/build/CI/배포 진행(미검증).
검색어: date-sales-quick-favorite 즐겨찾기 원클릭 판매단가 최근2기간 공급가 VAT
검증: 필수 ERP전체/manifest201/dnSpy/쓰기guard/가이드/빌드 및 운영빌드 Chrome dry-run 통과. 원장쓰기0. CI/배포는 진행 예정.
검색어: date-sales-quick favorite latest-two stored-price VAT

## 2026-11-09 PDF coverage 보완
- fed7c5ad/deploy42549551143 코드-only 성공·live버전/핑/hydration 확인. 사용자 복구확인 후 46-1 콜카장4212KB 유료 분할1회 시도, 약2분 내 페이지 coverage 검증 차단. 시간초과 대신 응답을 받은 것일 뿐 최종 분석 성공 아님. ERP 저장0/자동 재시도0.
- raw 응답 미보관이라 실제 반환형식/누락 원인 확정불가. 프롬프트에는 page/kind 정확 JSON 스키마가 없는데 검증기는 요구하는 계약 불일치 확인. 정확 키/정수로컬번호/배열길이/빈페이지분류 명시, 응답형식·개수·중복·범위 각각 안내. 원본 누락으로 단정 금지. coverage/금액 검증 완화0.
- fresh nw-pdf-coverage-1109 @fed7c5ad, 표적26 PASS. 전체ERP/빌드/CI/보완배포 진행 중. 추가 유료 재분석은 미실행·새 선택 요청. 실제46-1 성공 미검증.
검색어: PDF coverage page kind 형식누락 원본누락오진 46-1 fed7c5ad

## 2026-11-09 실패 응답 저장·무료 재검증
- fresh nw-pdf-response-replay-1109 @90ccba29. 이전실파일3/15→4 JSON실패, raw와비용로그본문 미보관이므로4원인확정불가/새유료0. parse전 private raw sidecar(0600/700,2MiB·30일·240+active,SHA/key/pages)저장. 기존3보존,완결JSON포장만분리·잘린/다중/문법오류반려.
- revalidateOnly:true는owner+sourcekey FAILED job만 API키/quota/provider/SQL앞에서무료분기,누락4는명시/추가분석0. 선택복구버튼은ERP준비와분리,raw일반GET/로그노출0. 실제4th 원문복구/해결완료로오인보고금지.
- 표적45/manifest201/writeguard/dnSpy/guide PASS. fullERP/build/CI/배포/실브라우저후속 진행 중. 운영DB쓰기0/새유료분석0.
검색어: revalidateOnly savePackingPdfChunkResponse MISSING_SAVED_RESPONSE 무료재검증 3of15 raw-sidecar

# Work memory

## 2026-11-09 46-1 무료 잔여 구조화
- fresh origin/master f0decd7b, branch fix/co-free-local-1109. 기존 nw-pdf-response-replay-1109의 사용자/빌드/메모 변경 보존.
- 로컬만: new-chat/output/461-free-extract/structure-remaining.mjs는 SHA88c28b75... 원본 전용 검증 프로토타입. 일반 CO 자동파서로 배포하지 않음. 명시 원문 기준값과 레이아웃별 정규식으로10~43쪽26송장200행 구조화. 원문 금액/송이 기대값은 검증 기준이며 누락 상품값을 보충하는 입력으로 쓰지 않음.
- 송이226295, 총액46815.36USD(상품+원문 INVOS48.11/FUNZA15 부대비), 행금액/송장총액/송이수 불일치0. 일부 원문 혼합상자 하위품목/행별 박스가 별도이며 전체 입고준비 완료라는 뜻 아님.
- AYURA17805와17806 합45300+300=45600송이,151+1=152pieces, master와 일치. 같은농장 한송장 강제하면 오류. FLORA CONCEPT2191857의AWBH AFBG00568511은manifest TheElite와 대응,이름만 비교하지 말 것.
- ESPERANCE FEER4346: 송장AFBH00568432 vs masterAFBG00568432.1500송이/621USD 일치하지만 접두사 임의정정 금지. 사용자 확인 요청 중.
- 원문6~9페이지/기존 완료3결과와 최종 병합, 무료웹경로 구현, 실제앱회귀는 미완료. 서버 private 기존3 데이터는 수정/덮어쓰기0, 유료호출0,운영DB수정0. 이 숫자는 잔여26송장만의 합계이며 전체43쪽 최종합계로 보고하지 않음.
검색어: 46-1 무료 구조화 26송장200행 46815.36 226295 FEER4346 AFBH AFBG AYURA17806

## 2026-11-09 HAWB 원본 시각 재확인
- 사용자 OCR 오인식 가능성 지적 후 동일PDF 1·25쪽을 pdfjs2배 렌더해 직접 대조.1쪽 Esperance 행은 AFBG00568432,25쪽 하단 인쇄는 HAWB:AFBH00568432로 보임. 이 두 값은 OCR이 아닌 PDF 내장 텍스트에서 추출했던 값이고 시각 원본도 동일함. 추출오류로 단정하지 않으며 원본 간 표기 차이로 유지. 원문 발행자의 오타인지 실제 다른HAWB인지는 미확정.
검색어: FEER4346 원본시각대조 OCR아님 PDF내장텍스트 AFBH00568432

## 2026-11-09 오픈소스 OCR 실파일 추가시험
- 공식 PaddleOCR/Docling/RapidOCR/Tesseract 자료 확인. 설치된 radar-pilot venv RapidOCR3.10.0+PP-OCRv6 small ONNX local모델 사용. socket연결 차단 후 추론,API키/유료/ERP쓰기0. 서버상주worker/기존서비스설정 변경0.
- 호주44-01 CI1쪽11행 좌표별 box/unit/price/amount 전부 원본비교 일치.65boxes/2385bunch/20443.75AUD,2쪽같은총액 일치,Green/RedTip 라벨둘다확인. 각행units*price=amount 검산PASS.
- 46-1 Tiba27쪽:38+84+220=342USD/800송이/8pieces OCR+원본 대조PASS.44-1콜카장22쪽:65+38+168+220=491USD/1100송이/11pieces 원본 대조PASS.후자는 Unit헤더confidence0.76(확인필요),수량오류로단정금지.
- 최종4구간당3.34~5.30초.신뢰도점수는정확도확률아님. Recipe하위행에금액반복되므로전체숫자합산하면중복. 원본좌표의부모행/recipe구분 및별도합계대조필수.
- 산출/재현: new-chat/output/461-free-extract/ocr-local-test.py,check-ocr-values.mjs,ocr-value-validation.json.검증errors0.이결과는부분스캔/숫자대조이며웹배포·전국가업로드E2E완료아님.
검색어: RapidOCR3.10 PP-OCRv6 local ONNX 44-01 65box2385bunch20443.75 Tiba342491 OCR무료

## 2026-11-09 무료 OCR 웹연결 작업 착수
- lib/importOcrRecipePolicy.js 및 전용계약 import-free-ocr.json 추가. 상품/Recipe는 원본sourceId+같은page+명시parentSourceId로만 대조. 값같은정상반복행유지,하위합계불일치/부모누락/중복원본ID반려. 순수 completed/free chunk정책은 원본SHA/상태/페이지순서검사하며 기존result객체참조보존.
- importOcrRecipePolicy12테스트PASS,git diff--check PASS. 실파일OCR값대조도 errors0 재확인. API/SQL/유료 호출0.
- 기존 Docling 브리지는 owner PC에서 후보표만 생성해 Claude 프롬프트로 전달하는 구조. 이것을 무료OCR 전체처리로 오인하지 말 것. Cafe24에 Python이 없으므로 실제무료큐/owner워커/정규화/클라이언트/구간병합 연결과실앱E2E는 아직 미완료. 이helper는아직실행웹경로에연결되지않음. 배포하지않음.
검색어: importOcrRecipePolicy resolveOcrRecipeRows mergeFreeOcrWithCompleted 12PASS 무료큐미연결

## 2026-11-09 무료 OCR 웹 큐·owner 워커·46-1 복구 구현
- 무료 전용 HTTP 큐/소유자 검증/로컬 RapidOCR 워커/CO exact-source 46-1 병합/AU Premium Greens 구조화 연결. 유료 자동 전환 없음. Recipe는 원본 좌표 부모·자식 합계로 검산, 값이 같은 정상 상품행은 삭제하지 않음.
- 실제 46-1 43쪽 로컬 워커 추출→31송장266품목 수량·금액 검증. 격리 Next 서버 + 실제 Chrome HTTP + 로컬 Python 워커 통합 PASS: 31송장, 기존 테스트 완료3구간 JSON 동일, providerCalls0/ERP쓰기0. 운영에 저장된 실제3구간 병합과 구분할 것.
- test:erp-contract PASS, 대상 테스트91PASS/1기존skip, 초기 build PASS. 합성 실제 UI 무료 버튼 dry-run PASS(유료0), 가이드/최종 gates/배포/네이티브 앱 스모크는 후속 결과로 갱신 필요.
- CO 복구는 SHA 고정 46-1만 검증됨. 다른 CO 서식의 범용 무료처리를 주장하지 않음. AU 44-01 로컬 OCR 65박스2385단20443.75AUD 검산 PASS. 중국 3개 구형 서식 미지원 상태는 별도 개선 필요.
- 완료3개 보존·병합실패 전체바이트보존·다른계정/SHA차단 테스트 포함. HAWB AFBH/AFBG 불일치는 원문 유지 확인필요. 운영 ERP DB·유료 분석 실행0.
검색어: free-ocr-worker RapidOCR CO46-1 31송장266행 기존3개보존 HTTP통합 AU65박스 무료자동전환없음

## 2026-11-09 업로드 업체 오매칭·담당업체 분배단가
- 47차 실제 남대문경원/원당태광 원본 참고 미우13행이 본문7/4행보다 score높아 잘못 선택됨. 셀연결 메타는 미우+07차로 오인하고 저장별칭456 선택 재현. 파일 업체+차수 일치 본문 우선/셀별제목, 경원 업로드전용 유일명277 별칭, 미매칭 이전업체 승계금지.
- 업로드 기본order, 분배단가수정 별도버튼+담당자 이름/색 그룹/차수업체불러오기. 기존 ERP writer 유지, 운영시험쓰기/보정0. 2026/47 세키 ViewOrder/Shipment/Date0,2025동일차수63개 별개. 실제 DB 분배업체67/담당66 조회200.
- 합성 다중시트7·4대13/47차/차수불일치/별칭누락중복, 실제API의 이전456승계금지, 브라우저1920/390/키보드/영상촬영 PASS. 전체검증·빌드·CI·배포 진행(미검증). 세션 docs/work-sessions/2026-11-09_upload-customer-price-workspace.md.
검색어: 남대문경원 원당태광 47차 미우 참고시트 Sheet1 orderImportSheetIdentity 담당업체 분배단가

- 최종 로컬 검증: 전체 test:erp-contract/manifest203/dnSpy/writeguard/가이드/build(webpack1worker) exit0. 운영빌드 실제1920/390 브라우저 및 영상재생/목차/한국어자막/다운로드/접기정지 PASS. CI/병합/배포는 진행 중(미검증).

## 2026-11-09 46-1 Claude 잔여12 분석·완료3 보존
- 승인된 잔여12개 Claude 호출 완료. 15/15 이후 총액 검증에서 실패한 원인은 상세/요약 중복3송장. 추가 provider 호출 없이 저장 응답으로 로컬 병합 검증: 31송장266행308495송이1137pieces, 인보이스 총액64204.86USD(부대비 포함). 원문 SHA 한정 요약분리·감사근거 보존, 다른 파일에 숫자기반 삭제 금지.
- 구형 병합실패가 원본3개까지 invalidate한 문제: 동일 계정+cacheKey의 과거 성공구간만 충돌검사 후 복원. 이전 작업 불변/성공구간 보존 검사 통과. 완료3 원본은 서버 f5206d7f 작업에 여전히 보존. 운영 최신 작업 e68ec019는 배포 후 저장응답 재검증 필요(아직 미검증).
- PDF 기본 Claude, 캐시/완료구간 재사용, 실패 자동 재호출 없음. 무료OCR 자동/버튼 제거. 저장응답 재검증은 API0회 별도 동작. 중국XLSX 코드변환/ERP writer 불변.
- 실제 컴퓨터유즈 IAB 격리 컴포넌트에서31송장266행 계산→엑셀 다운로드 확인. 품목키·입고는 fixture, 운영 SQL 미연결, 중량/비용 TEST_ONLY. 실제 ERP 입고등록 E2E 및 실제 재무 원가 대조는 미검증. 다운로드 shared-awb-2026-46-01-86514699602.xlsx, Artifact Tool 재계산·원본계산 시트266행/308495송이/단원가 유한값·오류검색0·PNG 확인. 비용 시험값을 실원가 통과로 보고하지 않음.
- 혼합 품종 FB 입력 UI 누락 보완. 실물1137pieces와FB를 혼동하지 않음. 원문 AFBH/AFBG 차이 및 FB 인쇄527 대 명세행524 차이는 확인필요 유지. 원문 값을 임의수정하지 않음.
- 대상회귀114통과1skip(추가 테스트 재실행 예정), ERP contract/manifest242 중233통과9skip, writeguard/dnSpy PASS. 프로덕션 빌드1회통과(최종 SharedAwb 입력 UI 변경 전), 두 실제 UI 가이드 촬영/검증 PASS. 최종빌드·CI·배포는 미검증.
검색어: 46-1 Claude 잔여12 완료3 요약표중복 133495 17805 202875 source_summary_rows reconcile461Manifest FB527 524 O15 TEST_ONLY
- 최종 추가 회귀125개 중124통과1skip, 전체 ERP contract·manifest·writeguard·dnSpy 가드 PASS. 실제 설치 EXE ExcelLoadingPackingList CLI 재확인: dt[5]/[8]/[9]→박스/단/송이, BulkCopy WarehouseMaster→uspCreateWarehouse→uspStockCalculation 순서. 이 writer는 변경/실행하지 않음. 최종 npm build(webpack cpus1) 및 두 가이드 검증 PASS. PR·운영 배포·서버 저장응답 재검증은 진행 중(미검증).

## 2026-11-09 견적 EXE 달력 차감 읽기 정합
- 사용자 실제 차감수량 확인 후 DB 변경 없이 EXE exact EstimateDtm=PeriodDay.BaseYmd 자격을 견적 목록/상세/인쇄/Excel 및 최신 손익 L/O·독립SQL감사에 공통 적용. 동액 별개 정상행 dedupe 없음.
- 과거 비확정은 전체 기존 L/O(운송매출 포함)가 저장 auto/calc와 인증된 같은 날짜 covered 비자정 시각 불일치만 clone 보완. L/O·C/J/비율 외 원가/재고/원본snapshot/confirm DB 보존. NULL/달력날짜없음·source불일치·확정본은 원금액+진단. 새 화면/탭/순서 변경 없어 신규 영상 해당 없음.
- 새 estimateNativeCalendar9개와 기존 frozen/cache/SQLlineage/독립감사 묶음18개 PASS. exeEstimateViewSql34assert/estimatePrintContract/차감 원본snapshot회귀 PASS, diff--check PASS. 부모 SELECT-only 실제EXE·전후SQL·다른차수·저장원본해시 검증 근거는 비공개 .verify, 공개 fixture는 합성만. 36차 역사골든과 현재 원천 차이는 이전/신규SQL 모두 동일하여 이번 영향0.
- 전체 ERP gate/build/CI/배포/운영브라우저는 부모 담당이며 현재 미검증. 구현자 DB접속/쓰기·SP·배포·커밋 없음. 기준 docs/plans/estimate-native-calendar-2026-11-09.md, 계약 estimate-native-calendar.json.
검색어: estimate-native-calendar exact PeriodDay off-midnight frozen sourceL sourceO freight clone 불량30단
- 부모 최종 검증: board·전체 ERP contract(pre/post 포함)·dnSpy evidence·변경 manifest205·write scope guard·workflow guides7/영상8·webpack production build PASS. 최신 master b156c0dde를 검사 전 fast-forward로 반영했다. SELECT-only 연간 대사: 동일한 covered off-time 유형은33/35/40에9행, 초기1~3차 NULL468행은 저장금액 보존. 견적 상세/인쇄/Excel 대상 차감수량 일치 및 원가·재고 금액 보존 확인. CI/배포·실브라우저·배포후원장해시는 아래 후속 결과 전까지 미검증.

## 2026-11-10 출고분배 미국 품종 검색
- 미국 더글라스/레몬잎 누락 원인: 품종 groups GET의 현재차수 주문 EXISTS, 품목탭 검색의 현재목록 한정. groups는 전체활성 Product, 비공백 검색은 기존 productCatalog를 ProdKey로 합쳐 국가/꽃/이름 검색. 저장 writer·ERP 원장 변경0.
- 실제 dnSpy 재실행/운영 SELECT 및 교차연도 downstream 확인. helper13/전체ERP/dnSpy/manifest/쓰기guard 통과. Chrome 표적1920/390·2025/2026·검색/복귀/쓰기0 PASS. 기존 종합브라우저 후반 add-manager 후 qty 탐색 timeout은 미해결(파일변경없음). 빌드/CI/배포는 진행 중, 운영 UI 미검증.
검색어: 출고분배 미국 더글라스 레몬잎 전체품목검색 미분배 shipmentDistributionCatalog
- 추가 검증: 실제 FormEstimateView dnSpy 재실행. ViewOrder 기반 신규분배/확정가드 및 native Excel SQL 확인. 격리MSSQL 공유날짜저장→견적수량750/금액→엑셀1행, 전년도/무효담당자/삭제항목 차단 및 미확정/0견적량/시각/raw키 배제 PASS. 운영2025/46-01 미국29행 Date.EstQuantity NULL로 native Excel 제외 발견(원장보정0, 원인주체미확정). 전체ERP/build PASS. CI/배포/운영UI 후속.
검색어: 미국 출고분배 견적누락 이카운트 EstQuantity NULL 2025 46-01 downstream SQL

## 2026-11-10 출고분배 국가 묶음·45-03 선택 및 미국 과거 견적
- 국가별 제목 아래 품종 버튼(사용자확정), 기존 선택·즐겨찾기·저장순서 그대로. 빈45-03에서 catalog품목 표시만되고 selectProd가products만허용하던 결함수정. 상단품목선택도0주문에서활성/동일catalog 로드. 표적Chrome교차연도·검색→선택→업체추가→수량→주문선등록→분배저장 PASS. 국가helper14PASS.
- 메뉴기준 적용: 국가별묶음/페이지주스크롤/1920·390/키보드/미저장보호. 새메뉴·탭·업무순서추가없음(기존동작복원/배치변경)이므로 가이드영상 신규제작 해당없음. ERP수량·저장공식 불변.
- 과거2025 전체관측29~52차 Date견적4필드NULL,2026 1~3동일/4차부터기재→기존G2b레거시와일치. 미국에만생긴웹실패라는추정정정. 승인29행중양수25/0행4. 79박스/환산1690/기존Amount8895454.545454547/Vat889545.4545454545 보존복원안. readonly preview PASS, 격리SQL금액보존/교차연도/rollback/CAS PASS. 운영적용·전체gate/build/CI/배포는미완료.
검색어: 미국 2025 46-01 legacy G2b 견적수량 25 4 국가별제목 45-03 업체추가 catalog선택
- 최종검증: 전체ERP/dnSpy/manifest206/쓰기guard/정식build PASS. 격리MSSQL 복원/금액보존/2026동일차수/rollback/CAS PASS. Chrome1920/390 국가별제목·2025/2026빈45-03 상단검색→선택→업체추가→2박스→주문선등록→분배저장 PASS. 실제운영 UI/원장적용은배포후예정.
검색어: 45-03 업체추가 국가별제목 레거시견적 원장보존
## 2026-11-10 콜롬비아 원본 통관비 자동화 — 진행 중
- 작업트리 nw-co-cost-defaults-1110 / fix/co-cost-defaults-1110. 운영 DB 쓰기·추가 AI 없음. 공유 AWB 콜롬비아 통관비를 42-1 원본 GW×460+33,000+활성 품종수×10,000+99,000+40,000으로 계산. 기존 명시 총액(0 포함) 유지, FORMULA/TOTAL 구분. USD 조회시세+15 기존 endpoint 자동 적용, 수정값 보존.
- 실제 읽기 스냅샷 46-01 AWB86514699602의 31입고/265상품 replay로 실제 컴포넌트 브라우저 다운로드 확인. GW100/CW120/운임100USD는 TEST_ONLY, 실제46-1 원가 검증 통과로 주장 금지. 다운로드 shared-awb-2026-46-01-86514699602 (2).xlsx. ERP Be Sweet600송이/206USD의4자리 평균단가 반올림은 계산 복제본에서만 금액÷수량으로 정밀화, 실불일치는 차단 유지.
- 대상 회귀49pass9skip/전체 ERP contract PASS, 가이드 녹화 PASS. 엑셀 최초 총액/판매가/이익/합계 및 수식오류 없음 확인. 그러나 C8 GW 변경시 P10은 갱신되지만 T8/U8/L15/M15 종속값이 갱신되지 않는 재계산 문제를 Artifact와 Excel COM에서 관찰: 미해결. .verify/verify-excel-co.ps1 및 .verify/artifact/verify-co.mjs 재현. 기준 파일 수정/저장 없음. 해결 전 완전검증·배포완료 주장 금지.
- 마지막 SELECT probe 47headers/313rows로 최초48/316에서 외부 운영 데이터가 달라짐. 자체 writes0이나 전체 운영 스냅샷 불변을 주장할 수 없음. 비공개 .verify에 결과. build/commit/PR/배포 미실행.
검색어: CO customs FORMULA TOTAL coOriginalCostInputs 46-1 GW460 BeSweet .3433 206 T8 P10 재계산 미완료


## 2026-11-10 콜롬비아 엑셀 재계산 수정
- 원인: 판매 행수 COUNT(Q15:Q마지막)을 AB12에 기록해 CO 중량 SUMPRODUCT(AB8:AB12,AC8:AC12)와 판매 추천식 사이에 순환 참조 발생. AC12=0이어도 의존성 순환은 없어지지 않음. 판매 진단만 AK14:AL15로 이동, 원본 배분계수·계산식·승인값 보존.
- 수정 후 동일46-1 31입고/265상품 실제 브라우저 다운로드 (5).xlsx, Artifact 및 Microsoft Excel 독립 재계산 PASS. GW100→101: 통관258000→258460, 총원가87612004.3975→87612464.3975, 265개 행 원가 및 판매/이익 갱신, 원복 PASS. 중량·운임 TEST_ONLY, 실제 재무원가 통과 아님. 파일 readOnly/Save없음/운영 SQL 쓰기0.
- 자동판매 국가별 회귀52pass9skip. 전체 가드·빌드·CI·코드배포는 후속 검증 예정.
검색어: CO AB12 COUNT SUMPRODUCT 순환참조 AK14 AL15 GW 재계산 265행 verify-colombia-cost-recalculation
- 최종 로컬: 대상75개66pass9skip, 전체 ERP contract·manifest205·writeguard(변경API0)·dnSpy evidence·가이드7/영상8·프로덕션 webpack cpus1 빌드 PASS. 실제 EXE CLI 재확인, 운영 writer 실행0. 새 UI 가이드 재녹화 및 현재 소스 hash 검증. CI/배포 후속.

## 2026-11-10 출고분배 국가 목록 즐겨찾기 기본 표시
- 사용자 요청: 국가별 목록은 즐겨찾기 품종만 표시하고 비즐겨찾기 국가를 숨김. 기본 showAllProdGroups=false, 계정의 기존 shipment-distribute-groups 저장값 사용. 즐겨찾기0개는 빈 안내, 전체로 자동확장하지 않음. 전체 보기로 별표 추가 후 기본보기 복귀 가능.
- 표시전환만 변경: prodGroup/차수/미저장 입력/전체 카탈로그 검색/주문·분배 writer/금액·재고·견적 모두 보존. 계정 변경 시 이전 그룹 즐겨찾기 및 전체보기 상태 즉시 초기화. SQL/서버 API/ERP 저장 공식 변경0.
- 메뉴기준: 국가별 묶음/페이지 스크롤/의미 있는 버튼/기존 키보드 적용. 새메뉴·탭·업무순서 추가 없는 표시필터이므로 가이드 신규제작 해당없음. 이전 actual dnSpy 근거·ERP 원장 계약 유지(이번 조회·쓰기 SQL 변경없음).
- 순수 정책15개 및 실제Chrome1920/390: 즐겨찾기국가만→전체보기→즐겨찾기복귀, 빈45-03 검색/선택/업체추가/합성저장 기존회귀 PASS. 전체게이트/빌드/CI/배포 진행 중.
검색어: 출고분배 국가 즐겨찾기만 품종전체보기 favoriteCountryGroups 계정분리
- 로컬 완료: ERP전체/dnSpy/manifest206/쓰기guard/정식build PASS. 최종Chrome 기본즐겨찾기 CO수국·카네이션·장미3개만/미국국가숨김, 전체보기→복귀/1920·390 및45-03 합성기존저장회귀 PASS. 계정변경시그룹즐겨찾기초기화도포함. CI/배포/운영화면확인은후속.
- 이전 #1639 운영보정 완료 상태 기록 보완: a2117552 배포성공 후 2025/46-01 미국 양수25개 Date견적필드 복원,0행4개보존. 79박스/1690단/기존매출9785000원 동일, 정상인쇄·Excel25행·실XLSX메모리roundtrip·22업체·원장지문보존 확인, SystemActionLog18151. 별도 작업트리 nw-us-estimate-repair/outputs에 백업·검증영수증 보관. 이번 즐겨찾기 표시 작업 ERP쓰기0.
검색어: 즐겨찾기만 기본표시 3품종 국가숨김 1639 보정완료18151

## 2026-11-10 출고분배 국가+품종 즐겨찾기 / 실제 출고일 수량 분배
- 국가 설정(UserFavorite shipment-distribute-countries)과 기존 품종 즐겨찾기의 교집합을 국가 제목 아래 한 번만 표시. 전체보기에서 설정하며 명시[]·재접속·계정전환 보존, 초기 조회 완료 후에만 기본 품종 선택. 중복 상단 chip 제거, 좌우 여백·표 수량 열 간격 축소.
- 기존 출고일지정 입력은 실제 ShipmentDate 저장이 없는 화면/엑셀 임시값이 원인. 품목/업체/날짜 탭 공용 편집기로 실제 날짜 조회→수량합계→서버 미리보기→명시 저장. 날짜탭 상단 수량저장·Ctrl+S 숨은 품목 쓰기 차단.
- 실제 dnSpy FormShipmentDistribution/ClassShipmentDate 재추출. PeriodDay exact7일/연도/시각/중복, EXE 소수 EstQuantity 및 midpoint-to-even, 요일번호 마지막 대표일 적용. 총출고·견적량·gross 불변, SD.ShipmentDtm만 변경, 수량/단가/금액/isFix/주문/농장/재고/Estimate/손익 보존. V2 gate+내부편집리스+SERIALIZABLE+snapshot+감사/사후조회 롤백. 가격/비고/legacy NULL/수동견적수량 불명확하면 차단.
- 운영 SELECT-only: 2026/45-01/3513 상세2건 각1박스/15단/172500원 preflight PASS, 날짜달력7. 운영 테스트 저장0. 이전 미국29건 보정은 별도 완료(양수25/0행4, 수량·매출 보존).
- 격리 MSSQL PASS: .4+.6박스→6+9단→172500원, native 견적2행/전체요일 이카운트 Excel집계1행 및 요일별6·9/XLSX roundtrip, prior2025 sentinel99, 원장지문, stale/감사실패 롤백/gate busy. Chrome 합성1920/390 PASS: 국가 교집합·중복제거·빈설정 재접속·계정변경·날짜 미리보기/저장/재조회·ESC/Ctrl+S 보호, 기존45-03 검색/업체추가 회귀도 PASS.
- 로컬 필수 test:erp-contract / dnSpy / manifest207 / write guard / production build 모두 PASS. 실제 Chrome 사용가이드 MP4+한국어VTT+목차+proof 생성, registry 검사 PASS(8업무9영상). CI·병합·Cafe24 배포·운영 브라우저 스모크는 후속 단계, 이 기록 시점 미검증.
검색어: 국가즐겨찾기 품종교집합 출고일분배 distribution-dates ShipmentDate 소수견적량 midpoint-to-even 총매출보존

## 2026-11-10 PR1641 배포 전 검토 — 보류
- 사용자: PR1641 확인 후 문제없으면 배포. 검토 head878093b01822f66578e0f9e44772b78ef6965982, branchfeat/arrival-country-rule. 조건부 배포 승인이고 결함을 발견했으므로 병합/배포하지 않음. 운영 DB/원장/코드 수정0.
- lib/arrivalDrivePolicy.js67:73 실제 함수와selectArrivalDriveCandidates/arrivalDriveTiming을 합성 원본으로 실행. 2026/46-1 CO원가파일에 (1)2025/46-1 CO AWB (2)차수없는AWB.pdf (3)46-1 호주 AWB (4)shared-awb-2026-46-01-86514699602 (5).xlsx PC자동수집 계산파일을 각각 넣었을 때 모두 reason빈값/readytrue 재현. 재현코드 .verify/pr1641-repro.mjs, DB접속0.
- 연도 인자가 없고 미확인 차수도허용(line71), AU/US/NZ국가제외누락(line57/72), 파일명AWB토큰만확인하고 원본형식/계산산출물/AWB번호같은선적연결검증없음(line68:73). 기존테스트는 정상·다른차수·NL·삭제만확인해 반례누락. CI진행중이어도이결함과독립적으로배포불가.
- 변경은 업무드라이브 기존원가엑셀 자동반영게이트뿐. 인보이스/AWB 숫자추출·현재공동AWB원가작성·기존입고원가경로는보완하지않음. 수정요청 전 리뷰만 진행, GitHub외부리뷰코멘트도 미작성.
검색어: PR1641 AWB gate 878093b0 교차연도 미확인차수 호주 shared-awb 시험파일 false positive 배포보류

## 2026-11-10 PR1641 오인식 수정
- 서버 실제 XLSX/PDF 바이트·hash·AWB 번호/체크디짓·본문·명시 연도/차수 검증. 전년도/국가불명/차수불명/혼합국가/시험 XLSX/위장PDF/index proof 주입 차단. 상태·예약·실행·저장직전 verifiedCandidates 공용, AWB 교체 시 importer 호출0.
- 실제 PDF/XLSX 정상 및 반례, worker AWB 교체 저장0, 기존 국가/교차연도/롤백 회귀 통과. ERP전체/dnSpy/manifest206/writeguard 통과. EXE FormWarehouseView CLI 재추출. SQL·ERP writer·산식 변경0, 운영 DB 호출/저장0, 추가AI0.
- 명시 연도/차수 없는 원본 및 스캔 PDF는 자동추정하지 않고 보류. UI/순서 변경없음(기존 reason 재사용), 영상 신규 해당없음. webpack/PR CI/코드배포 후속. docs/work-sessions/2026-11-10_pr1641-awb-proof.md.
검색어: PR1641 AWB evidence 원본PDF hash 번호 연도 차수 반례 verifiedCandidates 운영DB보존

## 2026-11-10 CO46 AWB decimal and filename correction
- Actual46-1 AWB decimal commas now read GW3487/CW4152/rate2.95/total12320.40. Missing filename hints require server original-body execution-year/Colombia/checksum-AWB proof, not blanket rejection. Explicit year/week/country/hash/number conflicts remain blocked.
- Actual browser original CI upload -> source-reviewed comparison fixture matching ->16 isolated native writer commits -> shared16farm/46line cost download PASS. Transcription uses ERP names, not fresh AI/fuzzy accuracy proof. No production DB or new paid AI calls. Protected orders/shipments unchanged. Shared actual freight applied once; artifact recalc and GW mutation PASS.
- Full ERP/dnSpy/manifest/writeguard/webpack PASS. No source formula/native/migration/UI sequence change. PR CI/code deploy pending; see docs/work-sessions/2026-11-10_co46-awb-locale.md for exact evidence and limits.
검색어: CO46 16017338020 AWB decimal comma filename original execution date 16farm46row isolated download

## 2026-11-10 국가 선택·업체정보 빈 화면 후속
- 원인: 국가 제목이 text+즐겨찾기만 있고 선택 이벤트가 없었음. 업체 후보는 native GetCustomerList의 ViewShipment+ShipmentDate 필수조인으로 분배 전 주문업체도 빠짐. 실제 태국45-03은 주문0이어서 단순 JOIN 수정만으로는 해결되지 않음.
- 국가명은 country:: 읽기필터로 선택/활성 표시, 별은 즐겨찾기로 구분. 국가 전체에서 꽃 단위 SP/확정/초기화는 품종 선택 안내로 차단. 새 workspaceCustomers 공용 SELECT는 활성 현재연도+차수+국가/품종 주문업체를 분배 전에도 표시; 주문0이면 활성 전체업체 noOrder 후보로 안내. 초기80개, 전체검색 유지. 첫 업체 선택은 비교칸을 먼저 눌러도 기본업체로 연결. 기존 수정초안/양수주문→분배 writer 보존, 조회/선택으로 원장쓰기0.
- actual dnSpy FormShipmentDistribution 재추출 및 운영 SELECT: 2026/45-01 태국 주문업체7, 2025동일7 / 2026/45-03 레드불0주문→활성676후보(이름 미출력). 교차연도99/분배없음/빈차수/삭제/국가·품종/조회원장불변 격리SQL PASS. Chrome1920/390 국가활성/45-03 후보/선택만으로주문0쓰기/기존날짜편집·catalog 검색 회귀 PASS. 안내영상35초대 재촬영+한국어자막/목차 country/customers 추가, proof 검사 PASS.
- test:erp-contract / dnSpy / 변경manifest207 / writeguard / production build 전부 PASS. CI/병합/Cafe24 배포/운영 스모크는 후속, 현재기록 시점 미검증. 이전 날짜분배/미국29건 보정 writer 변경0.
검색어: 국가선택 country:: workspaceCustomers 업체정보 빈45-03 주문없음676 nativeShipmentDate조인제거 80업체전체검색
- 최종 추가: 주문/품목0인45-03 업체를 선택한 뒤 품목추가 창도 전체 활성 카탈로그 로드. native 품목에 누락된 국가/입수 메타데이터만 보충하고 기존 수량/명시0단가는 우선 보존(순수17개 PASS). 국가 전체/품종 기본 필터 및 품종상관없는 검색 정상. 업체→품목추가→품목선택까지 실제Chrome 합성자료 회귀·영상 갱신 PASS, 선택만으로 주문/분배 요청0. 보완분 포함 ERP전체/dnSpy/manifest/writeguard/build 다시 모두 PASS. 기존 native writer 변경0.
검색어: 빈차수 첫품목추가 전체카탈로그 native메타데이터보충 명시0단가보존
## 2026-11-10 선율 정산 ZIP 원천 연결 — 100% 대사 요청 후 중간 보존
- 전용 작업트리에서 파일 전용 ZIP/job/첫페이지 OCR/정산 planner/store/API/UI 및 DB 수기 우선 overlay를 구현 중 보존했다. ERP·웹 DB 쓰기/SP·운영 적용시험·커밋 없음. 과거 확정·계산본 보존, 보고서 갱신은 사용자가 직접 실행하는 흐름이다.
- 대상 회귀 16개 PASS. 실제 비공개 26PDF 첫 페이지 OCR 검산24/신고번호보류2. 35차는 DB 충돌대상5/추가 매칭보류1, 충돌 제외 연결가능3문서6필드. 36차 정확AWB미매칭2/충돌0/연결가능11문서20필드. 이는 선율 정산서 비용 원천 범위이며 전체 H 통관비 100% 일치 검증이 아니다.
- 사용자 추가 설명으로 부모가 뒤 증빙 포함 전체 H(창고료·국내운송·한국방역) 대사를 우선한다. 신규 구현·배포준비 중지, 소스 미커밋 보존. 가이드 dryrun timeout/standalone hydration 경고 미해결, 영상 draft/미제작. 전체 gate/build/CI/배포 미검증.
- 기준·진행 상태: docs/plans/profit-customs-settlement-zip-2026-11-10.md. 테스트 서버 종료, 부모 대사 결과와 추가 지시 대기.
검색어: 선율 정산 ZIP customsSettlement 첫페이지 OCR 24 26 통관비100%대사 미완료 source-only 직접갱신
### 2026-11-10 통관비 100% 대사 요청 재확인
- 사용자 정정: OCR 범위 축소 자체보다 정산서 통관비의 정확한 연결 여부를 확인하는 것이 목적. 구현·배포는 대사 완료 전 보류.
- 35·36차 26 PDF/232쪽 중 첫 페이지 외 206쪽은 상단만 로컬 한국어 OCR로 분류. 이는 비용 금액 전수 대사가 아니며 100% 일치 판정 근거로 사용하지 않음.
- 운영 브라우저에서 2026년 35·36차 실제 표시 표를 읽기 전용 기록. 저장/계산본 갱신/DB 쓰기 없음.
- 파일명 AWB와 해당 연도·차수 SQL 입고의 정확한 연결은 24/26. 36차 HOOD CANAL 18053083741 및 CLOUD 99994582784는 미연결. 첫 페이지 엄격 OCR 검산도 별도로 24/26이며 두 종류의 실패를 혼동하지 않음.
- 정산서 관세·통관대행·검역대행과 웹 그외통관비 전체(창고·국내운송·방역 포함)는 범위가 다름. 항목별 금액 전수 대사는 미검증.
- 검색어: 통관비100% 정산서대사 35차36차 AWB미연결 OCR범위

### 2026-11-10 35·36차 정산서 항목·합계 대사 완료(읽기 전용)
- 실제 26개 정산표 공급가/VAT/관세/수입VAT/비용합계 전부 검산, 대행료 있는21건 후면 선율 세금계산서 금액까지 시각 대조 일치. 분류불명8쪽은 신고필증 상세로 확인. 전 세번 과세 적법성 감사가 아닌 청구값-웹 반영 대사.
- HOOD AWB는 유효35-01/삭제36-01이라 ZIP36 범위 매칭 실패. CLOUD 2B AWB는 Master에 없고 2A 헤더에 두 정산서 금액·중량이 정확 합산되어 있음(패킹 원문별 SKU 경계는 미검증).
- 35 저장본 일부 SunYul은 SQL 공급가를 다시÷1.1, CO풀/미국 대행료 미반영. 36 저장본은 관세·대행료 미연결, 태국 대행료 기본값 차이. 상세 금액/26건 표는 비공개 .verify/35-36-customs-reconciliation-20261110.md에 보관, Git 금지.
- 실제 브라우저 표와 동일35v10/36v7 PayloadJson 조사종료까지 불변 SELECT 확인. FreightCost 해당범위0행. 원장/웹 DB 쓰기·SP·저장·갱신·파일원천적용·배포0. 정산서 외 백상/월드/한국방역 실제청구는 근거 미제공으로 인증하지 않음. 기존 구현 미커밋 보존.
- 검색어: 35 36 정산서26건 대사완료 HOOD차수이동 CLOUD합산입고 SunYul공급가 이중VAT제거

## 2026-11-10 선율 ZIP 자동등록 구현 완료 — 배포 전 소스 동결
- 최종 사용자 목적 반영: ZIP 첫페이지 검산 후 확실건 worker callback 자동등록, 타차수 exact 귀속·합산 AWB·실제 차액만 명시 확인. 검산된 net/gross 원천을 읽기 계산에 우선하되 DB 원문·확정·과거 계산본은 보존하며 계산본 갱신은 사용자가 직접 실행한다.
- 신규 두 회귀25개 및 기존 customsWeightPolicy/ActualCosts PASS, frozen loader6개 PASS(새 원천 전후 fence 변경 차단 포함). 표적 가이드 dryrun PASS, SSR/client 선택 hydration 오류0·자동완료 후 입력표 재조회 확인. 신규 회귀를 npm ERP pretest 고정목록에 연결, manifest207/diff-check PASS.
- 실제26 첫페이지+캡처SQL을 격리 임시파일로 replay: 35ZIP13 자동,36ZIP11 자동+2 제안 확인,26개 정확1회·잔여0. 실제 귀속35차14/36차12. 작은header RapidOCR로 이전식별자2건도실제worker local replay 성공(첫페이지만). 이는 운영 적용이 아니며 운영 원천/DB 쓰기0.
- 안전: 연도전체 신고번호 rootlock 중복검사, scoped ledger 문서fingerprint·합산·contentDigest/실제날짜 검증, 손상시H=0폴백금지. streaming ZIP한도/sidecar/TTL/3회claim/인증backoff/heartbeat·재접속job복구. 합산입고는통화+금액+GW동시검산,특정AWB하드코딩0.
- 실제 영상 촬영·재생/전체 ERP/build/CI/PR/배포/운영서비스 설치·실제원천 적용은 부모의 최신master 동기화 이후 예정(미검증). 구현자 커밋/푸시/merge/운영 적용 없음. 기존 부모 대사 문서·INDEX 변경 보존.
검색어: customsSettlement 자동등록 source우선 net gross 26 24자동2확인 HOOD CLOUD 원천등록 직접계산본갱신 소스동결

- 최종 로컬 검증: a7a27d79 동기화 후 신규/기존UI32·source-sliced33·전체ERP·dnSpy·manifest208·writeguard4API·webpack build PASS. 기존 source-sliced mock 누락은 관련fixture 전체 보완, 실제 source fence 약화0. 전체 stem readonly/DBparts 보존·자동refresh draft보존·scope/sequence·ZIP응답역전 회귀 포함. 50.9초 실제 합성가이드+한국어VTT/4목차/proof 및 player1920/390 PASS. CI/PR/코드배포/도우미 설치/운영 원천 등록은 이어서 진행하며 아직 완료 주장하지 않음.

## 2026-11-10 선율 ZIP 가이드 실촬영·후속 fixture 검증
- a7a27d79 동기화 후 production source-sliced fixture 새fence 의존성 전수 확인. 진단2/WeeklyCache/calendar fixture 명시mock·새원천변경409/frozen미호출 반례, 관련7파일33검사PASS. production코드완화0. posttest:erp-contract 전체1회exit0,로그 .verify/erp-posttest-rest.log.
- 실제 가이드44.45초/1920×1080/100%/20fps/약1.36MB 녹화, 한국어VTT·4목차·proof등록ready. 중간/최종프레임직접확인, 실제player 재생/역할/목차seek/자막/다운로드/접기일시정지/Enter·Space·Tab·ShiftTab/1920·390 PASS. scripts/customs-settlement-guide-player-smoke.cjs 재현. guide전체9workflow10video gatePASS.
- 비공개 실제26replay 재현스크립트 .verify/replay-customs-captured.cjs, 최신관측 .verify/customs-replay-result.json: 자동24/확인2/등록26/중복0/잔여0,35귀속14·36귀속12,SQL연결·운영쓰기0. 과거실제worker2건stdout은 .verify/customs-worker-observed-results.json(과거관측임을명시).
- 임시로컬 녹화·player 서버종료. 원본UI소스hash변경0. 최종fullERP/build/PR/배포/운영worker설치·원천적용은 부모예정이며 미검증. 추가커밋/운영변경0.
검색어: 선율 ZIP guide support.mp4 44.45 9workflow10video posttest33 fixturefence customs-player-result

## 2026-11-10 최종 UI 분할 그룹·미저장 보호 및 영상 대체
- 연결된국가stem전체effectiveRow·readOnly로표시하여기존DB2/3번분할중복표시차단. 다른필드저장시source-covered그룹은원DBparts만보존/없으면전송skip. 자동source완료load만draft3종보존,명시조회저장reset유지. load의year/week+seq fence와기존Upload.refresh seq의oldZIPpoll배제실행회귀추가.
- 신규2파일28회귀+기존UI4파일묶음32PASS. 최종가이드dryrun→실촬영→중간/최종프레임→player재검증PASS. 이전44.45초영상은대체했고최종support.mp4는50.9초/1920×1080/20fps/100%/약1.54MB,4목차/한국어VTT/4sourcehash ready. 실제DOM에서raw2part→연결1part및6readonly칸검증.
- player재생/역할/목차seek·초점/자막/다운로드/접기pause/Enter·Space·Tab·ShiftTab/1920·390PASS,영상206/자막200. workflow9/영상10·manifest208·diffcheckPASS. SQL/운영쓰기0·서버종료. 최종fullERP/build/CI/배포는부모후속이며미검증.
검색어: 선율 ZIP 50.9 stem effectiveRow readonly preserveEdits oldZIP seq 28회귀 32표적 최종재촬영

## 2026-11-10 출고분배 농장/업체 독립 작업공간
- 사용자 개념 재정의: 농장=국가→품종접기→품목→거래처/농장, 업체=차수업체→품목. 즐겨찾기 품종/SKU 우선, 미즐겨찾기는 하단 접힌 품종으로 보존. 상단 중복 품종즐겨찾기 제거, 국가명/별 구분. 업체 탭에 농장 국가/품종 필터 및 숨은 꽃 범위 일괄작업을 전파하지 않음.
- 두 탭 공용 실제 ShipmentDate 분류(전체/미지정/실제날짜), 수량은 차수합계 명시. 새로운 workspaceDateIndex는 연도+차수+Master.CustKey+ProdKey 활성주문 SELECT만. 날짜편집은 기존 date-only 미리보기→명시저장 유지. 접기/분류로 수량/금액/확정/원장 변경0. 미저장 수량·단가면 탭이동 차단, 저장/취소 후 이동시 선택행 최신조회. 추가업체 refresh 순차처리.
- 실제 dnSpy FormShipmentDistribution 재추출, native 국가+품종/품목→거래처→농장/업체→요일 그리드 확인. native 접기 없음은 사용자요청 웹확장으로 명시. 운영 SELECT 2025/45-01 1249쌍,2026/45-01 973쌍 및 미지정/다중날짜 확인. 격리MSSQL DateIndex 교차연도99/SD.CustKey NULL/양수·0날짜/미지정/삭제/수량불변 PASS. 기존 업체범위 및 견적/ECOUNT XLSX·이전연도 repair/금액/rollback SQL 재실행 PASS. 미국29건 원장 추가보정0, 운영주문/분배/이카운트 쓰기0.
- 새 UI Chrome1920/390 즐겨찾기순서·접기Enter·독립업체 미국품목·양탭 날짜필터/편집·출고일지정·미저장보호·양연도45-03 카탈로그 PASS. 기존 workspace browser 실패재시도/가격/업체이동/선등록/중복저장/late응답/뷰포트 PASS. UI 안내영상1920 한국어자막/목차/proof 갱신 PASS.
- 전체ERP검사 초기 실행은 컴포넌트 분리 후 이전 파일을 검사하던 display assertion에서 실패, 새컴포넌트 검사로 수정 후 통과. 중복 전체실행 대신 해당지점 이후+post검사 진행. 빌드/CI/배포/실로그인 스모크는 이 기록 시점 미검증, 후속 결과 append 예정.
검색어: 출고분배 두탭독립 즐겨찾기우선 품종접기 DistributionProductTree workspaceDateIndex 실제출고일분류 미저장탭보호 미국29보존
- 최종 로컬: ERP 초기 실행의 실패 테스트 수정·해당 지점부터 끝 및 post 전부 PASS, 신설 navigation test CI 연결 PASS. dnSpy/manifest207/writeguard/안내영상9개/production build PASS. CI/배포/실브라우저는 후속.

## 2026-11-10 CO46 실제 AI 헤더·패킹 자동입력
- 실제 저장 Claude 6구간으로 16송장46행 재검증. 단당 송이수 원가 연결·유일 농장 master/과거명 중복·스페인어/2자리 날짜 근거·MAWB/HAWB 분리 수정. source 수량/가격/금액 불변, 운영DB/추가유료AI 0.
- 최종 빌드 브라우저 격리 native 입고16건/46행/662박스/19960송이/USD13366.76 저장·재조회, 기존 주문/출고 sentinel 불변. 공동 GW3487/CW4152/운임12320.40로 XLSX(3) 실제 다운로드. Artifact 수식오류0, GW변경 통관/원가 재계산 PASS. AI bunch_st1/30/10 원문값 보존이며 원문 인식100% 인증 아님.
- 전체 가드 초기PASS+최종 집중47개/webpack PASS. CI·코드배포 후속. docs/work-sessions/2026-11-10_co46-ai-header-packing.md. UI/순서 변경없음. 다운로드는 미승인 계산본, 원본 기본 통관비/조회시세+15원.
검색어: CO46 저장AI 단당송이수 farm 날짜 MAWB HAWB 공동AWB 16송장46행 formulaErrors0 운영DB보존

## 2026-11-10 선율 ZIP nginx 업로드 한도 긴급 수정
- 운영 ZIP이 nginx HTML413으로 차단된 원인에 맞춰 exact customs-settlement=36m(Next36mb,ZIP25MiB base64 JSON), worker=2m(Next2mb OCR POST) 관리경로 추가. worker PDF12MiB는 GET/18mb 응답이므로 요청 한도를 불필요 확대하지 않음.
- 공통 응답 helper로 HTML/비JSON·401/403·413·502/503/504를 안전한 안내로 처리하고 원문 응답/파싱 오류 노출 차단. 기존 성공 JSON·업무 오류와 stale poll fence 보존. 계약 scope/필수 nginx 회귀/한도 명시.
- nginx 회귀 PASS, settlement30/30 PASS(실제 로컬2MiB HTTP413·본문 비노출/로그인/게이트웨이/성공JSON 포함), diffcheck PASS. 해당 가이드만 dryrun→실촬영1회 및 중간/최종 프레임 확인 PASS: 51초1920×1080/20fps/100%,5sourcehash. 플레이어1920/390·목차4·키보드·실재생·자막·다운로드·접기PASS, workflow9/영상10 및 base8a8479ea 변경검사PASS.
- 운영DB/원천적용/커밋0, 녹화·플레이어는 합성API/임시파일만 사용 후 서버종료. 최종 전체검사/빌드/배포/nginx 실제반영·운영 재업로드는 부모 담당이며 이 시점 미검증.
검색어: 선율 ZIP nginx 413 36m 2m 25MiB base64 customsSettlementHttp 30PASS 51초 5sourcehash
- 부모 최종 전체 ERP/post·dnSpy·manifest208·쓰기guard(API변경0)·webpack production build 모두 PASS(exit0). 운영35/36 DB통관행6·CO0·저장본17행은 기존SELECT 캡처와 동일. 후속 PR/CI/재배포/실제등록은 아래 기록 예정.

## 2026-11-10 출고일 행내 월~일 수량 입력
- 사용자 요청: 출고일 버튼 대신 행 옆 월~일+월/일 입력. 농장/업체(비교업체 포함)/출고일지정의 공통 DistributionInlineDates 적용. 월2~일1 순서로 native PeriodDay 실제 날짜만 표시. 날짜 사실+공용 exact 달력은 workspaceDateIndex 묶음조회, 행별GET 추가0.
- inline 초안은 부모상태로 보존, 수량/단가 저장·SP/확정·탭/차수/품목/업체 변경을 미저장보호. 행 취소/전체취소, Enter다음요일/마지막확인버튼(자동저장0),CtrlS배경수량저장차단. 합계/입력유효성 검사. canonical GET와 최초 날짜/수량 signature 다르면 stale 차단, 기존 snapshot미리보기/명시저장/lease/gate/serializable/audit/rollback을 그대로 사용. 원장 writer 정책 변경0, 달력SQL만 기존 reader와 공용상수 추출.
- actual dnSpy FormShipmentDistribution ymd/day1..7·ShipmentQuantityToEstQuantity 재확인. 운영SELECT 2025/46 11/12~18,2026/46 11/11~17 7일/7요일 확인. 격리 SQL fullbaseline0날짜/SD.CustKey NULL/교차연도99/달력다른연도fallback0 및 native Date저장/견적15단·gross172500·ECOUNT XLSX/rollback/stale/fixed/Order·Farm·Stock·Estimate·Profit보존 PASS. 운영ERP/ECOUNT 쓰기0.
- 새순수테스트 CI 연결, 날짜직접입력/합계부족/preview승계/저장/dirty탭/CtrlS/stale/cancel/390 Chrome PASS. 기존 전체 workspace·업체이동·양연도미국카탈로그 회귀 PASS. 안내영상/한국어자막/proof 갱신 PASS. 전체ERP/dnSpy/manifest207/writeguard/영상9개 PASS. 최종빌드/CI/배포/실로그인 확인은 이 기록시점 미검증.
검색어: 행내출고일 월화수목금토일 월일 DistributionInlineDates inlineDateSignature 0날짜baseline nativePeriodDay 총량매출보존

## 2026-11-10 출고내역서 신규 메뉴 구현 진행
- 사용자 승인: 설계대로 구현·배포, 드래그 다중선택 출고일 일괄지정 추가. 최신 origin/master 별도작업트리 codex/shipment-statements.
- 기본요일설정 잔량/직접입력보존, 메인차수전체세부차수, 담당자→업체, 품목군묶음, 저장본CAS·원본hash·요일XLSX,ERP쓰기0.
- 실제dnSpy 및양연도운영SELECT,신규12테스트·1920/390브라우저·드래그/키보드/저장복구/다운로드PASS. 실제합성가이드31.8초·한국어VTT/5목차,player1920/390PASS. 전체필수검사/빌드/CI/PR/배포는진행예정이며미검증.
- 검색어: 출고내역서 shipment-statement 드래그 일괄출고일 기본요일잔량 웹작성본CAS

- 최종 로컬 검증: 최신c4394b06f 병합 후 npm run test:erp-contract 전체(pre/core/post) exit0. dnSpy/manifest209/writeguard1API/ui-layout/workflow11업무12영상 및 production webpack1worker build PASS. production build로1920/390실브라우저·drag2행/기본요일/그룹/저장복원/엑셀/keyboard/가이드player재검증PASS. 가이드31.8초MP4/한국어VTT/5목차·중간/최종프레임 직접확인. 운영코드배포/CI/PR은후속.
- 검색어: shipment-statement 전체ERP통과 webpack build production브라우저 검증완료

## 2026-11-10 출고일 실제 날짜순·단/송이 표시 정정
- 원인: 전산달력은2026/45=11/4수~11/10화인데 웹이월~일로재배열해11/9→11/10→11/4 역행. native dnSpy FormShipmentDistribution GetCustomerList/ShipmentQuantityToEstQuantity 재추출 및 PeriodDay 운영SELECT로 확인. 날짜 자체오염 아님. 2025/45=11/5~11/11,2025/46=11/12~18,2026/46=11/11~17도명시연도조회 확인.
- 날짜 Timestamp 오름차순/실제 전체기간 표시. 분배칸·확인창·미리보기까지 날짜순 통일. Product3513 native1박스=15단=300송이; .4/.6은6/9단 또는120/180송이로표시입력, payload는.4/.6박스 유지. 기본단·필요시송이, native송이우선. 직접StemOfBox우선/단→송이StemOfBunch라는EXE분기를전용purehelper로고정(generic박스비율대체0).
- 원장값·날짜·수량·금액·확정정책 변경0. 입수/정수환산/기존3자리저장정밀도로정확표현불가면반올림0·안내차단. 단위전환은초안없을때, 최초packing signature와fresh canonical context까지대조해편집중입수변경차단. 기존date-only snapshot/gate/lease/정수견적환산/매출/rollback/감사유지.
- EXE변환우선순위·0/false/누락·정수/비정확양수→0반올림방지 pure PASS, native달력/교차연도/0날짜·Master업체(NULL SD.CustKey)/메타데이터묶음SQL 및 date저장15견적단/172500gross/ECOUNT XLSX·fixed/rollback/stale·원장보존 actual SQL PASS. 새Chrome 날짜순7일/단15↔송이300/6+9단→payload.4+.6/합계·정수·정밀도·입수stale/390, 기존업체이동/양연도미국catalog PASS. 안내영상/한국어자막/proof 갱신12영상검사PASS.
- 최신base9464381b 병합뒤 전체ERP(exit0)/dnSpy/manifest209/writeguard(API0)/guide/production build(exit0) PASS. 운영ERP·ECOUNT쓰기0. PR/CI/배포/실로그인은 이 기록 시점 미검증.
검색어: 출고일날짜역행 202645 1104수1110화 단송이정수 dateUnitFactor datePackingSignature native환산 날짜순정렬

2026-11-10 수입부 확인 엑셀 전체품목·담당자 시트의 거래처 셀에 정식 거래처명만 표시. 생성 파일 재열기 시험 통과.
검색어: 수입부확인 엑셀 거래처 태림원예

## 2026-11-10 출고내역서 버튼/업체 개인 즐겨찾기
- 사용자요청: 메인차수±2차·담당자·업체 버튼, 담당자 개인 업체즐겨찾기. 최신bbe9a478e 별도작업트리 codex/statement-buttons.
- 해당연도메인차수버튼클릭즉시조회, 담당자별실제분배업체버튼,기존UserFavorite 인증계정별CustKey★저장/우선정렬/GET확인·실패재확인. SQL/ERP writer/기존favoritesAPI수정0.
- 실제dnSpy/양연도production reader SELECT,16단위회귀·1920/390실브라우저기존전체업무+새버튼/개인설정분리/실패GET재확인/미저장담당자전환방어PASS. 실제36.25초가이드재촬영·한국어VTT/5목차·playerPASS. 전체필수검사/PR/배포미검증,후속.
- 검색어: 출고내역서 버튼형 ±2차 담당자 업체 즐겨찾기 shipment-statement-customers
2026-11-10 웹·PC 개인 즐겨찾기 번호 및 이름 편집. 기존 목록 번호 보존, 별칭(기본 메뉴명) 표시. 브라우저와 PC는 기존 계정별 저장 경로 사용.
검색어: 즐겨찾기 번호 이름 변경 desktop-v1.3.16

## 2026-11-10 수입부 비용·매칭·합계·현재 입력 다운로드 수정 진행
- NL46 실제 분석 상품1391.90+운송321.49+처리50=1763.39EUR/GW102/CW114 확인. 검증된 웹 비용 연결·중복 방지, 팀 매칭 유지, 합계 표시, 수정 FX/관세 다운로드 공유 구현. ERP 비용행 writer 변경 아님.
- 격리 SQL writer/원가/live비용/stale 경고, native10공식 XLSX/현재 FX·관세, dnSpy/manifest210/쓰기guard/webpack compile PASS. 운영 DB 쓰기0.
- 실제 전체 브라우저 E2E/다른 국가 실파일/영상 재촬영/PR/CI/배포 미완료. npm build prebuild 영상 가드 차단; 우회 배포0. 전체ERP 최종로그 확인 필요.
- 인계: docs/work-sessions/2026-11-10_import-expense-repair.md, worktree nw-import-repair-1110, branch fix/import-repair-1110. 변경 미커밋.
검색어: import-repair-1110 NL46 운송비371.49 매칭유지 현재환율 관세 엑셀
- 후속 전체 npm run test:erp-contract pre/core/post 최종 exit0 확인. 실제 화면 E2E·가이드·배포는 여전히 미완료.

## 2026-11-10 출고내역서 버튼 최종 로컬 검증
- 16개 회귀, 전체 ERP 계약(pre/core/post), dnSpy 근거, manifest209·ERP쓰기가드·UI레이아웃 통과. 최신05479b9d8 병합 및 번호가이드 갱신 뒤 workflow11업무12영상·manifest209·쓰기가드 재통과.
- 새 영상117초, 원본1920x1080/100%, 1~5단계 번호 일치·실제화면 1.35배 부드러운 확대/축소·고정크기 한국어자막. 첫/중간/끝 overview/zoom/out 9프레임 직접확인, 대상가림 없음. 녹화 fixture-only, 운영쓰기0. 최종빌드/실플레이어/CI/배포는 이 시점 진행중.
검색어: 출고내역서 버튼 개인즐겨찾기 번호가이드117초 zoompan 실제프레임
2026-11-10 즐겨찾기 이름 편집 기능을 새 설치에서도 사용하도록 웹 PC 다운로드 링크 1.3.16으로 변경.
검색어: PC 버전 다운로드 즐겨찾기 1.3.16

## 2026-11-10 출고 Excel 연도·실제날짜·수량보존 및 미국29 출력검증
- dnSpy 설치EXE FormShipmentDistribution/GetCustomerList,FormEstimateView/GetPrintDetail/GetExcelDetail 재추출과 운영SELECT 확인. API의연도누락/브라우저임시요일재분배반올림/토일누락 정정. requireOrderYear+공통SHIPMENT_EXPORT_SQL/builder,실제저장날짜순·원본native수량·혼합단위소계,달력/합계불일치409. 원장쓰기0.
- 운영기준 미국2025/46-01=29건(양수25/0수량4),79박스/1690단/9785000원. 실제22업체API+기존견적/ECOUNT출력builder로 XLSX버퍼생성·재열기: 견적25/ECOUNT25/출고25행,25날짜키노출/수량·금액일치. 0수량4는EXE조건대로제외·보존. 개발서버와production build서버 모두PASS,전후11영역원장지문동일. 실제workbook/개인정보/인증값디스크저장0.
- 교차연도/세부차수/업체/주말.4+.6/혼합단위/0·누락·중복/달력반례/API임시설정무시5tests PASS; 실제MSSQL 임시테이블scope fixture PASS. npm ERP전체 exit0/dnSpy/manifest210/writeguard1API/webpack1workerbuild exit0. CI/병합/운영배포·실브라우저·운영서버출력은이시점미검증.
검색어: shipmentExportExcel 미국29 20254601 79박스 1690단 9785000 Excel주말 연도누락 roundtrip
2026-11-10 계정별 웹 UserFavorite 목록을 PC에서 동기화. 최초 업그레이드 시 기존 PC 목록 병합, 계정 변경·동기화 실패 시 보호. 창과 탭 구성은 Windows 사용자 데이터에 암호화 저장. PC 1.3.17.
검색어: 계정 즐겨찾기 동기화 재설치 번호 별칭

## 2026-11-10 수입부 실제 NL46·TH38 다운로드 검증
- NL46 실제 원본·저장AI로 격리11행/1290송이/1391.90EUR+비용371.49 입고 readback 및 총액1763.39 확인. 같은입고 원가 직접연결 버그 수정. 실제브라우저 다운로드 기본FX1516.8→수정1600/관세25% 반영, XLSX 재계산오류0.
- TH38 실제19행/362단/4300송이/1452.40USD 격리입고·시험비용 명시 원가다운로드/재계산오류0. 실제비용 검증아님. 검증된문서 통화·운송방식 재입력 제거. 호주원본20443.75와기존24523.75 모순 보존, 운영수정0.
- 팀매칭은 해결행만 숨기는필터와저장소멸을 구별. 영상은 검색입력·즉시선택저장·전체보기 재확인·번호/줌 촬영. 전체국가실파일E2E/전체업무영상완료로표시하지않음. 최종CI/배포는현시점미완료.
검색어: NL46 TH38 91001 FX1600 관세25 현재입력다운로드 expenseLink 검증원가
## 2026-11-10 출고내역서 선택형 묶음 및 원본 양식
- 체크로 새묶음/기존묶음추가/선택만해제,자동이름,한품목군한묶음·미선택보존. 기존web초안/저장본호환·ERP쓰기0.
- 사용자두원본XML서식비교후공통흰배경/검정thin/맑은고딕굵은16·19/4열/병합/원단가표시복제. 같은묶음한표·다른묶음옆표,미묶음한표. 원본의옛값/숨김/잔재표보존하지않음,동적행수픽셀100%동일미보장.
- dnSpy/양연도SELECT probe,20테스트/PC390실Chrome선택·기존전체업무PASS,Artifact실제XLSX원본·생성렌더직접비교PASS. 새125.9초번호가이드첫/중간/끝overview/zoom/out+묶음프레임직접확인PASS. 전체ERP/빌드/CI/배포후속미검증.
검색어: 출고내역서 선택형묶음 원본서식 플로르 알파 45차화요일1110

- 최종검증:전체ERP(pre/core/post)exit0,dnSpy/manifest210/쓰기0API/layout/workflow11업무12영상/webpack1worker build PASS. production build PC1920·모바일390선택묶음/기존묶음추가/해제/자동이름/키보드/저장복원/다운로드/전체기존업무 및 영상player PASS. 원본XLSX/합성출력Artifact렌더확인,단가동일병합·혼합단가구분·정수/소수·긴이름/옆표행높이20테스트PASS.
- 날짜중간요청은사용자가철회,기존수11-04~화11-10최종확인. 임시화시작수정은커밋/배포없이전부복원,core/service/date변경0. PR/운영배포후속미검증.
검색어: 선택형묶음 최종20테스트 전체ERP통과 날짜변경철회 원본양식렌더
## 2026-11-10 물량표 카톡 농장분배 통합 업로드
- 최신 master 별도 작업트리 codex/farm-text-excel에서 구현. 수량·업체 변경과 카톡 농장별 배정을 기존 전체 업로드 트랜잭션/서명 검증/안전 복원 이력에 함께 연결. 농장만 변경할 때는 ShipmentFarm/Descr 외 원장 보존을 전후 스냅샷으로 검사. 모호한 업체·품목·농장은 직접 선택 후 재검증. 카톡 제목 차수는 저장 범위를 변경하지 않는다.
- 원본 OOXML 직접 수정: 수량표 밖 빈 상단 셀에 메모, 원본 행 높이·열 너비·용지·여백·인쇄 배율 보존. 실제 카네이션4항목=81행/31%, 장미20항목=60행/46% 유지 및 ExcelJS 재열기 확인. 원본 빈셀만 추가 병합하고 기존 셀 스타일은 보존. 구조화 농장분배_검증 시트로 재업로드 합계 대조, 수량0 취소 시 배정/생성메모 해제. 공간부족·직접 인쇄메모 수정은 안내차단.
- 실제 dnSpy FormShipmentDistribution CLI와 운영 SELECT 선검증. 2026/45-01/Prod2158 견적진단 native helper 5행 중5행 InGetDetail>0, DetailFix=1 조건 확인. 운영 ERP 쓰기 없음. 수량변경 downstream은 기존 업로드 정책, 농장-only 금액/확정/날짜/주문 보존.
- 신규 회귀8개, 기존 전체 ERP 계약(pre/core/post), dnSpy, manifest210, ERP쓰기 스코프 통과. 1920/390 실제 headless Chrome fixture에서 카톡입력/하이라이트/맞춤·확대축소·100%/다운로드/입력수정 후 검증무효화/합계오류 차단 통과. 브라우저 API는 전부 fixture 차단, 운영쓰기0.
- 최신master 병합 후 대상회귀/manifest/쓰기/dnSpy 재통과. 최종 병합빌드·PR/CI·Cafe24배포·운영브라우저·실제 Excel 인쇄 미리보기는 이 기록 시점 미검증, 후속 확인.
검색어: 농장분배 카톡 물량표 통합검증 원본엑셀 인쇄배율 빈셀 확대축소 재업로드 farm-text-excel

## 2026-11-10 출고일 세부차수 비교·메인차수 총수량
- 실제dnSpy FormShipmentDistribution 재추출/운영SELECT 확인후 같은명시연도·메인01~04·Master업체/품목별readonly batch조회. 날짜머리글1회/실재세부차수별행·소계/우측메인총량. 선택차수만기존canonical DateEditor로입력·저장,다른차수조회전용. 단·송이공통정수환산,중복/NULL/범위/합계/입수stale불일치확인안내. Get원본차수내장연도대조로충돌/누락400. 기간문구/중복합계제거·상단여백축소·단축키안내접기.
- 실제2026/45=1246조합전부정합/복수123,2025/45=1376중1355정합/복수95/기존불일치21은확인안내·보정0. 개발production API6조회/연도경계3검사 전부DB일치. 합성15단+30단=45단,선택01만.4/.6저장/02소계30유지,Tab/Enter저장0/390가로스크롤합계접근/날짜·입수stale/교차연도빈차수/독립탭PASS.
- pure/GET연도/가이드6단계5test PASS, 실제격리MSSQL major37-01/02·2025동일99·다른38차·NULL상세업체범위PASS, date-only견적15단/gross172500/ECOUNT XLSX/gate/lease/rollback/원장보존PASS. npm ERP전체exit0/dnSpy/manifest212/writeguard1API/finalwebpack1workerbuild exit0.
- 가이드175.95초/6업무단계/24조작위치,실제1920x1080/100%·번호/한국어자막/목차/부드러운zoom/out 갱신. 첫/중간/끝5프레임직접확인,최종player1920/390·키보드역할/목차·실재생/VTT/다운로드2/접기정지PASS. 운영ERP쓰기0. CI/PR/배포/운영실브라우저는이기록시점미검증.
검색어: shipmentMajorInlineDates 45-01 45-02 메인총수량 15단30단45단 번호가이드175초 readonly형제차수
## 2026-11-10 수입부 수정 최종 로컬 게이트
- 최신f9ecb7fd 병합 후 ERP전체exit0/dnSpy/manifest212/쓰기guard1API/정식npm build1worker PASS. 관련가이드3개 실Chrome·합성원본 촬영: 매칭73.3초/입고수입435.45초/영업지원278.85초, 번호·입력·체크·결과·줌. 첫중간끝 프레임 및 PC1920/모바일390 실제재생/역할/목차/자막/접기정지 PASS. 숨은타가이드 목차 중복검사 테스트범위 정정.
- 운영입고·재고·원가 변경0/추가유료AI0. NL46 실제입고→현재FX/관세 XLSX와 TH38 시험비용 XLSX 구별. 모든국가 실파일 전체E2E 미완료. PR/CI/운영배포 후속.
- 추가사용자요청: 과거43-1/43-2/44-1 누적시트 보존 및 엑셀 내부입력 연쇄재계산. TH파일 환율연결정상/상품단가G15미전파/수량F15분모만변경 재현. 별도미완료로기록, 해결완료로보고금지.
검색어: import-repair-release 수식부분끊김 누적과거시트 TH38 G15 F15 guide435 278

## 2026-11-11 출고내역서 샘플 품목 표기
- 사용자 샘플원본 실제셀 확인: 카네이션/돈셀, 실제Product 구조화분류/영문별칭 SELECT 근거후 엑셀 전용표시 helper 추가. 국가+품종 → 품종만, 분류/영문별칭 정리 → 돈셀. 원장·원본명·저장본·품목키·수량·단가·날짜·그룹변경0.
- 25대상회귀PASS: 전체분류경계/China Girl·Sweet Rose/원래품목명중간단어/60cm·XL·색상·포장·unknown한글괄호보존/빈값방지/양연도저장본불변·XLSX재열기. 필수전체검사/빌드/PR/운영배포미검증,후속.
검색어: 출고내역서 샘플표기 카네이션 돈셀 shipmentStatementLabels 영문별칭 Excel전용
2026-11-11 수입부 확인 출력물의 품종 숨김, 품명·농장 폭과 줄바꿈 조정, 체크 칸 축소. 카톡 원문 일시만 표시, 소량 단독 메모 숨김. 45차 원문 형식 조회, Excel 실제 PDF 출력 검증.
검색어: 수입부 확인 인쇄 품명 농장 카톡 원문시각 소량
- 최종로컬:전체ERP(pre/core/post)exit0,dnSpy/manifest213/쓰기0API/layout/workflow11업무12영상/webpack PASS. 실제생성XLSX Artifact렌더 카네이션/돈셀·기존스타일·3박스11500원·합계 확인. PC1920/390 실제Chrome 저장/복원/엑셀/묶음/즐겨찾기/키보드/가이드player PASS. UI/업무순서/영상화면변경0이어서 가이드재촬영해당없음. PR/운영배포미검증,후속.
검색어: 샘플표기 최종25검사 카네이션 돈셀 원장변경0

## 2026-11-11 입고관리 원장삭제 수입부 권한 복구
- 최신 origin/master 별도 작업트리. warehouse POST/PATCH/DELETE의 부서명 정규식 판정을 기존 canManageInvoiceReceipt로 통일. 부서명 빈값의 Authority4/7을 허용하고 identity누락·비활성·타부서는 DB 접근 전 차단. SQL/삭제/재고계산/확정차수 정책 변경0.
- 실제 dnSpy FormWarehouseView.btnDelete_Click 및 운영 SELECT-only 확인. 활성 권한4 계정4개 모두 DeptName 빈값, 2025/2026 동일44-01 원장54/50건. 계정정보 저장0, 운영 삭제0.
- 신규 실제handler 회귀5개(양연도/권한/확정409/POST·PATCH), 기존 수입권한10개, ERP전체 pre/core/post, dnSpy, manifest, 쓰기guard 통과. 빌드/PR/CI/운영배포·로그인 후 브라우저는 이 기록시점 미검증, 후속 확인.
검색어: 입고관리 원장삭제 수입부 권한4 권한7 DeptName 빈값 canManageInvoiceReceipt warehouseAccess
- 추가검증: 로컬 npm build(webpack,1worker) exit0. 빌드 생성 이력파일은 변경 범위에서 제외. PR/CI/운영배포 후속.
## 2026-11-11 도착원가 수식 연결·과거 시트 보존
- 비교 계산표 고정 수량/상품금액을 원본 입력에 연결, SUMPRODUCT 합계/TH 그룹수량/중량·운임 참조, 추정 통관비 원본수식+초기차이 분리. 승인 스냅샷·실제 청구 합계는 보존.
- Excel COM 전용·매크로차단·링크갱신0: 11양식 수량/단가/환율→원가/총판매가/총이익 변경 PASS, 수식오류0. 실제 NL원본61탭+현재3탭=64 Excel 열기/재계산 PASS. 원본 덮어쓰기0.
- private 파일 이력은 권한 있는 SHA검증 원본으로 시작, 계정/연도/국가/운송/통화/양식 분리·원자 포인터/잠금·중복 방지·원본 ACL 철회 확인. 원본 없는 과거 차수는 복원 불가/이후부터 누적. 모든 과거 파일 복원 또는 운영 실비 검증 완료로 보고 금지.
- 탭 선택 상태만 해제해 과거·현재 그룹편집 방지(SelectedSheets=1). 셀 데이터/수식/서식은 보존, 이전 차수 재다운로드는 중복 시트 없이 해당 계산 탭 선택.
- ERP전체/dnSpy/manifest213/쓰기guard4API/webpack1worker빌드 PASS. 신규 UI 단계 없음/기존 가이드 유지. CI·배포는 PR 실행 결과 확인. 운영 DB·유료AI 쓰기0. 세부기록 docs/work-sessions/2026-11-11_cost-links-history.md.
검색어: cost-links-history ExcelCOM 11양식 과거61탭 SUMPRODUCT TH G15 F15 private-history

## 2026-11-11 물량표 DB 품목 왕복·실파일 인쇄
- 사용자 실파일 두 개에서 fileBasedScope 품목 미매칭 재현(장미11표기, 카네이션MixBox). exporter volumeProdLabel 정확 표시명 인덱스로 수정, 실DB SELECT preview 품목미매칭0/수동품목선택0. 국가/품종·숫자길이·Mini/MC/Elite·중복검토·명시키 검증 보존. 교차연도 회귀 통과.
- 웹 실제 카네이션 다운로드 Excel COM ReadOnly 출력: 원본/적용본 A3세로1쪽·기존2009단어 좌표불변·빈상단메모만추가. 행열여백/그림XML 보존. 장미적용본/수정본재업로드/CI·배포는 진행중 미검증. 운영ERP쓰기0. 세부 docs/work-sessions/2026-11-11_farm-roundtrip-proof.md.
검색어: farm-roundtrip-proof DB품목미매칭 volumeProdLabel Brighton50 MixBox Mini MC Elite ExcelCOM 실제인쇄
- 후속 실파일검증: 수량4→5만 바꾸면 농장합계차단, 농장5동기수정·업체꽃길→알파는 통과/재다운로드 메모중복0. 수정본ExcelCOM도 A3세로1쪽·의도수정외 위치불변. DB실농장 엘리떼/티바/바리에타 정확표기 변형보완,17회귀PASS. 품목기준전체게이트PASS,최종별칭포함전체/CI재실행.
- 추가사용자요청: 출고일빨간글씨누락. 샘플날짜·요일부분rich-text FFFF0000 확인, 기존writer누락을제목셀OOXML한정처리로보완. nativeExcel readOnly Font.Color 접두사0/날짜255 및nativePDF실프레임PASS. 26대상회귀+전체ERP(pre/core/post)exit0,dnSpy/manifest213/쓰기guard/workflow/webpack PASS. 최신5505f31da의무관한도착원가변경병합,최종CI·운영배포미검증후속. 원본명/수량/단가/날짜값/저장본/ERP변경0.
검색어: 빨간출고일 rich-text FFFF0000 CFB NativeExcel26 카네이션 돈셀
## 2026-11-11 출고분배 메인차수 공통 행 정정
- 업체/품목별 실재차수만 표시해02만 보이던 원인 정정. 같은연도·메인차수 전체majorDateFacts에서공통01/02/03축을공유,어느세부차수에서도동일행. 부재0은화면전용/실제0과구별/둘다편집0,실재선택양수만기존canonical날짜저장. 실제행만합계. 날짜머리글표열상단1회/빈비활성7입력제거. SQL/API/writer변경0/운영ERP·ECOUNT쓰기0.
- dnSpy설치EXE재추출·수국운영SELECT선확인. helper6,실제Chrome선택01/02/03×다른업체/품목·부재/실재0·공통머리글·1920/390·Tab/Enter·selected-only저장PASS. 격리MSSQL date-index/writer·견적15단/gross172500/ECOUNT XLSX·원장보존PASS. 전체ERP/dnSpy/manifest213/writeguard0API/finalnpmwebpack1worker PASS. SSRfixture새import/Header연결누락보완후전체재실행exit0.
- 가이드176.7초/6단계/24조작,첫·중간·끝5프레임/최종player실재생·한국어VTT·목차/다운로드2/1920·390 PASS. 최신master491669ca 병합(별도불량차감인쇄6파일,출고소스불변); PR CI가병합상태재검증. PR·Cafe24·운영브라우저는이기록시점미검증,후속기록.
검색어: majorInlineWeekScope commonWeeks 45-02만표시 공통01 02 03 표시전용0 공통날짜머리글
- 장미Excel실인쇄에서 기존텍스트상자6개가 빈첫행메모를 가리는 것을 발견해 원본drawing관계/앵커 점유범위를 피하도록 수정. 상대경로/반복내보내기/알수없는앵커 차단 회귀추가. 실제장미10단(마티나6+엘리떼4)→원본1076단어위치불변/A3세로1쪽·신규메모우측표시. 최종전체/CI재실행예정,운영쓰기0.
- 최종18회귀/전체ERP/dnSpy/manifest/writeguard/1worker빌드exit0. 장미10→11합계차단·농장6+5/업체일신동기수정통과·메모중복0·수정본ExcelCOM1쪽 유지. PR1674 CI/배포/운영웹 최종검증 진행.

## 2026-11-11 데스크톱 홈 PM 라이브 상태 표시
- 요청 화면은 웹 브라우저가 아닌 Nenova Desktop 홈. origin/master worktree `C:\Users\USER\nw-pm-home-live-1111`에서 구현, 기존 checkout 변경은 보존.
- 헤더 빈 영역에 빨간 outline PM panel·활동·수신/생성 시각·`/pm` 열기. 메인 프로세스 고정 GET `/api/pm/office`, 로그인 세션 전용, 60초 폴링. age<=180초+유효 PM agent일 때만 live/active, 오래됨·누락·오류는 지연/확인불가. 계정전환 stale response 제거. 조회 폴링 감사 로그 미기록. ERP API/DB/업무 메뉴 변경0.
- PM classifier 5/5, Desktop 전체 45/45, Electron smoke·restore·exit·updater 무결성 PASS. 실제 Electron 캡처에서 빨간 테두리/PM 라이브/1920·1024·800 레이아웃 확인. Desktop 1.3.18 Windows NSIS 설치기 빌드 exit0, ASAR helper 포함 확인. updater 초기 실패는 재실행 시 미재현.
- GitHub PR/CI·master 병합과 installer release/사용자 PC 설치는 미검증. ERP 웹·운영 DB·업무 메뉴는 변경하지 않음.
- 세부 Q&A: docs/work-sessions/2026-11-11_pm-home-live-highlight.md
검색어: pm-home-live-highlight PM 라이브 heartbeat pm-office 빨간박스 desktop smoke
## 2026-11-11 출고분배 농장정보 업체검색
- 농장정보 탭의 선택 품목 업체 분배표 제목 옆에 업체명 필터를 추가. 기존 검색 normalizer 사용, 현재 품목 조회 행만 표시 필터, 1/2개수 안내. 검색은 ERP 조회/원장/선택/초안/합계 변경 없음.
- 실제 설치 Nenova.exe dnSpy FormShipmentDistribution/FormEstimateView 재추출 성공: 양쪽 탭은 같은 DistributionDateEditor/API 경로. 날짜 저장은 ShipmentDate의 날짜별 배분 및 대표 ShipmentDetail.ShipmentDtm 갱신; 견적 인쇄/Excel은 DetailFix=1, 양수 EstQuantity, 정확 ShipmentDate.ShipmentDtm=PeriodDay.BaseYmd에서 날짜 표시/수량 반영. 총수량/견적수량/총매출/Amount/Vat 합계 및 Estimate 원장행 보존. 확정/정확달력 조건 미충족 건은 견적에서 제외될 수 있음.
- 회귀 browser 검색 1/2행·48.00 총합 보존, date-index/Date SQL isolated suite PASS. ERP 계약/dnSpy/manifest213/writeguard0API/webpack build PASS. 합성 API 가이드 184.9초/6단계/1920×1080 재녹화, first-middle-last frame, Chrome MP4+VTT+목차+모바일 player PASS. 운영 DB 쓰기0.
- PR/CI/Cafe24/운영 브라우저 스모크 최종 결과는 배포 후 후속 기록.
검색어: farm-customer-search 농장정보 업체검색 DistributionDateEditor ShipmentDate GetPrintDetail GetExcelDetail PeriodDay
## 2026-11-11 견적서관리 품목·비고·인쇄 정정
- 품목 열을 넓히고 표 가로 스크롤 및 수량/단가/공급가액/비고 헤더 고정. 비고 셀은 버튼으로 기존 품목 수정창을 열어 기존 EXE 호환 저장 경로를 사용한다. 1박스 초과 정수 환산만 `250단(5)`/`60송이(2)`로 화면·견적 인쇄에 표시하며, 1박스 이하·소수 박스는 생략.
- dnSpy FormEstimateView/ReportEstimate 재추출: ReportEstimate의 합계는 최종 GroupFooter이며 웹 기본 견적서는 표 중간 tfoot을 제거하고 마지막 문서 합계 한 번만 출력. native 인쇄의 품목/적요 줄바꿈 및 자동행높이·반복 thead로 2~3쪽 상단 품목 잘림을 보완.
- 추가 견적관리 가이드 23.1초 및 출고일 매출 기존 가이드 재녹화: 둘 다 fixture-only, 1920×1080/100%, 한국어 VTT·목차·재생 검증, ERP 쓰기0. 표적 print typography/contract, ERP contract, dnSpy evidence, manifest213, write guard, workflow guide, webpack build PASS. 운영 브라우저/CI/배포 미검증.
검색어: estimate-management 비고수정 boxQuantity 마지막합계 ReportEstimate GroupFooter sticky header print-page

## 2026-11-12 정본(판단 기준 한 곳) 연결 — 규칙 파일 실측·충돌 표시
- NOWLINK 기획 대화의 "규칙 3층(정본·주입·검증)" 설계를 저장소·PC 실물과 대조. 정본=docs/canon/CANON.md(판단 우선순위·사고 순서·반드시 지킬 것 4·규칙 충돌 순서·규칙 담당 파일 표·수정+왜 기록 형식). 루트 CLAUDE.md 가 @docs/canon/CANON.md 로 자동 불러오고 AGENTS.md·.claude/CLAUDE.md·.cursor/rules/canon.mdc·agents/README 가 경로를 가리킴. 내용 삭제 0, 부딪히는 문장 5곳에 "정본 참조" 표시만.
- 학습 기록(~/.claude/persona)과 안 맞는 "하드코딩 탈피·확장성·네 기준의 순서·다른 회사 비교 단계"는 정본에 "확인 필요"로 분리. .nowlink/ 폴더·rules.json 은 만들지 않음(persona/rules.json 과 중복).
- 신규: docs/canon/why-log.jsonl(예시 3건), RULE_FILE_INVENTORY_2026-11-12.md(전수표·충돌 15건·정본 13절 구현 현황), BACKLOG.md(자가성장 7단계 현황·HR·레이더 출처), .claude/agents/nenova-pm.md(초안), scripts/check-canon.cjs + npm run test:canon + erp-contract.yml 단계. 검사는 형식만 봄.
- 미검증: Codex·Cursor 가 "작업 전 정본 읽기" 문장을 실제로 따르는지, PC PM 조사관이 저장소 CLAUDE.md 를 읽는지. PC 전역·nenova-pm·바탕화면 파일 수정 0, pages/·금액·재고·차수 로직 변경 0.
검색어: 정본 CANON why-log check-canon test:canon 규칙충돌 xlsx-js-style 금지 사용가능 nenova-pm 에이전트 초안 자가성장 백로그
- 후속(사장님 결정 2건, 같은 수정안 #1685): ① 작업 기록은 WORK_MEMORY.md 한 곳으로 통일 — AGENTS.md "세션 Q&A 백업"을 "작업 기록 (기본)"으로 바꾸고 .claude/CLAUDE.md 의 PROGRESS/PLAN 갱신 규칙에 "옛 방식" 표시. 긴 세부만 docs/work-sessions 에 두고 WORK_MEMORY 에서 가리킴. PROGRESS.md·docs/work-reports 는 새로 쓰지 않음(지난 기록 보존). ② Cursor 미사용 — .cursor/(규칙 3·스킬 1)와 .claude/tasks/_COMPLETION_REPORT_TEMPLATE.md 삭제, SOLUTION_LINK·정본·검사 스크립트에서 Cursor 항목 정리. why-log 2건 추가, 규칙 승격 조건을 "이유를 직접 말했거나 사장님이 정한 것"으로 보정. PC 의 Cursor 프로그램·설정은 건드리지 않음.
검색어: WORK_MEMORY 통일 작업기록 한곳 Cursor 미사용 .cursor 삭제 완료보고 틀 삭제

## 2026-11-12 출고분배 여러 업체 입력 후 일괄 저장
- 추가한 주문 없는 업체행이 거래처 검색·출고일 표시 필터에 숨는 경로를 보완. 여러 업체를 연속 추가하고 수량을 유지해 한 번 저장하는 기존 batch 경로 사용. API/SQL 변경0, 0수량 주문 생성0.
- 실제 Chrome 빌드 화면에서 업체777/888에 5/7 입력 유지, 중간저장0, 양수 주문2건 선등록 후 단일 분배요청에 두 업체 수량 포함 PASS. 전체 ERP계약·dnSpy·manifest213·쓰기guard0API·webpack PASS. dnSpy 실제 FormShipmentDistribution 재추출. 운영ERP쓰기0.
- 격리 downstream SQL은 Docker daemon 미기동으로 미검증. 운영 배포·가이드 최종검증 후속 진행.
검색어: multi-customer-1112 업체연속추가 일괄저장 addedNoOrder farmCustomerSearch farmDate

## 2026-11-12 출고내역서 엑셀 품목 표시명 직접 수정(매칭)
- 사용자요청: 출고내역서 표의 품목·규격 칸에서 바로 입력해 엑셀 품목 표시를 수정, 한 번 수정하면 유지. 최신 origin/master 별도작업트리 feat/shipment-statement-item-label-edit, PR #1684.
- 구현: ProdKey별 표시명 파일(data/runtime/shipment-statement-labels), POST /api/shipment/statement?action=label, 엑셀·미리보기에만 적용, 빈 값=자동명 복귀. ERP/작성본/sourceHash 변경0.
- 검증: shipment-statement 단위 31 PASS(신규3), guard:erp-writes·dnspy-evidence·erp-contract-manifest(213)·test:ui-layout PASS. 계약 scope에 신규 파일 등록(처음 누락→manifest 실패→수정).
- 추가 검증: 정식 npm run build(영상 게이트 통과), 실Chrome 합성 fixture 1920/390(입력·유지·엑셀 반영·드래그), 가이드 6목차 재촬영·플레이어 재생 PASS.
- 미검증: 운영 화면 실조작, 서버 배포의 data/runtime 보존(머지 후).
- 검색어: 출고내역서 품목표시명 매칭 inline edit shipment-statement-labels

## 2026-11-12 출고내역서 원본 변경 알림 개선
- 저장 후 원본이 바뀌면 바뀐 항목(수량·단가·추가·삭제·품목정보·업체·달력)을 목록으로 알리고, 안 바뀐 품목의 요일 배분은 유지(lib/shipmentStatementChanges.cjs). 수량이 배분 합계보다 줄어든 품목만 배분 초기화. ERP 쓰기 없음.
- 검증: 단위 37 PASS(신규 6), 실Chrome fixture·가이드 재촬영·플레이어 PASS, guard 3종·ui-layout PASS. 미검증: 운영 실데이터.
- 검색어: 출고내역서 원본 변경 stale changes reconcile

## 2026-11-12 정본 백로그 D절 정리 — 옛 기록 표시·충돌 문장 실제 정리·PC 전역 제안·수정 기록 소급 수집
- 요청: 사장님 "백로그 전부 병렬 작업" 중 docs/canon/BACKLOG.md D절(다른 세션이 A·B·C절 담당).
- 옛 기록: .claude/PROGRESS.md·.claude/PLAN.md 맨 위, docs/work-reports/README.md(신규)에 "2026-11-12부터 새로 쓰지 않는다, 기록은 WORK_MEMORY.md" 표시. 읽기·쓰기 지시 문장을 WORK_MEMORY.md로 고침(.claude/CLAUDE.md 체크리스트 2·3번·종료 규칙·복구 프롬프트, NENOVA_WEB_MASTER_ISSUES 3곳, REGRESSION_PREVENTION_GUIDE 1곳, work-sessions/README 1곳). docs/work-reports는 계약 9·테스트 기준값 3·스크립트 1이 경로를 가리켜 옮기지 않음.
- 낡은 문서: PROJECT_STATUS.md·SOLUTION_LINK.md 맨 위 "옛 기준" 표시(내용 유지).
- 충돌 문장 실제 정리 4건: xlsx-js-style 금지 문장 제거→루트 CLAUDE.md "사용 라이브러리" 신설, push "명시 요청 시만"→AGENTS.md 기준(.claude/CLAUDE.md·nenova-orchestrator), "단일 진실 소스"→담당 파일 문장, repairMissingCustKey 수리 행을 루트 CLAUDE.md→AGENTS.md "작업 전 필수 확인"으로 이동. 정본 4절·5절 표와 실측 기록 머리말 갱신.
- 메인 작업 폴더 전용 규칙: .claude/rules/insight-agreement.md(4줄)만 본편에 넣음(내용 동일). insight-requirement-review·insight-button-evidence 스킬과 .agents 사본은 판단 보류로 넣지 않음.
- PC 전역 충돌 6건: 고치지 않고 docs/canon/PC_GLOBAL_RULE_FIX_PROPOSAL_2026-11-12.md 에 파일·줄·바꿀 문장 제안.
- 소급 수집: 최근 90일 fix 734건(전체 2,211건) 제목 낱말 분류 → docs/canon/FIX_HISTORY_BACKFILL_2026-11-12.md, why-log.jsonl 에 candidate·why_source unknown 8건.
- 검증: npm run test:canon 통과, menuDevelopmentDefaults·nenovaWebCompatibilityScope 검사 통과(AGENTS.md를 읽는 검사). pages/·lib/·DB 변경 0.
- 미검증: 메인 작업 폴더가 본편을 받을 때 같은 이름 미추적 파일로 막히는지, Codex가 바뀐 문장을 실제로 따르는지, 소급 분류의 정확도(제목 낱말 근사치), PC 전역 제안의 실제 적용.
- 검색어: 정본 canon 백로그 D절 옛기록 PROGRESS PLAN work-reports README PROJECT_STATUS SOLUTION_LINK insight-agreement PC전역 제안 stash 이카운트 예외 maxPerDay PERSONA 소급수집 why-log candidate backfill

## 2026-11-12 HR 에이전트(초안) — 온보딩·인수인계 문서
- 사용자요청: 백로그(docs/canon/BACKLOG.md B절) HR 에이전트를 병렬 작업으로 진행. 원칙 "사람을 평가하지 않는다. 성장과 업무를 돕는다".
- 신규: .claude/agents/nenova-hr.md(온보딩·인수인계만, 채용 행정·성장 지원은 범위 표만, 제외 기능 4가지와 이유, 평가·등급·보상·징계·합격 여부 다루지 않음), docs/hr/ONBOARDING_FIRST_WEEK.md(주문 등록→발주→입고→분배→출고→견적 순서로 기존 화면 주소·가이드 영상 13개·매뉴얼 초안 연결, 없는 곳은 "가이드 없음"), docs/hr/HANDOVER_TEMPLATE.md(인수인계 틀, 내용 비움).
- 변경: scripts/check-canon.cjs 진입 파일에 nenova-hr.md 추가(5→6개), .claude/agents/README.md 한 줄 등록, BACKLOG B절 "만든 것 / 아직 안 만든 것" 표.
- 측정: 온보딩=가이드만 보고 첫 주문 등록을 끝낸 시간, 인수인계=문서만 받고 대신 처리한 업무 수. 둘 다 기준값 없음(잰 적 없음).
- 미검증: 실제 새 직원·실제 인수인계에 써 본 적 없음. 새 직원이 가이드만으로 웹에서 첫 주문을 등록할 수 있는지(주문 등록 화면 6개 중 영상 1개). 수입부 인수인계 내용은 별도 작업 소관이라 쓰지 않음. pages/·영상·금액·재고·차수 로직·DB·PC 전역 폴더 변경 0, 직원 개인 데이터 수집 0.
- 검색어: HR 에이전트 nenova-hr 온보딩 첫주 인수인계 틀 가이드 없음 ONBOARDING_FIRST_WEEK HANDOVER_TEMPLATE 기준값 없음

## 2026-11-12 기술 레이더(/pm/radar) — 찾은 곳·이미 사용 중·재평가·시험 후보(대기) 꼬리표
- 배경: 수집기(nenova-pm/github-radar/radar.js)가 2026-11-12 부터 항목에 sourceLabel·inUse·resurfaced·actionLlm 을 덧붙인다(모두 선택 필드, 실제 데이터에는 11/16(월) 07:30 회차부터 들어옴). 화면이 이 필드를 안 쓰고 있었다.
- 변경: pages/pm/radar.js — 카드에 꼬리표 줄(📍 찾은 곳 / ✅ 이미 사용 중 / 🔁 재평가 / ⏳ 시험 후보(대기)), 펼친 상세에 설명 줄(다시 평가한 이유·시험 대기·이미 사용 중·찾은 곳), 시험 결과 줄에 판정(verdict)·보고서 위치(reportPath) 추가. 필터 "찾은 곳"·"이미 쓰는 도구 빼고 보기" 는 보는 회차에 그 정보가 있을 때만 나온다. 새 필드가 없는 예전 항목은 꼬리표 줄 자체가 없다(기존 표시 그대로). "GitHub 에서 보기" 문구 유지.
- 확인: 업로드(lib/workFeatureData.js saveFeatureFile)·조회(pages/api/pm/radar.js)는 받은 JSON 을 그대로 저장·전달하고 필드를 걸러내지 않는다. docs/contracts/pm-tech-radar.json 은 필드 목록이 아니라 범위·검증 명령 계약이라 고치지 않았다. __tests__/pmTechRadar.test.js 에 꼬리표 문구·원본 그대로 통과 단언 추가.
- 검증: 로컬 실행본에 실제 tech-radar.json(3회차 53건, 읽기만) + 새 필드를 넣은 가상 회차 1개를 올려 화면 확인 — 새 회차 꼬리표 5종·필터 동작, 예전 회차는 꼬리표 0줄·필터 미노출.
- 미검증: 11/16 실제 회차 데이터로는 아직 못 봄(그때 처음 들어옴). 운영 배포 후 화면 확인. 모바일 폭 화면.
- 검색어: 기술 레이더 radar sourceLabel inUse resurfaced actionLlm 찾은 곳 이미 사용 중 재평가 시험 후보 대기 꼬리표 pilotResult verdict reportPath
## 2026-11-12 자가성장 루프 다시 돌리기(PC persona) — 백로그 A절 "멈춤" 해소
- 사장님 지시 "백로그에 미뤄 둔 것 전부 작업". 대상은 PC 전역 `~/.claude/persona`(저장소 밖). 저장소는 docs/canon/BACKLOG.md A절 상태와 이 기록만 수정. 코드·DB·훅(prompt-guard 등)·nenova-pm·.codex 변경 0. 백업 `~/.claude/persona-backup-20261112`.
- 다시 돌림: distill.js 보강(처리 표시로 새 것만·업무 영역 묶기·나눠서 전부 처리) → 사람 마찰 142건/18묶음 → 새 원리 후보 45건(승인 대기, rules.json 지문 불변). 주간 작업 OrbitPersonaWeekly(일 05:30) 등록·수동 실행 종료 코드 0. 프로파일(PERSONA.md) 자동 재작성은 꺼 둠.
- 측정: 60일간 안 불린 규칙 0/41. 부딪힘 의심 쌍 66(함께 걸린 적 27, 목록만). 기준값 처음 171/191=89.5% → 집계 바로잡은 뒤 257/295=87.1%(규칙 안 얹힌 지시의 다음 지시 무마찰, "처음 보는 유형"은 가설). 승인 목록 persona/data/approval-list.md.
- 발견: turns.jsonl "사람 지시" 30일 1,299건 중 826건이 로봇(워커) 지시문 → 매일 나오는 마찰률 수치가 섞인 값.
- 후속(사장님 "고치고 보완까지"): mine-sessions.js 수정 — 로봇 지시문 1,193건 제외 + 앱 안내문(system-reminder)이 앞에 붙어 통째로 빠지던 사람 지시 158건 복구. 사람 지시 1,355→690건, 사람 세션 868→56개, 마찰률 12.55%→14.06%(97/690). 파일 분류(robot)는 넓히지 않음(robot 은 10분 뒤 삭제 대상이라). 세는 방식 변경은 report.md 머리와 data/metric-changes.jsonl 에 표시. 보완: 규칙 장부에 "거의 로봇에만 얹힘 11개·사람 지시엔 드묾 11개" 표시, 승인 목록을 7계열로 묶고 계열별 대표 번호 제시. rules.json 지문 불변.
- 미검증: 일요일 새벽 자동 실행(로그인 상태에서만 돎, 11/15 이후 확인), 후보의 "근거 반복 건수"(AI 주장), OrbitPersonaVerifyDaily 11/12 비정상 종료 코드 원인.
검색어: 자가성장 루프 distill OrbitPersonaWeekly 원리후보 45 approval-list baseline 257/295 mine-sessions 로봇제외 system-reminder 복구 metric-changes rule-conflicts robot-sig 로봇지시 섞임

## 2026-11-12 출고분배 카톡 추가·취소 패널 및 격리 DB 검증 진행
- 사용자확정: 카톡은 추가·취소 요청 포함 원문만 분배페이지에서 조회. 운영시험쓰기 금지·격리DB에서 여러업체 실제저장/재조회/견적/ECOUNT출력 검증 요청.
- 작업트리 nw-distribution-kakao-1112, a5630ec10 기준. DistributionKakaoFeed 신규(기존 order-feed?n=60 GET만, 추가/취소 포함block 표시·원문검색), 오른쪽300px/1400이하하단, 표수량50px/셀여백2px. API/ERP writer변경0. SSR loader 신규component연결.
- 전체ERP계약로그 실패0, dnSpy/manifest213/writeguard0API PASS. Chrome합성API 일반주문제외·추가/취소표시·기존2업체5/7단일저장회귀 PASS, clean webpack build exit0. 가이드 clean녹화 session83776 진행. 아직 PR/배포0.
- Docker4.77 stale AF_UNIX dockerInference Windows1920 재시작반복실패. 정확Docker PID종료, 실행용run만 run-backup-20261112-0705로 보존Rename(데이터/VHD변경0), 새소켓도실패. 사용자요청으로Docker포기. Microsoft공식SqlLocalDB2022 MSI 다운로드·Microsoft서명Valid, silent설치1603 관리자그룹아님. 사용자 직접설치하겠다고응답, 현재160/LocalDB/Binn/SqlLocalDB.exe 미존재. 운영DB접속/쓰기0. 외부tools prefix에msnodesqlv8준비(ODBC18존재).
- 미완료: LocalDB설치대기→전용격리instance/harness구성→실제다중저장·재조회·XLSX검증, 가이드최종·필수게이트·PR·배포·운영확인. 사용자 모든완료전최종응답금지.
검색어: distribution-kakao-1112 LocalDB1603 dockerInference1920 추가취소원문 39329 guide83776 msnodesqlv8
- 후속: 사용자LocalDB설치완료(160/Tools/Binn), 전용NenovaErpFixture16인스턴스실행. test-distribution-localdb --multi-save --browser-refresh PASS. 실제Chrome저장1회→테스트API어댑터→격리SQL수량5/7→새페이지SQL조회5/7유지→native견적2행/ECOUNT150·210→실제estimate.xlsx/ecount.xlsx재열기2행. 운영API handler 자체 DB통합검증은 아니며 production writer 변경0. Docker run백업보존/원장쓰기0. clean빌드·정식build·가이드186.45초/workflow13/14 PASS. 카톡일반주문제외·추가취소표시·기존단일저장회귀Chrome PASS. outputs/distribution-multi-save 엑셀2파일. PR/배포후속.
## 2026-11-12 지시 보완기 보완 + 원리 후보 2건 편입(PC persona)
- 사장님 지시: "지시보완기가 작동 안 했다는 얘긴가, 보완해야지" + 후보 57번 "후속진행을 하되 롤백만 가능한 구조로, 결과값 변경 없는 선에서" + 52번 "도구는 상황에 맞게". 저장소 밖 작업(~/.claude/hooks/prompt-guard.js, ~/.claude/persona/rules.json), 저장소는 이 기록과 백로그 A절 6단계만.
- 실측: 사람 마찰 62건 중 59건이 관련 규칙이 이미 얹힌 세션에서 발생, 44건은 얹은 지 3턴 넘게 지난 뒤. 4개 상한에 잘린 지시는 13/156건.
- 수정: 같은 규칙 재매칭 시 6턴 뒤 한 줄 다시 상기(최대 3), 지적 문장이면 세션에 얹었던 규칙 다시 확인(최대 3), 지시 앞 system-reminder 안내문 떼고 판정, guard-log 에 again·friction 칸. 시험 폴더 9턴 시험 통과(7턴째 다시 상기, 8턴째 지적 확인).
- 편입(사장님 결정): follow-up-reversible(과하게 걸림 3.9%), design-tool-fit(0.4%) → 규칙 41→43.
- 추가 편입(사장님 승인 7건: 후보 41·46·47·48·51·56·70) → 규칙 50. 문장은 그대로, AI가 지은 트리거는 흔한 낱말(단·표·색 등)을 빼고 좁혀 넣음(1.6~10.6%). 남은 후보 36건.
- 승인 목록 보완: 기계 검사만으로는 거의 전부 "특이사항 없음"이 나오던 것을, 기존 규칙과 뜻으로 대조하는 단계(candidate-review.js, AI 판정)·근거 약함·흔한 낱말 트리거 표시로 보강. 36건 판정: 새 내용 10 · 기존 규칙과 같은 말 17 · 후보끼리 같은 말 6 · 막연함 3.
- 미검증: 다시 상기가 실제로 마찰을 줄이는지(다음 주 baseline·마찰률), 지적 때 보여 주는 규칙이 실제 어긴 규칙인지(훅은 모름). 로봇 지시문에 규칙이 얹히는 것은 그대로.
검색어: prompt-guard 다시 상기 REMIND_GAP friction again follow-up-reversible design-tool-fit 지시보완기 보완 규칙 50 candidate-review 뜻대조 특이사항없음
- 후속(사장님 "거부 처리하고, 이런 부분도 자동으로 계속 고쳐 나가는 설계를 원했는데 왜 적용이 안 되나"): 후보 20건 거부(같은 말 17·막연 3) → 승인 대기 16. 원인 확인: 루프가 규칙만 키우고 루프 부품(집계·묶기·검사)을 점검하는 단계가 없어 오늘 결함 5개가 전부 사람이 발견. 보완: persona/bin/loop-health.js(자체 점검 11개, 주간 7단계, 찾아서 적기만) + 지시 보완기가 세션 첫 지시에 "고쳐야 함"을 한 번 알림 + 묶기에 기존 규칙 목록을 보여 줘 되풀이 후보 차단. 첫 점검: 고쳐야 함 2(일일 작업 종료 코드, 후보 되풀이 64%)·지켜볼 것 2.
- 미검증·한계: 찾기까지만 자동이고 고치기는 사람 승인 뒤. 겪은 종류의 결함만 잡음. 묶기 보완 효과는 11/15 실행에서 확인.
검색어: loop-health 자체점검 루프가 스스로 점검 후보 거부 20 distill 기존규칙 되풀이

## 2026-11-12 출고분배 실제 운영 API 격리 연결·카톡 내부스크롤
- 사용자요청: 테스트저장어댑터가 아닌 운영저장API로 격리검증, 카톡자동조회/읽기정리/카톡만스크롤. 작업트리 nw-distribution-real-api-1112,17e89a92기준.
- 운영 pages/api/orders/index.js·shipment/distribute.js·estimate/index.js를 SWC로 원문그대로로드. DB만전용LocalDB로연결·auth/actionLog외부경계는fixture처리. 실제Chrome업체534/535연속추가5/7→운영주문API201 verified2건→운영분배API200 verified=true insert2건→새페이지SQL재조회5/7→견적printDetail API2행·excelDetail API150/210→xlsx실파일재열기PASS. 운영API수정0/ERP운영접속0.
- 격리축약스키마 Product.Descr/PeriodDay범위·9/12달력/ShipmentDate자동키 누락 보완. 확정API/재고확정은이번시험범위밖, 견적읽기전fixture isFix만준비. API저장후원값은변경0. 결과로그 C:/Users/USER/nw-distribution-real-api-1112-current-pass.log, outputs/distribution-multi-save 엑셀2개.
- 카톡마운트자동GET, 기존block.text호환보존+messages원시ID/시각추가, 개별원문최신순·전체/추가/취소필터. panel sticky/maxHeight, 요청목록65dvh내부스크롤/overscrollContain/키보드초점. Chrome40메시지휠→page.scrollY불변PASS, 일반주문제외·메타데이터2건테스트PASS. 전체ERP/dnSpy/manifest213/writeguard1API PASS. 최종화면build성공,가이드session70942진행. PR/배포/운영후속.
검색어: real-api-1112 load-isolated-erp-api 실제orders distribute estimate LocalDB 내부스크롤65dvh 메시지최신순
- 완료검증: 새빌드39331에서운영주문API201×2/분배API200 verified2행 insert/새페이지5·7/운영견적printDetail2행·excelDetail150·210/실제xlsx2파일재열기PASS. 전체ERP exit0,카톡원문API단위PASS,Chrome40메시지내부휠 pageY불변PASS,정식npm build exit0. 가이드191.8초 first/middle/last직접확인,자동조회/내부스크롤설명포함. PR/배포후속.
## 2026-11-12 중국 물량표 고정 열·스크롤
- 단가/수량 컨트롤이 품목명을 덮지 않도록 셀 표시 순서를 분리. 표 상단 가로 레일과 표 좌우 이동을 동기화하고 표 오른쪽에서 세로 이동. 인쇄 레일 제외.
- 화면 표시 변경. 주문/분배/원장/수량 및 엑셀 계산 변경 없음. 넓은 편집표에만 세로 스크롤 예외 적용. 검증 결과는 세션 기록 참조.
- 검색어: china-scroll-1112 중국물량표 고정품목 단가겹침 상단가로스크롤
## 2026-11-12 자가성장 루프 자동 수정 단계(PC persona)
- 사장님 지시 "자동 수정까지". 저장소 밖 작업(~/.claude/persona/bin/loop-autofix.js 신규, loop-health.js 에 스크립트 고장 검사, weekly.ps1 7 점검→8 자동 수정→9 재점검, 지시 보완기가 무인 수정 내역을 다음 세션 첫 지시에 알림). 저장소는 이 기록과 백로그 A절만.
- 지키는 선: 사본 먼저 → 고침 → 검증(문법·다시 실행·규칙집 지문·후보 승인 상태 불변) → 실패 시 되돌림. 범위는 persona bin·lib 스크립트와 로봇 학습 서명 파일뿐(규칙집·훅·프로파일·승인 상태·nenova-pm·저장소 제외). AI 수정 실행당 2건, 바뀐 줄 10% 초과·크기 급변은 거부, 두 번 연속 되돌려지면 사람에게.
- 시험(일부러 고장): 문법 오류 1·실행 오류 1 심음 → 둘 다 탐지·각 1줄 수정·원본과 완전 일치. 오류 설명에 "파일 전부 삭제" 주입 → 따르지 않음. 22줄 삭제 → 수정안 거부, 더 나빠지지 않음. 정상 상태 주간 순환 실패 단계 0.
- 한계·미검증: 죽는 고장과 정해진 처방 3가지만 자동. 돌지만 숫자가 틀린 고장은 사람에게 넘김. 일요일 무인 실행은 11/15 이후 확인.
검색어: loop-autofix 자동 수정 사본 되돌리기 rollback script-broken robot-sig-learned 무인 수정 내역

## 2026-11-12 오늘의 내 업무 · 시간/바로가기 디자인
- 요청: 홈과 업무 메모장을 GPT로 디자인, 업무별 데스크톱 메뉴 또는 웹 링크, 매일 반복에 시간 지정·시간표 입력, 한 화면7~8개·좁은 PC 폭.
- fresh worktree nw-task-launch-design-1112 @17e89a92, branch codex/task-launch-design-1112. 기존 메모장/홈/개인업무 저장/IPC 확인. 운영 코드/API/DB 변경0.
- built-in GPT 이미지 시안2종 후 최종 코드 시안 폭320px·행51px·업무명12px/보조10px·8개노출. 홈/PC메모장/시간·바로가기 편집·시간표 빈슬롯 추가/완료 독립동작. docs/design/task-launch-1112 및 사용자 outputs HTML/PNG/설계·프롬프트/검증JSON.
- Chromium1920x1080/390px: 8개·폭320·필터·완료·바로가기 미리보기·시간표12:00추가·종료시간오류·Escape·가로넘침0·JS오류0 PASS. 실제앱실행/서버저장/동기화·운영반영 미검증, 디자인만 완료. 실제구현에는 시간/링크 저장모델+권한검증 IPC+버전배포 필요. 가이드/ERP게이트/빌드 해당없음(운영메뉴 변경없는 독립디자인).
- 메뉴기준 반응형·읽기밀도·페이지스크롤·키보드 적용, ERP원장/업로드/원장확인 해당없음. 계정전체주간1%→1% 동일reset1795064856, 작업단독비용 추정없음.
검색어: task-launch-1112 오늘의내업무 업무메모장 320px 8개 시간표 매일 바로가기 desktop notes

## 2026-11-12 오늘의 내 업무 · 승인 디자인 실제 적용
- 사용자 제안대로 적용 승인. 단일 작업자, nw-task-launch-design-1112. 홈 처음8개/시간표·빈시간추가, PC메모장 content폭320·행51px·8개·dialog추가수정, 기존고정/복사/알림/보관유지.
- startTime/endTime/shortcut을 기존 owner파일 CAS/원자성/멱등요청에 추가. 선택실행 즉시·반복은다음날부터, 전년도스냅샷/구형앱제목수정보존. 정규화 helper공유, 앱메인에서계정현재메뉴대조·웹http(s)확인·계정전환후거부. 이동=완료아님. ERP원장/SQL/API신설0.
- 실제저장/재조회/시간경계·누락/명시해제·교차연도·계정분리·CAS 회귀PASS. Chromium실제shell1920/800·notes320/280/390 8개·시간표·저장실패입력보존·충돌재조회재저장·Escape PASS. desktop unit47/47, native ElectronIPC메뉴탭실행·이동후POST0/계정전환·복원PASS.
- 정식 npm run test:erp-contract exit0(공식pre/post포함), dnSpy/manifest213/writeguard0API PASS. 57.6초실제Chrome연습가이드6단계·자막/목차·대상줌/최종프레임검토·해시등록, 페이지/desktop-guide·홈/메모장연결.
- Desktop1.3.19·다운로드링크갱신. 정식webpack1worker빌드 진행, PR/CI/설치파일공개/Cafe24배포/운영재생은 후속(미검증). 기록 docs/plans/task-launch-criteria-1112.md.
- 메뉴기준 적용: 읽기밀도/키보드/반응형/스크롤/뒤로가기/오류입력보존/가이드. ERP업무키·원장쓰기·전산probe 해당없음(동작은개인JSON·메뉴이동만).
검색어: task-launch-1112 1.3.19 320px 8개 startTime endTime shortcut 시간표 CAS nativeIPC 가이드57.6

## 2026-11-13 분배 수정 품종 재확정 실패 정정
- nw-distribution-refix-1113, 단일작업자. 운영 SELECT+설치EXE dnSpy 확인: 2026/46-01 카네이션 한 품종만 취소됐으며 이미 미확정인 미국2품종 때문에 일반 부분확정 보호가 재확정 차단. 7개는 Mandalay 양수업체7행 전체제출 수.
- 변경 ProdKey의 활성 Product CountryFlower를 서버/잠금트랜잭션에서 검증해 distribute-save 재확정범위 유지. 일반 부분확정·이전차수·음수재고 보호 유지. 품목저장은 변경 업체만 제출/카운트, 저장완료와 재확정실패 구분.
- 실제 운영 fix/unfix API+native SP LocalDB: 선택품종복원/미국2미확정 보존/2025동일차수/주문·날짜·금액 불변 PASS. Chrome 변경1행만 요청 PASS. 전체 ERP계약 exit0, dnSpy/manifest213/writeguard1API PASS. 가이드 실제Chrome1920x1080/100%,192.3초6단계25조작, 해시/목차 PASS.
- 운영 카네이션385행/635.4666667박스/107633550원, 날짜수량불일치0. 운영 보정은 배포 후 최신 전체원장지문 대조해 해당품종만재확정. 현재 PR/공식build/배포/복구 미검증(후속 진행).
검색어: distribution-refix-1113 카네이션 Mandalay 7개 PARTIAL_CATEGORY_FIX_BLOCKED distributionEditProdKeys

## 2026-11-13 카네이션 재확정 복구 + 카톡 최신 요청 패널
- 선행 PR1703/00532c39 CI43337795236·Cafe24배포43338049959 성공. 카네이션385행만 운영native fix API로 재확정200, 미국더글라스7/미국레몬잎3 미확정유지. 2025/2026동일46-01 상세(target flag제외)·주문·출고일·농장·Estimate 지문동일. 635.4666667박스/107633550원 보존. Mandalay7업체 실제견적API→견적/ECOUNT XLSX재열기 각7행/124단/1402500원 PASS. 운영 브라우저 확정표시 확인. 운영추가재고/업로드0.
- 후속 nw-distribution-feed-1113 단일작업자. 사용자정정: 추가·취소만 표시, 잔량·출고일변경 제외. 구글시트전체조회/문자열취소분오탐을 기존sales-feed+recentSalesPeriod/refreshSalesFeed로 교체. 15초증분/창복귀/온라인갱신·중복실행/미완료/실패보존·timestamp정렬·원문발췌helper공유. ERP API/원장 변경0.
- 순수회귀 잔량취소분/출고일/혼합요청/오전오후·날짜/중복 PASS. 실제Chrome 신규취소자동수신/증분cursor/정렬/필터/503기존목록유지/내부스크롤·기존분배저장 PASS. 전체ERP계약exit0, dnSpy/manifest213/writeguard0API PASS. 운영 기존sales-feed120건(오늘7건)/최신09:48/관측679ms READONLY확인.
- 최종 가이드/정식빌드/PR/배포/운영새패널은 진행중, 아직 미검증. 계획 docs/plans/distribution-kakao-fresh-2026-11-13.md.
검색어: distribution-feed-1113 카톡 잔량 출고일 제외 sales-feed 15초 requestExcerpt 1703 복구124단
- 최종 보완: 완료한 최근3일 조회는 다음 주기에 처음부터 재확인, 페이지 미완료만 cursor유지. 운영 ID순≠시각순 근거 및 lower-key late import Chrome 회귀 PASS. 최종 전체ERP계약 재실행exit0. 실제Chrome연습가이드192.15초6단계25조작/1920x1080/100%, 목차/해시/첫중간끝 프레임 PASS.
검색어: distribution-refix-1113 카네이션 Mandalay 7개 PARTIAL_CATEGORY_FIX_BLOCKED distributionEditProdKeys

## 2026-11-13 업무 바로가기 메뉴 검색 보완
- 사용자: 바로가기 추가할 때 검색이 안 됨. 원인: 공유 task-controls가 검색 없는 native select만 제공. fresh nw-task-search-1113 @e31713c4, 단일 작업자.
- 홈/PC메모장 공유 검색칸, 메뉴명·분류 NFKC/대소문자/공백 정규화·현재 메뉴 필터·결과수/없음 안내. Enter 첫 후보 명시선택(등록아님), ArrowDown 목록초점, Escape 검색초기화→창닫기. 검색만으로 기존href 변경0, 다른 검색 중 기존연결 묵시적 저장차단, 메뉴갱신/웹전환/초기화 유지. API/IPC/SQL/개인업무 저장코드 변경0.
- 실제Chrome 홈+notes320/280/390 검색·없음·IME보호·Enter등록0·ArrowDown/Escape·초점복귀·현재연결보존·갱신·디스크저장/재조회·웹전환/JS0 PASS. 기존시간표/실패보존/CAS회귀 및 native Electron 검색Enter/명시선택href/정상저장 PASS.
- 정식 ERP contract(pre/post포함)exit0, dnSpy/manifest/writeguard PASS. 실제한국어6단계 가이드70.5초 재촬영(검색어실제입력·Enter·선택확인·저장버튼별도줌·결과/줌아웃), 최종프레임·가이드해시검증PASS.
- Desktop1.3.20/웹다운로드갱신. 로컬정식webpack빌드 진행중, PR/CI/릴리스/운영배포·재생 미검증(후속). 메뉴기준 검색/키보드/밀도/입력보존/가이드 적용, ERP원장/dnSpy신규SQL/운영probe 해당없음. 시작계정전체주간6%, reset1795064856.
검색어: task-shortcut-search-1113 1.3.20 shortcutSearch 메뉴검색 분류검색 Enter 필터 NativeSelect
- 후속 검증: 연결 해제 후 숨겨진 검색어가 draft로 남는 반례를 실제 Chrome에서 재현→dirty 판정에서 제외→회귀PASS. Native Electron CI에도 동일 반례 추가. 검색어는 비영구UI이며 선택 종류·시간만 기존대로 초안 보호. 최신00532c39 통합(충돌은 WORK_MEMORY만, 양쪽기록보존), 검색 코드에는 충돌 없음. 최종 가이드69.7초 재촬영 및 통합빌드/CI 진행.

2026-11-13 네덜란드 원본 물량표에 품목 열·헤더 고정과 상단 스크롤바 동기화를 적용했다. 좁은 화면에서도 고정을 유지한다. 주문·분배 API 수정 없음. 운영 배포는 기록 시점 미검증.
검색어: 네덜란드 물량표 품목 고정 상단 스크롤 DutchVolumeSheet

## 2026-11-13 양쪽 분배탭 카톡 수동 작업완료·선택차수 확정현황
- fresh nw-kakao-done-1113 @72064052, 단일작업자. 농장/업체 한 카톡패널 인스턴스 공유. 수동완료는 서버웹 runtime 해시키/CAS연결 이벤트로 저장·해제, 원문/개인정보 저장없음. 서버성공뒤 초록색표시, 새로고침/탭전환 유지. ERP업무완료/분배저장·확정과 무관.
- 선택차수옆 확정현황 버튼+빨간카테고리 표시. GET ViewShipment.DetailFix 연도+세부차수 집계, 전부/일부/미확정 구분, 조회만. 설치EXE dnSpy GetFixStatus 재추출, 운영2025/2026동일46-01 각각17/13카테고리 SELECT:2026카네이션385확정/미국2품종미확정 재확인. 명시연도없는쓰기/재고/원장변경0.
- 실제운영 체크API(withAuth 포함)를 격리폴더에연결한 HTTP Chrome:체크/녹색→업체탭유지→새로고침유지→해제→새store재조회 false PASS, 주문/분배POST0. 파일실제CAS 동시작성1승자/1충돌·반복요청멱등·수정원문다른키·origin/body/method/충돌 API 회귀PASS. 확정조회API 교차연도/불일치400/POST405 PASS, 기본UI회귀전체PASS.
- 전체 ERP계약exit0, dnSpy/manifest213/쓰기guard2API PASS. 화면webpack1worker빌드exit0. 공통가이드dry-run PASS, 최종녹화/정식build/PR/배포/운영확인 진행중(미검증).
검색어: kakao-done-1113 작업완료 초록색 업체정보 농장정보 확정현황 빨간카테고리 CAS request-done

## 2026-11-13 데스크톱 홈 개편·메모장 독립 유지
- 사용자 확정 범위: 첨부 Electron 데스크톱 홈만. 일반 /dashboard 보존. 새 worktree nw-home-notes-1113, origin/master 기반, 최신72064052 통합. 단일 작업자.
- 좌측 개발요청 게시판(기존 API 고정 GET, 제목·상태·분류만 main projection)·실제 개인 업무 달력·즐겨찾기·메뉴. 우측 오늘 업무8건·주의지침·수입피드백. 현재 요청 원문/작성은 /pm 기존 게시판 deep-link. ERP/요청 원장 자동쓰기0.
- 달력은 기존 occurrence/version/snapshot/종료/보관을 재사용한 월별 해당일 건수이며 이월을 중복집계하지 않음. 윤년·월말·연도경계·완료/보관·미변경 단위검증. 달 이동은 선택일 보존, 작성중 날짜변경 차단, 키보드 방향키·게시판 Home/End, 초점 보존·계정변경 비우기.
- 본창X는 메모장 유지. 메모장 ↗로 홈 복원, 명시 완전종료/로그아웃은 모두 닫음. 메모장 미저장 초안 경고 추가. notes-only 저장예약은 마지막 정상 작업창 snapshot을 빈창으로 덮지 않도록 보호. Native 실제 생존/재개/마지막창 종료/명시종료/초안취소 PASS(추가 저장snapshot 검사 후속).
- 생성 디자인 시안과 공식 Material3/MDN 조사 반영. 짧은 버튼140ms·달력180ms feature-detect ViewTransition, reduced-motion 지원. 1920/1280/800/390 실제Chrome 폭·8건·초안·월이동·원문링크·계정정보·키보드/초점·쓰기0/JS0 PASS. 기존 시간표/검색/실패보존/피드상세 회귀 및 native IPC/계정race/종료 스모크 PASS.
- 메뉴 기준 적용: 검색·한국시간·페이지주스크롤·키보드·반복일정·입력보존·오류재시도·실제 가이드. 해당없음: ERP원장/dnSpy새SQL/운영DB probe/일반웹홈/직원PC원격명령. Desktop1.3.21 목표. 계정주간 시작8%(계정전체, reset1795064856). 정식 ERP/build/최종가이드/PR·CI·릴리스·운영배포는 이 항목 시점 진행중·미검증.
검색어: home-notes-workspace-1113 1.3.21 메모장독립 closeMainAction homeRequests personalHomeCalendar 개발요청 달력 우측업무 reduced-motion
- 후속: 최종 native6모드 실제 프로세스 정상종료·본창닫기후 메모장GET/POST저장·홈재개·snapshot보존·초안취소 PASS. 부하 중 기존 cancel-double-close 15초 timeout 1회 발생(will-quit/quit은 수신), 촬영/회귀종료후 단독재검6모드 PASS. ERP계약 정식 pre/test/post exit0, dnSpy·manifest213·writeguard0API·PM suite PASS. 최종 한국어 실제UI 가이드91.2초/8단계 녹화·가이드전체16영상/소스해시·최종줌/자막프레임 PASS. 전체webpack빌드 진행중.

- 추가 사용자지시: 첨부처럼 큰 주간 시간표 달력. 월~일 가로·시간 세로·업무 색상블록·겹친일정 분할·시간미정 별도·월간전환. 달력을 계획영역 맨 위로 확대, 기존 게시판은 그 아래. 빈 시간은 해당 날짜/시간만 입력에 채우고 자동저장0. 종료 미정은 기본 표시1시간을 명시. calendarWeek owner GET projection(일100건 상한/추가건수 안내), 원장·스키마 변경0.
- 추가 단위: 정확한 시작/종료·완료/보관/snapshot·월말/교차연도·상한·불변·2000/2100 경계. 실제 Chrome 큰 주간/월간·주 이동중 선택일 유지·빈칸12시 prefill·4폭/쓰기0/JS0 및 검색회귀 PASS. Native CSP 하에서 기본7일 시간표/인증race/기존업무/로그아웃 PASS. 이전 두 CI는 통과했으나 추가지시 후 최종 변경 CI/빌드/가이드 재검 전이므로 병합하지 않음. 진행 중 첫 빌드는 내 작업의 Next PID33704만 종료해 소스혼합 방지.
검색어: 큰주간달력 weekly-time-block calendarWeek personalHomeWeek 겹친일정 시간미정 주간시간표

- 최종 사용자 정정: 월간이 기본, 그 하단에 주간만 표시. 전환탭 제거, 큰 월간 개요 + 바로 아래 선택 주 시간표를 동시에 표시하도록 수정. 월간칸에는 시간순2건/추가건수/완료전체를 표시. 날짜선택 시 하단주간과 우측업무 연동. 최종4폭·원문링크/키보드/초안/주·월이동/빈칸12시prefill/쓰기0/JS0 PASS, native CSP 기본월간우선·하단7일 PASS. 최종 주/월 단위/bridge8건 PASS, 추가preview정렬/상한 검증 포함. 사용가이드와 최종CI/빌드는 이 정정본으로 갱신 예정.
검색어: 월간기본 하단주간 monthly-overview weekly-below calendar-preview
- 최종 월간기본/하단주간 가이드108.15초/8단계 재촬영. 월간 날짜선택→하단주간 빈12시 실제선택→우측12시채움 각 결과·강조·줌아웃·자막가림 프레임 PASS. 가이드16영상/소스해시 PASS. 단위9건, 실제4폭 월간기본·주간하단·preview·prefill·입력보존/검색/owner PASS, native CSP/인증회귀 PASS. Manifest213·writeguard0API·실제owner파일회귀 PASS. 최종webpack빌드 진행중, final CI/배포·재생 미검증.
# 2026-11-13 견적서관리 원장 연결 알림 (최신 사용자 지시)
- 전용 nw-estimate-ledger-alerts / codex/estimate-ledger-alerts, origin/master72064052 기준. 차단하지않고볼수있게만: 철회된EXE/트리거/permit초안포함0. 새GET /api/estimate/ledger-alerts와조회차수상단알림,전체업체·세부차수·품목·원수량/단위·저장공급가·키표시. DB SELECT만,스키마/원장/수식/삭제로직/EXE변경0.
- 6개단위/API/UI계약PASS. 격리LocalDB SQL2016호환에서양연도·세부차수·날짜만잔존·삭제마스터/활성품목제외·missing품목·정확연결키·적용차수이월·행불변PASS. 운영SELECT36차9건(삭제품목출고1/명시차감연결없음8),42차연결없음4. 36차Prod3028검출.10594는웹연결키/과거감사없어현재DB만으로감지불가(화면한계명시). ‘삭제확정’/삭제자추정금지.
- 실제브라우저연습컴포넌트1920x1080/390폭에서경고/0건/미지원/조회실패·늦은응답폐기·Enter/Space펼침·가로스크롤확인. 알림은인쇄제외. 새메뉴/탭/업무순서변경없음. 첫전체검사새setter fixture누락으로중단후estimateRefreshFlow주입보완/대상PASS. 전체검사·build·PR·배포는후속결과확인전미검증.
검색어: estimate-ledger-alerts 원장연결알림 삭제품목출고잔존 명시차감연결없음 EXE미변경 읽기전용
- 후속전체검사는workflow-guide source hash검사에서중단(가이드재촬영요구). 사용자명시승인‘이번알림만영상없이배포’에따라두기존견적workflow에현재pages/estimate.js exact해시의한정waiver추가,기존영상/증거해시는수정하지않음.
- 최종공식npm run build exit0(webpack/1worker),전체ERP행위계약PASS이후별도manifest214/dnSpy/쓰기범위1API/workflow-guide검사PASS. 한차례verify명령전체exit0로표현하지않음(가이드waiver후공식build분리완료). PR/CI/운영화면은후속확인.
검색어: estimate-ledger-alerts 원장연결알림 공식buildPASS 사용자영상제외 EXE불변 DB읽기전용


## 2026-11-13 신형 현장물량표 생성
- 요청 흐름: 출고분배 엑셀업로드 분배 적용→카톡 업체·품목별 농장분배 검증/적용→신형 현장물량표 생성. 기존 원본보존 다운로드 별도 유지.
- 저장결과와 서명검증값을 SELECT 재대조, 동일연도·대차수의 이전세부차수만 같은 실제출고일·지역·업체·품목에 합산. 돈셀(2)3/5, 1차-only 포함, 다음차수/다른연도 혼입차단, 단위분리·농장합계/날짜 검증. ERP 원장쓰기 추가0.
- 요일 원본RGB/테마tint 색·품종별 입고/출고/재고/잔량, A3 5지역 단위 출력. 입고/재고는 업로드 기준, 출고는 선택차수 전체 저장분배, 잔량=입고+재고-출고. 빈요약 미입력. 농장 복수출고일은 임의비례분배 없이 별도표에1회.
- 엑셀텍스트상자 카네이션13/장미15 항목 파서오류0. 엑셀 농장메모 불러오기로 카톡란 연결. 원본 빈공간 부족은 원본다운로드만 제한, 새양식 생성·유효농장 적용과 분리. 새 파일선택은 이전 카톡 초기화.
- 실제dnSpy 재실행/2025·2026 동일46차 SELECT 확인(운영수정0), 표적17검사 PASS. Excel ReadOnly 열기→실제PDF A3 3쪽 및 첫쪽수량/색 검증. 실제Chrome 합성1920/390 전체흐름·Tab/ShiftTab/Enter·파일다운로드bytes 대조 PASS. 70초 실제가이드/한국어목차·자막·줌/최종Excel인쇄뷰 기록, 프레임 직접확인 및 가이드검사 PASS.
- 기준선: 페이지스크롤/반응형/키보드/실패안내/가이드 적용; ERP변경확인은 기존버튼 보존; 새ERP쓰기 해당없음. 전체필수gate/정식build/PR·CI·배포·운영스모크는 진행예정(미검증). 상세 docs/plans/field-volume-2026-11-13.md.
검색어: 신형현장물량표 엑셀업로드 카톡농장분배 돈셀(2)3/5 요일색 입고출고재고잔량 field-volume-v1
- 후속: 공식 전체 ERP 계약/pre/post exit0, dnSpy exit0, manifest215/쓰기guard/가이드 exit0. 원본 공란 재고의 source 입고·주문·잔량 식으로만0판정하는 추가회귀 포함 관련33검사 PASS, 최종공식 webpack/1worker build exit0. 2025/2026 새출력SQL 실조회와 모델 분리 PASS(운영쓰기0). PR/CI/배포·운영가이드재생은 후속.
- 배포전 원본재검사: 카네이션 Vintage Honey 9/74행이 동일Prod3513으로 연결(SELECT만)되며 별도재고1이 첫셀참조에서 누락됨을 재현. 원본 SheetJS 캐시0을 사용하고 원본 물리행별입고/재고를1회합산, 업체/반복블록중복0. 실제원본 입고1/재고1 확인. 제로환산공유·캐시0·복수품목오연결차단 포함 관련37검사PASS. 기존UI/가이드/원장쓰기변경0, 보완본 공식 ERP 전체/pre/post·dnSpy·manifest·쓰기가드·가이드·webpack1worker build 모두exit0. 후속CI/배포 미검증. 별도재실행으로1c8bf5dc 선배포 확인 후 기존v1 출력서명은DB조회전409/재검증 요구, 새v2만 허용(추가회귀PASS).
검색어: field-volume final-build33 source-proven-zero stock SELECT-only manifest215

- 배포 직전 최종CI verify/installer 모두 SUCCESS. 동시 PR#1708(견적 관리 원장알림)265bc97f 병합으로 WORK_MEMORY append만 충돌 → 양쪽 기록 보존 통합. 기능 파일 충돌 없음. 통합본 CI 재확인 후 병합/배포 진행.
- 2026-11-13 사용자승인35차보정준비(codex/stock35-approved,base32a5e4ef): 최신요청‘35차0,영향36~46각1개조절’에따라2026/35-02 Prod1062/2322/2601각+1한번/현재고0·4·0→1·5·1/native후속cascade계획. 기존이력삭제/매주중복+1/확정해제/매출수정없음.
- preview 원천2회동일,111스냅샷(2026/2027기존준비분포함)전부정확+1,아직운영쓰기0. 새전용수동operator는기본SELECT·고정scope/승인/음수/단위검사·exact지문·같은원천rollbackrehearsal·IDLE V2게이트·CAS·기존업무/금액/원장/확정본보존·재실행차단·실패전체rollback.
- 신규17단위·반례PASS,LocalDB SQL130에실native정의(현재정렬cursor)및기존fixture readiness stub로실행: 중간native실패후rollback·rehearsalreadback·exact3history/현재고+1·2025보존/2027+1·금액보존·중복차단PASS. 전체ERP검사/build/PR/배포/운영rehearse/apply는후속검증전미완료. 계획 docs/plans/approved-stock35-2026-11-13.md.
검색어: approved-stock35-repair 35-02 1062 2322 2601 +1 111스냅샷 현재고1 5 1
- 필수verify는ERP행위/manifest/dnSpy/쓰기범위/workflow까지PASS후webpack에서ENOSPC(여유약0.6GB)로중단. 운영rehearse/apply아직0. 자신이생성한두.next정리를시도했으나안전정책차단,우회하지않고사용자에게탐색기정리요청. GitHub의독립Linux빌드검증준비를계속하며검증실패를무시한운영반영금지.

## 2026-11-13 출고분배 확정 토글·동시업무·고정 헤더
- 로컬 isFixed만 바뀌던 확정 UI를 실제 DetailFix+선택 native CountryFlower 범위로 연결. 확정/일부확정은 빨간 확정취소, 미확정은 확정. GET/POST 범위 공통해석, 클릭 직전 상태 재확인, 조회오류/빈범위 차단. 일반 부분확정/음수재고/후속차수 보호 유지.
- 분배 workspace batch는 expected 수량/단가 compare-and-set과 native 행 잠금을 사용하여 견적 업체 presence만으로 막히지 않는다. 기준변경409/누락400 및 전체배치 rollback, 다른 화면 lease/digest 보존.
- 양쪽 탭 저장/차수/좌우 이동바 sticky, 우측 표 내부 스크롤/열제목 고정. 업체1만 선택해도 품종 필터 가능.
- 검증 완료: 실제 운영 API+native SP LocalDB 취소/확정과 전년도/타품종 보존; Chrome 여러 업체5/7 한 번 저장→새로고침→견적/이카운트 XLSX 각2행 재열기(150/210단); 외국 견적lease 상태 CAS 저장/409/400/재조회; 40행 양쪽 표 고정/스크롤/단일업체 품종; 실제 브라우저 회귀.
- 운영 임의 확정취소/수량 보정 0. 필수검사·최종빌드/CI·배포/운영 스모크는 이 기록 작성 시 진행 중이며 미검증. 완료 결과는 아래 후속 기록으로 남긴다.
검색어: 확정취소 빨간버튼 distribute-toolbar confirmationSelection distribution-workspace DISTRIBUTION_STALE 고정헤더 좌우스크롤 업체1품종 2026-11-13

## 2026-11-13 승인 35차 재고 보정 운영 반영
- PR #1718 squash 2e4cb944, CI 43360654316 성공. 최초 배포 43361285864는 newer-master 안전차단; 포함 관계 확인 후 최신 08775737 배포 43362171804 성공, 운영 /api/ping DB 연결 및 Chrome 버전 확인.
- 로컬 필수 ERP 검사/dnSpy/manifest/쓰기 guard 통과, ENOSPC 후 별도 정식 build 성공. 신규17검사 및 실제 LocalDB native/rollback/교차연도/금액보존 검증 통과. 사용자 지시에 따라 이후 증거/백업은 E:/NenovaVerification/stock35-20261113 저장.
- 운영 동일 원천 해시 3a3c99c0fe20d38250935ec25317d4ba3b3185c06a321dc7d6b7be23bd367551로 rehearsal 전체 rollback/readback 일치 후 apply COMMIT/readback 일치. 새 StockHistory 567404/567405/567406. 2026/35-02 Prod1062/2322/2601 -1→0박스. 기존 준비된 2026/2027 후속111개 snapshot 각각 정확+1, 이전35-01 불변, 현재고1/5/1. 다른 품목·기존이력·주문/출고/입고/견적/매출금액/기존보고서/확정본/SP/EXE 보존 지문 확인. 매주 새+1 이력을 만든 것이 아님.
- 웹35차 명시 계산본 갱신 v10→v11 후 카네이션 F=0, J=15,432,767,K=12.5% 실화면 확인. 단순 재고 보정만의 예상 J=15,501,657과 다름: 기존 최신 계산정책이 통관비 H=4,788,519→4,857,409(+68,890원)도 함께 적용. 수국/장미 등 타행 평가액·통관비도 재계산됨. 기존v10 삭제/덮어쓰기 없음. 이 차이를 재고보정 효과로 혼동하면 안 됨.
- 36~46 ERP 재고수량 보정/전후 대사는 완료. 36~46 웹 저장 계산본 갱신은 아직 미실행: 기존 갱신이 재고 외 최신 비용정책도 함께 적용하는 점 때문에 범위 선택 필요. 46 기존 저장본 없음. 전체 차수 수익률 정확성 인증이나 EXE 실제 UI 저장 스모크 완료를 의미하지 않음.
검색어: stock35 applied 567404 567405 567406 E드라이브 111스냅샷 35차v11 통관비68890 후속보고서미갱신
