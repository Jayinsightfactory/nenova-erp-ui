# 네덜란드 물량표 시트·단가 탭 / 실제 4002 파일

| 항목 | 내용 |
|---|---|
| 일자 | 2026-10-05 |
| 화면 | `/stats/dutch-volume-board`, 일반/팝업 |
| 작업 브랜치 | `codex/dutch-sheet-price-tabs` |
| 원장 부작용 | 운영 SELECT만. 주문/분배/확정/원가/재고 저장 없음 |
| 배포 | 로컬 검증 완료 후 PR/CI/배포 결과 추가 예정 |

## 고정 결정

- 업로드 기본 화면은 원본 행렬, 옆 탭은 단가 수정·매칭. 같은 entries/prices 상태를 사용한다.
- 원본 A/B/C와 업체 헤더, 셀 주소를 보존한다. `_keymap`은 오래될 수 있어 자동 ERP 명시키로 신뢰하지 않는다.
- KRW 빈칸=보존, 명시0=0원. 주광 개별/나머지 균일가 정책 유지. 탭 이동만으로 저장하거나 검증을 초기화하지 않는다.
- 선택 연도/차수 및 원본 내용별 v3 초안. v2는 자동복원하지 않고 안내하며 원래 저장값은 삭제하지 않는다.
- CATEGORY_REPLACE, 누락→0, 기존 주문 보존, 없는 양수 주문 생성, 확정/단위/농장/snapshot/사후검증은 그대로다.

### 1. 원본 시트와 단가 수정 연결

**Q.** 자동 매칭이 부족하고 검색어가 비어 있다. 엑셀 물량표처럼 보이며 옆 단가 탭에서 수정한 값이 즉시 시트에 나타나야 한다.

**A.** 원본 행렬과 단가·매칭 탭을 추가했다. 원본 셀 수정 버튼은 해당 편집행으로 이동한다. 원본 수량과 수정수량을 구분하고 가격 badge는 수량을 대체하지 않는다. 품목 검색은 원본 품목명으로 시작하고 네덜란드 후보를 표시한다. 검색 popup은 portal로 표 스크롤 잘림을 방지한다. 기본 viewport1920×1080/100%.

### 2. `4002_네덜란드.xlsx` 실제 분석

**Q.** 문제 파일 업로드 완료.

**A.** `네덜란드!A1:Y53`, D:S16업체, 양수 입력81칸. A꽃/B품목/C칼라 신형이며 이전 두 식별열 양식도 함께 지원한다. 처음 제품만 대조한79/81은 전체 업체+품목 성공률이 아니다. 제품 terminal `(NL)` 제한 별칭으로 ARAN3441이 연결되어 제품만80/81이다. 레우코취 DYED RED60cm은 Tinted/Walteri/Absorbed 후보가 있어 자동선택하지 않는다.

전체 실제 `buildImportPreview` SELECT에서는 기존 업체 복합헤더 비교도 실패했다. Dutch 전용 정확 이름/Descr-head/코드 비교 후 최종 미매칭9칸: 레우코취1 + 뒷길알파8. 원본 뒷길알파(A)/CL10은 현재 알파플라워461/YCL10과 꽃샘원예318/CL10을 충돌시켜 수동 확인해야 한다. 코드 접두를 임의 제거하지 않았다.

### 3. 미리보기 변경 오류

**A.** 동일 누락→0 행들이 순서만 바뀌어 PREVIEW_CHANGED가 되는 실행형 fixture를 확인했다. 전체 tuple multiset을 정렬 비교하되 중복 개수/수량/확정/날짜문제/미매칭 사유 검증과 두 번 조회를 보존했다. 실제 DB 연속 SELECT에서도 fixBlocked false→true가 관찰되었으므로 운영 오류를 모두 순서 오탐이라고 단정하지 않는다. 진짜 확정 변경은 계속 차단한다.

## 근거·검증

- 실제 dnSpy CLI FormShipmentDistribution 재실행: ShipmentDetail 및 ShipmentDate 저장 필드/순서 근거 재확인. ERP 쓰기 코어 변경 없음.
- 테스트: `test:erp-contract`, `test:nenova-dnspy-evidence`, 변경기준 manifest/write guard, `test:pivot`, `test:dutch-volume-distribution`, 격리 `test:dutch-volume-distribution-sql`, `build` 통과. 마지막 UI 변경 후 최종 재실행/CI 결과는 아래 추가한다.
- 격리 SQL은 unmounted localhost14339 전용 컨테이너의 임의 fixture DB 생성/정리만 수행했다. cross-year·가격·확정·rollback·원장 보존 통과.
- 고성능 설계/검토 gpt-6-astra high, 기계 테스트 gpt-6-luna high. 중간 구현 gpt-6-sol high는 지정 구모델 부재 대체였고 capacity 오류 후 메인이 UI 통합을 마쳤다. 하위 작업 외부쓰기 없음.
- 취소 확인 전에 주광 단가가 삭제될 수 있는 발견사항을 수정했다. 취소는 상태/계획 불변, 승인한 매칭만 검증 무효화한다.
- `.tmp/`의 원본 사본, Product SELECT JSON, probe/log는 비공개 로컬 검증 자료로 커밋하지 않는다.

## 남은 확인

PR/CI/master/Cafe24 배포와 실제 운영 화면 읽기 전용 smoke. Chrome 파일 URL 권한 제한으로 실제 첨부 업로드는 사용자가 직접 수행했다. 운영 ERP 적용 버튼은 검증 중 누르지 않는다.

## PR / CI 진행 결과

- 코드 `e372da3c`, PR886 생성·연결. ERP Contract Guard37273807093 성공(1m21s).
- master 병합 `c2f53768769867475d54aed609ab0a2f0a110c42` 확인.
- UI 완성 후 `build`, pivot 및 Dutch 패키지 최종 재실행 통과. 전체 ERP 계약과 변경 manifest/write guard 통과.
- 배포·실브라우저 결과는 완료 후 추가한다. 최초 브라우저는90% 확대율이어서1920×1080/100% 검증 완료라고 기록하지 않고 사용자에게100% 복원을 요청했다.

## 배포 및 운영 smoke 결과

- Cafe24 배포37273968242 성공(4m33s), SSH 및 hydration smoke 통과. 운영 화면 버전 c2f53768 확인.
- 운영 LIVE 2026/40-02 읽기 조회95행, 미매칭0. 확정95건과 출고일 수량 불일치 차단 유지. 운영 ERP 저장 미실행.
- D4 원본 셀 수정 → 해당 단가 편집행 이동 및 focus 확인. 주광 개별단가1234 입력 후 원본 셀에1,234원 즉시 표시 확인. 검증 후 빈값으로 복원.
- ERP 품목 검색창에 원본명 Gladiolus / Fat Boy 자동 입력 확인. 후보 선택/ERP 적용은 하지 않음.
- 브라우저 DOM2133×950, 확대90%, 전역 가로 overflow 없음, console error 없음.1920×1080/100% 검증은 사용자 확대율 변경 대기이며 완료로 주장하지 않음. 임시 viewport override reset 완료.
- screenshot 캡처는 브라우저 CDP5초 timeout으로 확보하지 못했다. 첨부4002 파일의 새 배포 버전 재업로드 smoke도 대기. 실제 파일 parser/SELECT 대조72/81 및 자동검사는 앞 근거대로 완료.
