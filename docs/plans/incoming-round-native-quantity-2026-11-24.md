# 입고 차수 접미 표시와 상세 수량

| 동작 | 기준 | 쓰기 영향 |
|---|---|---|
| 원장 A/B 변경 | 원본 연도·세부차수·WarehouseKey, 기존 표시값 비교, 관리자·수입부 | 동일 트랜잭션에서 감사 이력에 표시 분류 기록. ERP 차수·입고·재고·재무 원장 보존. |
| 파킹 차수 가져오기 | NN-NN, NN-NNA/B, NN-NN.A/B. 파킹의 차수 원문을 분리하고 업무키로 중복·확정 검사. | 기존 작성기가 입고와 재고를 등록하고 같은 트랜잭션에서 접미 분류를 함께 기록. |
| 상세 수량 미리보기·저장 | WarehouseKey·원본 차수·연도·WdetailKey, 기존 출고/견적 단위, 기존 총액의 입증 가능한 기준, 변경 전 미리보기, 수정 사유. | 해당 WarehouseDetail의 세 수량·출고/견적수량·합계만 갱신, 기존 상세 키·품목·포장량·단가 보존. 변동 입고단위의 재고만 재계산, 동일 트랜잭션에 감사 기록. |
| 상세 이력 | 관리자·수입부·영업지원. 선택한 원장 범위. | 조회만. |

실제 설치 EXE SHA256 FEDEA619A6E54D6CDD58802E0707DD51D06F5D46E883F53F00134E801AC62F79. 상세 편집 실제 타입은 FormWarehouseAdd이며 FormWarehouseView.groupControl1_CustomButtonClick에서 기존 WdetailKey로 호출한다. btnSave_Click은 UnitQuantity로 박스·단·송이에서 출고/견적 단위를 구한다. EXE 자체의 TPrice 산식은 송이×단가다. 파일 업로드는 파일 합계를 저장하며 운영 #8249 상세 51360은 단 60/송이 600, 단×단가를 사용한다. 기존 원장의 입증된 금액 기준을 이어받고 여러 가능한 기준의 새 금액이 달라질 때 차단한다.

EXE ExcelLoadingPackingList.CheckData 및 FormWarehouseView는 연도+차수에서 하이픈만 제거한 문자열로 확정 검사한다. 기존 StockMaster/ShipmentMaster/WarehouseMaster.OrderWeek는 nvarchar(20)이지만 년차수 업무키의 의미는 NN-NN이며 운영 2026/47-02 활성 입고 26건 모두 원본 47-02다. A/B를 기존 차수에 합치면 확정과 재고 계산의 입력 범위를 달리하므로 원장 표시만 별도 기록한다.

운영 SELECT-only에서 SystemActionLog에 입고 정정 성공 이력 및 Actor, ActionDtm, Payload NVARCHAR(MAX), SessionId, LogKey 존재를 확인. 운영 서비스의 초기화·삭제 모듈과 저장소의 정리 코드는 발견되지 않았다. 기존 정정 감사 저장소를 재사용한다.

견적 Estimate, ShipmentDate, ShipmentDetail.Amount/Vat/isFix, ShipmentFarm, OrderDetail, WebProfitReport 및 Related Views에 직접 쓰지 않는다. 연결된 문서·확정·저장 원가·다른 조정 요청·부족 재고는 기존 가드에 따라 차단한다. 같은 차수의 다른 연도 또는 다른 원장에 영향을 주지 않는다.

운영 전체 사전검사 SELECT에서 2026/48-02 #8254 / #51414는 수량 변경을 진행할 조건을 충족했다. 2026/47-02 #8249 / #51360은 연결 인보이스와 현재 확정으로 차단됐다. 검토 때 브라우저에서 읽은 이전 박스·단·송이도 확인하고, 최종 트랜잭션에서 다시 검증한다. 두 행 모두 저장하지 않았다.
