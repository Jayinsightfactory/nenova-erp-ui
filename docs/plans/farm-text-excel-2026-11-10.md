# 물량표 농장분배 통합 업로드

## 기준 및 부작용

업무키는 선택 OrderYear + OrderWeek + CustKey + ProdKey. 카톡 제목 차수는 참고이며 저장 범위를 정하지 않는다.

| 동작 | OrderDetail | ShipmentDetail | ShipmentDate | ShipmentFarm | Estimate / WebProfitReport / Stock |
|---|---|---|---|---|---|
| 검증·원본 엑셀 다운로드 | 보존 | 보존 | 보존 | 보존 | 보존 |
| 농장만 변경 | 보존 | Descr만 | 보존 | 최종값 교체 | 보존 |
| 엑셀 수량·업체 변경 동시 적용 | 기존 주문 보존, 주문 없는 양수만 생성 | 기존 최종값 업로드 정책 | 기존 수량 동기화 정책 | 명시 배정은 검증 후 교체, 기존 배정 합계 불일치는 차단 | 직접 쓰기 금지 |

preview / preflight / transaction은 같은 농장 후보 helper와 합계 정책을 사용한다. 후보는 ViewWarehouse ProdKey 전체 이력, Farm.isDeleted=0. 표시용 한글 별칭은 후보를 축소하는 데만 쓰며 FarmKey를 생성하지 않는다. 모호한 업체·품목·농장은 사용자가 선택하고 재검증한다. 명시 단위는 실제 Product 입수로 변환한다. 생략 수량은 단일 농장에만 허용한다. 중복 업무키 지시는 차단한다. 검증 스냅샷 이후 농장 변경은 목표값과 같은 멱등 상태 외 전부 차단한다.

원본 OOXML은 재직렬화하지 않는다. 페이지설정·열너비·행높이·여백과 기존 셀 스타일은 유지한다. 수량표 위쪽의 빈셀에만 메모 블록을 배치하며 해당 빈셀만 병합하고 11pt 메모 스타일을 추가한다. 상단 공간이 없으면 기존 배율의 인쇄용지 안에 들어갈 때만 하단 빈 공간을 사용한다. 수량 입력용 빈셀은 건드리지 않는다. 별도 농장분배_검증 시트에도 구조화된 값을 보관하여 재업로드 시 수량과 다시 대조한다. 인쇄 메모를 직접 수정했으면 구조화 시트/카톡에서 다시 수정하도록 차단한다. 검증 화면 배율은 CSS에만 적용한다.

실제 첨부 양식 시험: 카네이션 4항목 상단 빈셀 2블록, 기존81행/31%; 장미20항목 빈 첫행4블록, 기존60행/46%. 원본 수량·수식·열너비·행높이·pageSetup/pageMargins/용지 설정 유지. ExcelJS 재열기 성공. 기존 스타일 배열은 보존하고 메모용 xf 1개만 추가, 재다운로드 시 재사용한다. 실제 Excel 인쇄 엔진의 페이지 미리보기는 별도 확인 대상이다.

## 선검증 근거

2026-11-10 실제 CLI:
`dnSpy.Console.exe --no-color -t FormShipmentDistribution 'C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe'`
결과 TEMP/farm-text-FormShipmentDistribution.cs 156140 bytes. grdViewShipment_FocusedRowChanged는 ViewWarehouse와 Farm, ShipmentFarm을 조회. btnSave_Click은 ShipmentDetail 후 ClassShipmentFarm(FarmKey,ShipmentQuantity,SdetailKey)을 저장하고 수량 변경 시 ShipmentDate를 동기화한다. 기존 farm-only API와 같이 수량 불변이면 날짜·금액 갱신은 하지 않는다.

읽기 전용 운영 probe: 2026/45-01 Cust282 Prod2158 Sdetail101043, Out20 Amount181818 Vat18182 isFix1, FarmCount0 DateCount1. 같은 차수의 다른 3행도 조회. Farm25 Natuflora/Nat, Farm27 Ayura/Ayu 확인. 개인정보·자격증명 출력 없음, 운영쓰기 없음. 확정된 실제 첨부 차수에 실저장하지 않는다.

견적은 DetailFix=1 등 기존 자격을 보존한다. 수량이 바뀌면 기존 업로드의 날짜·금액 계산으로 downstream 노출이 바뀔 수 있다. 농장만 변경 시 OutQuantity/Amount/Vat/isFix/ShipmentDtm/ShipmentDate 보존을 테스트한다.

## 2026-11-11 DB 물량표 품목 왕복 매칭

- 기준: 표시명은 `pivotVolumeProductLabel.volumeProdLabel`이 유일한 변환 원천. 원본명 정확 일치 다음, 파일 범위 내 export 표시명 정확 일치, 기존 별칭/검색 순서. 명시 DB키/수동선택 우선순위·출처 국가/품종 검사는 그대로 유지. 중복 표시명은 기존 업체/선택연도 주문 문맥으로만 유일성을 확인하고 불명확하면 검토 유지. cm만 제거하며 숫자길이·Mini·MC·Elite는 보존.
- 실제 dnSpy CLI FormShipmentDistribution 재추출 156140bytes, 실제 Product SELECT: 1283 Brighton50cm /1377 60cm /2906 mc50cm /3309 50cm(Elite), 442 CARNATION Mix box /2322 MINICARNATION Mix Box 확인. 원본 두 파일에는 숨은 _keymap이 없어 표시명 역변환 경로를 사용한다.
- 실제 원본+운영 SELECT preview: 수정 전 카네이션 MixBox 2표기, 장미 11표기 미매칭 재현. 수정 후 두 파일 품목미매칭0(수동 품목선택0). 선출고/재고/농장명 업체열 검토는 별도 기존정책으로 유지. 모든 probe는 SELECT 전용, 저장 트랜잭션 호출시 throw.
- 인쇄 선확인: 실제 웹 다운로드 카네이션을 Excel COM ReadOnly로 원본과 각각 PDF 출력. A3 세로 1쪽 841.68×1190.4pt 동일, FitToPages1×1. 기존2009단어 좌표 이동0, 추가메모22단어만 상단빈셀에 존재. 열/행/여백/그림XML 보존. 장미 적용본/수정본 재업로드 및 배포 이후 실브라우저는 후속 검증중.
- 이번 변경은 서버 매칭 대칭성 보정, 사용자 조작 단계/권한/기본값 변경 없음. 기존 가이드 유지.

실농장 별칭 선검증: FarmKey22 The Elite Flowers/Eli,23 FLORES Tiba/Tib,35 Varietta/Var는 각각 엘리떼·티바·바리에타와 기존 별칭이 불일치했다. 별칭별 정확 DB 표기 변형만 추가하고 후보 조회 범위·FarmKey 수동선택·복수후보 차단은 유지한다. ViewWarehouse 후보 밖 농장/유사명은 허용하지 않는다. 저장/재검증은 기존 공통 후보 helper 유지.
