# 입고 농장 선택 검색·미등록 입고농장 후보 복구

구현 전 근거: 실제 dnSpy CLI ClassWarehouseMaster.Update는 FarmKey가 아니라 WarehouseMaster.FarmName 문자열을 저장한다. FormWarehouseView.GetData는 wm.FarmName을 읽고 isDeleted=0을 필터한다. 운영 SELECT: Farm 활성87개, Fagua/Inti 검색결과0; WarehouseMaster에는 Fagua Flowers와 Faguaflowers Intl LLC가 존재한다. 다른 조직의 동명 여부나 자동 별칭을 추정하지 않는다.

기준: Farm 활성 이름과 활성 WarehouseMaster에서 이미 사용한 이름을 합친 공통 후보. 동일 이름의 Farm 마스터가 있으면 그 마스터의 활성/삭제 상태를 우선하며 삭제 마스터를 과거 입고로 되살리지 않는다. 후보는 연도/차수와 무관한 이름 목록이며 수정 대상은 기존 WarehouseKey+명시연도+차수 범위다. 현재 원장명/복원 초안명은 화면 값 보존용이며 후보 밖 새 이름은 미리보기와 저장에서 차단한다. FarmName의 기존 normalizedCorrection 규칙(좌우 trim/최대100자)에 맞지 않는 이름은 후보에서 제외하며, 마스터의 동명 활성 FarmKey가 둘 이상이면 후보에서 제외한다. 정식 선택값은 원문 그대로이고 DB 후보의 binary 이름 비교와 서버 JS exact equality를 유지한다.

FarmKey 없는 입고 이름은 입고의 FarmName 메타 수정만 허용한다. ShipmentFarm 배정 후보는 계속 실제 활성 FarmKey만 사용하며 가짜 키·농장 마스터·별칭을 만들지 않는다. 실제 운영 명칭 Faguaflowers Intl LLC를 그대로 선택한다. 사용자 입력 INTI를 임의로 정식 명칭으로 등록하지 않는다.

| 동작 | Farm/WarehouseMaster | 주문/출고/재고/견적/매출 |
|---|---|---|
| 조회/검색/선택 | 조회/화면 상태만 | 보존 |
| 기존 FARM 저장 | 기존 검증 후 선택 원장 FarmName+감사필드만 | 기존 보존 정책 유지 |
| 농장 마스터 신규등록 | 수행하지 않음 | 보존 |

검색: 검색칸 입력 시 대소문자·공백 무시 부분검색. 검색은 선택/저장/미리보기 자체를 바꾸지 않는다. 실제 선택 변경만 기존 preview를 무효화한다. 기본 native select와 label을 유지해 dialog키보드/모바일/기존테스트 호환. 0결과/검색지우기/현재선택 보존을 검증한다.

후보 공유: GET목록,legacy preview/locked save,approval facts/locked final이 같은 SQL helper를 사용한다. 실제 FarmKey를 요구하는 분배 후보는 별도 기존 마스터 목록을 보존한다. 미등록/삭제 후보·전년도 이름/동일차수 fixture와 UI검색을 검증한다. 기존 원가연결·확정·재고·후속매출 가드는 변경하지 않는다.
