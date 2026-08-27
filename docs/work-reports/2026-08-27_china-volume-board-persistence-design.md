# 자동 중국물량표 영속화 기준·부작용 설계

작성일: 2026-08-27

## 범위

자동 중국물량표에서 사용자가 만든 차수별 작업본, 업로드한 패킹리스트 행,
업로드 당시 매칭 결과, 셀 수량·박스 배정, 누락·초과 검토 결과를 웹 전용 원장에
저장한다. 품목 미매칭을 사용자가 확정한 결과는 다음 차수에도 재사용할 수 있도록
별도 전용 매핑 원장에 저장한다.

ERP 피벗 데이터는 기존 읽기 전용 조회의 결과일 뿐 이 저장 API의 쓰기 대상이 아니다.

## 기준값 목록

| 기준 | 원천 | 정규화 | 사용 위치 |
|---|---|---|---|
| 연도 | 화면의 명시 `orderYear` | 4자리 문자열, 2000~2099 | 작업본 GET/POST 업무키 |
| 차수 | 화면의 명시 `orderWeek` | `35-1`도 `35-01`로 정규화 | 작업본 GET/POST 업무키 |
| 작업본 식별자 | DB `BoardKey` PK | 양의 정수 | 작업본 수정/삭제 |
| 동시수정 버전 | DB `RowVersion` | 16자리 HEX, 기존 작업본 저장/삭제 때 필수 | stale 저장·삭제 409 차단 |
| 작업본 이름 | 사용자 입력 `name` | trim, 최대 120자; 빈 값은 `차수 중국물량표` | 목록 표시 |
| 패킹 원본/매칭 | `packingRows` | JSON 배열, 0건도 유효 | 업로드 복원·매칭 검토 |
| 셀 작업값 | `cells` | JSON object, 수량 0/빈 allocations 보존 | 그리드 복원 |
| 업로드 당시 매핑 | `matchOverrides` | JSON object, 빈 object 보존 | 작업본 재현 |
| 누락·초과 검토 | `reviewState` | JSON object, `false`/0/미해결 상태 보존 | 검토창 복원 |
| 전역 품목 매핑 키 | `sourceItemName` | `normalizeChinaText` | 다음 차수 자동매칭 |
| 전역 품목 매핑 대상 | `prodKey` | 활성 Product PK를 저장 직전 재조회 | `WebChinaVolumeProductMap` |
| 스키마 상태 | migration의 두 테이블·필수 컬럼 | runtime read-only probe | 모든 GET/POST/DELETE; 누락 시 503 |

`OrderYear` 또는 `OrderWeek` 한쪽만 전달한 조회는 거부한다. 둘 다 생략한 조회는 최근
작업본 목록이며, 둘 다 전달한 조회만 해당 연도·차수 작업본을 반환한다. 전년도 같은
차수는 섞지 않는다.

## 부작용 보존표

| 동작 | WebChinaVolumeBoard | WebChinaVolumeProductMap | Order/Shipment | Warehouse/Stock | Estimate/WebProfitReport |
|---|---|---|---|---|---|
| 작업본 조회 | SELECT | SELECT | 보존 | 보존 | 보존 |
| 작업본 저장 | INSERT/UPDATE | 보존 | 보존 | 보존 | 보존 |
| 작업본 삭제 | soft UPDATE | 보존 | 보존 | 보존 | 보존 |
| 품목 매핑 저장 | 보존 | INSERT/UPDATE | Product SELECT only | 보존 | 보존 |
| 품목 매핑 삭제 | 보존 | soft UPDATE | 보존 | 보존 | 보존 |

작업본을 삭제해도 전역 품목 매핑은 삭제하지 않는다. 품목 매핑 삭제도 기존 작업본의
`MatchOverridesJson` 스냅샷을 변경하지 않는다.

## 스키마·배포 계약

- runtime API에서 `CREATE/ALTER/DROP`을 실행하지 않는다.
- `docs/migrations/2026-08-27_web_china_volume_board.sql`만 DDL을 소유한다.
- 배포 스크립트가 migration을 적용한 후 테이블·필수 컬럼·filtered unique index를
  확인한다. 검증 실패 시 build/reload 전에 배포를 중단한다.
- 삭제는 `isDeleted=1` soft delete다.
- 기존 작업본 수정·삭제는 조회 응답의 `rowVersion`과 같은 `expectedRowVersion`만 허용한다.
- `WebChinaVolumeProductMap`은 활성 `NormalizedSourceName`을 하나만 허용한다.

## 실행형 fixture

- 2025 `35-01`과 2026 `35-01` 작업본이 동시에 있어도 2026 조회는 2026만 반환한다.
- `packingRows=[]`, `cells={}`, `reviewState`의 `false`/0을 기본값으로 덮어쓰지 않는다.
- 스키마가 하나라도 누락되면 GET도 DDL 없이 503을 반환한다.
- 매핑 비활성화 뒤 새 업로드 GET에는 나오지 않지만 기존 작업본 JSON은 보존된다.
- 존재하지 않거나 삭제된 Product를 전역 매핑으로 저장하지 않는다.
