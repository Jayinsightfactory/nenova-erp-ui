# 네덜란드 물량표 Excel 왕복 보존

## 기준과 선검증
- 사용자 요청: 추가 업체·최종 수량을 보이는 원본 행렬에 출력, 같은 파일 재업로드 후 동일 분배 계획. 기존 등록/분배 MD 및 dnSpy 검증 후 배포.
- 기준 커밋 b30bb5a8. ERP_CHANGE_GUARD, ERP_FEATURE_CHANGE_CHECKLIST, ERP_COMPAT_INVARIANTS, WEB_VS_ERP_CONFLICTS ViewOrder/ViewShipment, DB_STRUCTURE, NATIVE_SHIPMENT_HEADER_CONTRACT, DutchVolumeDistribution 및 기능 계약 확인.
- 실제 dnSpy.Console FormShipmentDistribution.btnSave_Click 재실행: GetShipmentMaster→환산수량/Est/Cost/Amount/Vat→명시 farm 변경→ShipmentDate 삭제/재생성 또는 UpdateCost→ExcuteTransaction 순서 확인. EXE/SP/writer 변경 없음.
- 운영 SELECT: 2025/43-02 ViewOrder306, 2026/43-02 385. 2026/43-02/533/1487 분배200, 확정, Date1/Farm0. 이는 읽기 기준이며 시험 저장 증거 아님.
- 오래된 2026-07-30 MD 양수 주문 덮어쓰기와 현재 기능 계약 불일치: 현재 Dutch 전용 계약과 실제 import core의 기존 주문 보존을 유지. raw OrderYearWeek는 대차수, native NULL CustKey를 보정하지 않음.

## 동작/부작용
| 동작 | Order/Shipment/Date/Farm | Estimate/Stock/Warehouse/WebProfitReport |
|---|---|---|
| 다운로드/업로드 | 보존, 브라우저 초안만 | 보존 |
| 재검증 | 기존 preview SELECT | 보존 |
| 명시 최종 적용 | 기존 CATEGORY_REPLACE 원자 writer: 활성 주문 보존/없으면 양수 생성, 분배 최종 SET, 날짜/단가 계약 | 직접 변경 금지 |

## 기준 ledger
- 보이는 셀의 숫자가 유일한 수량 원천. 주문/입고/재고/잔량 요약을 수량으로 사용 금지.
- 지역별 열은 화면과 동일 projectDutchInlineCustomers 사용. 출력 좌표와 단가 도형 좌표도 같은 projection.
- 기존 수량/추가 수량, 0, 소수, 단위, 명시 매칭키, blank/0/양수 단가의 왕복 보존. 이전 자동 match cache는 권한 아님; 수동/기존 유효키도 새 server preview에서 검증.
- 파일의 버전된 보조 정보는 좌표+보이는 원문과 대조. 키는 사용자 입력 힌트이며 인증·서버 plan/확정 가드를 우회하지 않음. 임의 _keymap은 계속 무시.
- 파일 연도·차수가 선택 scope와 다르면 차단. 전년도 동일 차수 fixture 필수.
- 파일을 다시 올릴 때 로컬의 낡은 저장 초안/일괄가격 설정이 파일의 최종값을 덮지 않음.
- 이전 ERP적용초안만 있는 export는 안전한 왕복파일로 오인하지 않도록 명시 차단/안내.
- 메뉴 기본값: 기존 shell/키보드/검토·명시 적용 적용; 새 메뉴·schema 해당 없음. 스프레드시트 스킬은 시험 산출물 값/시각 검증에 사용, 제품의 XLSX 런타임은 기존 라이브러리 유지.

## 검증 계획
- XLSX write/read→실제 upload parser→preview payload 동등성. 반복 export, 빈칸/0, 이동한 열/수식·요약, 단가, 잘못된 scope/key/metadata, 원본 불변성.
- 격리 MSSQL actual preview/apply: 다운로드 전후 계획 동등, 저장 후 native ViewOrder/ViewShipment/날짜·돈, 재적용 무증가, 교차연도/rollback/확정/stale 보존.
- 전체 계약·dnSpy·manifest·writes·build 후 PR/CI/병합/Cafe24/실브라우저. 운영 원장 시험쓰기 없음.
