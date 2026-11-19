# 2026-11-19 현장물량표 요일 세로 배치·업체 품종 요약

요청: 품종명 1회/한 셀 구조를 유지하며 요일은 셀 안에서 세로로 나눈다. 하단 요일·지역 제목 오른쪽에 업체총량(품종수량,...)을 넣고 빠렛 옆에 실제 박스수를 붙인다.

## 기준표와 부작용
| 항목 | 기준 / 소비자 |
|---|---|
| 요일 | 기존 model.entries 실제 날짜 또는 업로드 요일, 기존 정렬/색상 유지. renderFieldVolumeWorkbook.write가 요일 경계마다 새 줄 |
| 단위·수량 | model.entries current/previous, product unit별 기존 route 분리. 현재 수량과 선택된 이전차수만 업체별·품목별 합산. 농장 지정량으로 대체하지 않음 |
| 체크박스 | includePrevious !== false 기존 기본값 유지. 명시 false 품종요약에서 이전수량 제외. API/서명/기존 연도·차수 scope 무변경 |
| 빠렛 | shipmentPallet.palletSnapshot의 박스 원값. 일반장미10단/박스, Snow Flake25단/박스, 루스커스35박스/빠렛 등 기존 산식 보존. 빠렛은 기존 소수1자리, 괄호 박스는 원값 소수6자리까지 |
| 인쇄 | 사용자 지정 단일시트/A3 가로. 기존 배율57·너비1페이지·높이자동, 우측 입출재잔 수식 보존 |
| 쓰기 | GENERATE_FIELD_VOLUME / GENERATE_UPLOADED_FIELD_VOLUME 모두 OrderDetail, ShipmentDetail, ShipmentDate, ShipmentFarm, Stock*, Estimate, WebProfitReport 보존. DB SQL·API·인증 변경0 |

45박스 카네이션은 기존40박스/빠렛 산식에서 1.1(45)다. 요청의 1.7(45)는 표시 형식 예로 취급하고 박스수를 빠렛 반올림값에서 역산하지 않는다. 표시명은 실제 product.label을 그대로 사용한다.

## 근거·검증
- 실제 설치 Nenova.exe FormShipmentDistribution dnSpy CLI 재실행. OrderYear/OrderWeek와 ShipmentFarm 상세키 근거 재확인. SQL 변경 없음.
- 운영 SELECT-only 2026/46-02 헤더53·상세463·날짜464, 2025동일차수 헤더45·상세258·날짜258. 농장0. 운영 변경0; 수량·원장 보정 미실행.
- 표적34 PASS: 실제 workbook 재열기, 요일별 새 줄/품종명1회, 동일업체 복수품종·복수업체·소수, includePrevious true/false, 교차연도·다른날짜·미저장 차단, 박스/빠렛 반올림 독립, 일반장미10/Snowflake25/루스커스35.
- 실제 제공 로컬46-02 원본4종 변환 및 Excel 읽기전용 PDF 출력: 모두 단일시트/A3가로/1페이지. 4품목 전체 첫페이지 시각 확인. 현재 원본은 스크린샷과 요일·수량이 다르므로 스크린샷 샘플값을 출력에 복사하지 않음.
- 메뉴 기본값: 적용=원장불변·기존다운로드·실제파일대조. 해당없음=새메뉴·UI/작업순서·키보드 변경·새 안내영상·새 데스크톱 패키지. components/Layout.js 및 desktop/menu.json 기존 /shipment/distribute-import 연결 확인. 웹 렌더러 갱신은 기존 데스크톱 메뉴에서도 자동 사용. 기존 영상의 조작순서 유지, 새 출력 전체 소개 영상은 이번에 제작하지 않음.
- Rust 핫패스 해당없음: 기존 파일 내보내기 표시 변경, 상주데몬/고빈도 바이너리 전처리 아님.
- 전체검사/빌드/CI/배포 결과는 WORK_MEMORY 인계에 기록.
