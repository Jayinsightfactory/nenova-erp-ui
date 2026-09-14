# 전산 피벗 간격 조절 지연 개선

## 기준과 범위

- 요청: 피벗 간격/행 높이/열 너비 조절 시 심한 지연 제거. 화면 표시만 개선한다.
- 원인 근거: Panel changeWidth는 mousemove마다 setWidths, localStorage는 매 변경 즉시 직렬화. Grid는 모든 부모 렌더에서 presentation 생성 및 전체 행×열 셀 formatPivotExeNumber를 다시 실행한다. 숫자 포맷은 셀마다 locale formatter를 구성한다.
- 집계 모델은 이미 widths/rowHeight 의존성이 없으므로 집계 SQL/정책 변경은 불필요하다. 축·필터·수치·소수점 의미는 보존한다.
- 저장된 dnSpy FormQuantityPivot_Load/GetData 및 btnExcel_Click, 기존 원본 SQL 근거를 재확인. 같은 세션 운영 2026-37-01 2,517행 GET 성공 자료를 읽기 근거로 재사용하며 ERP DB 수정/추가 probe는 하지 않는다.

## 부작용 표

| 동작 | Order/Shipment/Date/Farm | Warehouse/Stock | Estimate/WebProfitReport | 개인 설정 |
|---|---|---|---|---|
| 너비 드래그 중 | 보존 | 보존 | 보존 | 안내선만 미리보기, 확정 저장 안 함 |
| 마우스 놓기·높이/너비 입력 확정 | 보존 | 보존 | 보존 | 최종 표시값만 기존 사용자별 브라우저 설정에 저장 |
| 즐겨찾기·엑셀 | 기존 계약 보존 | 보존 | 보존 | 기존 명시 저장/API/전체 표시 엑셀 의미 보존 |

## 구현 기준

- 드래그는 가벼운 안내선/너비 표시, mouseup에서 마지막 좌표 1회 적용. 취소·창 이탈·언마운트 시 listener/안내선 정리. 같은 너비면 state 갱신 안 함.
- 표 내용과 크기/위치를 분리: memoized 본문, 재사용 presentation, CSS 크기·sticky 위치. 높이/너비만 바꿀 때 숫자·병합·집계를 재작성하지 않는다.
- Intl.NumberFormat 재사용, 기존 null/0/음수/소수/비숫자 표현 보존.
- 사용자별 설정 저장은 짧게 모아서 실행하고 pagehide/언마운트 때 최종값 보존. 인증 복원·다른 사용자 키 안전성 유지.
- 1920×1080/100%, 수만 셀 fixture로 변경 전/후 동일 드래그·입력 지연 실측. 원본 및 표시 셀 fingerprint 불변, ERP 요청 0, 설정 복원·엑셀 회귀 필수.

## 역할

- 메인: 설계/Panel/계약/통합/배포. Terra: Grid·presentation 성능 구현. Luna: 로컬 대형 fixture 성능 검사. Sol: 최종 독립 검토.
- 권한 P0_LOCAL만 하위 작업에 제공. 설치된 의존성/localhost 테스트 준비, 비밀값/운영쓰기 금지.

## 검증

- 전체 ERP 계약, manifest 59개, dnSpy 근거, 변경 API 쓰기 보호(0개), Next production build 통과.
- 피벗 8개 순수 검사: 원본/엑셀·교차연도·설정 격리·1회 최종 resize·취소/정리·저장 flush 통과.
- 실제 localhost production build에서 1920×1080/100% 및 1366×768 UI smoke 통과. 60개 필드 이동, 필터·정렬·합계·다운로드·즐겨찾기 CRUD mock·인증 지연·503 보존 포함.
- Sol 독립 최종 검토 P1/P2 없음. 대형 성능 실측과 운영 배포 결과는 후속 기록.
