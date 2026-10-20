# 중국 기존 입고 원가 연결 작업 중

요청: 기존 입고 보존, 중국 원가 연결/미매칭3건/저장/엑셀/배포 검증.

확인: 활성 입고7671, 2026/42-01, HUBFRESH. 원본64상품/2280단/57230CNY, 부대비37559.5. 기존7쪽용 파서는3쪽 원본 열배치를 인식하지 못해 AI로 이동. AI가 박스수를 단수로 오인.

작업: 별도 worktree `C:/Users/USER/nw-china-existing-cost`, branch codex/china-existing-cost. CN 단기준 연결/원가/출력 분기 및 compact parser 초안. 테스트73통과9생략. 전체검사/PR/배포/운영저장 미완료.

확인 필요: Eucalyptus Populus(with berries)의 원본 10송이/단×15단=150인데 총300송이. 임의보정하지 않음. 사용자 기준 확인 뒤 parser 전체행·교차연도·near-miss 및 실DB/엑셀검증 계속. 미매칭3건 후보2093/2077/3178, 공유매칭 아직 미저장.

검색어: china-existing-cost HUBFRESH 7671 Populus 150 300 compact PDF

## 2026-10-20 후속

Q. 원가는 15단 기준, 송이 수는 직접 수정, 입고 보존하고 저장/다운로드/배포 검증.
A. 단기준 연결 구현, compact PDF 64행 합계 검증 및 송이 불일치 경고 분리. 직접 수정된 송이 수는 원본 합계와 수정 이력 보존. CN 기존입고 모의 SQL 저장/재조회 및 숨은 NULL 품목행 변동 시 STALE 차단 통과. 로그인 완료 확인.
결과. ERP 계약/dnSpy/manifest/write guard 및 빌드 통과. PR/배포/운영 원가 저장/다운로드는 진행 중이며 미검증.
비공개 `.tmp-china-*-probe*.json`은 커밋하지 않는다.
