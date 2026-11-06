# 최근 손익44 운영502 및 중복 SELECT 성능 보완

원본업무: [근거·설계·수치](../plans/profit-coherent-performance-2026-11-06.md), [계약](../contracts/profit-coherent-request-memo.json).

운영 배포 후 과거42 XLSX는 성공했으나 최근44 최초GET이118.767초/502. 별도 read-only runtime 대조로 요청중 PM2 추가재시작이 확인됐다. max_memory_restart1GiB이나 정확한 종료사유는 미확정. 원장쓰기/재계산/설정변경/캐시스냅샷생성 금지.

실제 dnSpy FormWarehouseView와 읽기전용 크기집계/단일 canonical44 계측으로 invoicebulk 원인가설을 폐기했다. 진짜 반복은 arrival 원천파이프라인 및 같은연도 FX GROUP BY였다. 승인된 최소변경은 기존 read context 안의 exact argument promise memo뿐이다. 연도/0/false/미지정/서로다른옵션/reader함수identity 분리, 실패evict, caller별 clone, 요청밖 memo없음. 금융수식/SQL/필터/취득원가 reference/원천fence/확정·과거 정책 그대로.

실DB paired baseline/after44:46.229→34.294초,2699→1403SELECT, whole rows.calc/totals SHA256동일 `bc10325225a9df284f399d6a76905986678a4f646a91c0a96ddbef4a1ee19607`, 반환변이0. 계측RSS486.17→497.26MB(메모리개선 미입증), 새대상12회귀PASS. 개인정보/원자료/SQLparams/credentials 로그없음, DB쓰기0.

정식 verify 최초실행은 기존 WeightEvidence VM하네스가 새 import를 제거하여 helper undefined에서 중단. WeightEvidence/ActualCosts하네스에 실제helper주입, StoredRatePriority는 순수block이라 변경불필요. 관련8회귀PASS. board/precontract/기존 앞core통과 후 실패지점부터 공식 잔여core/posthook/dnSpy/manifest/writeguard/단일worker build 재개중이다. 한 번의 전체 exit0을 주장하지 않으며 최종 cleanCI 필수.

현재 코드는 freeze, 부모가 commit/PR/CI/배포 소유. UI/업무흐름 변화없어 가이드재녹화 해당없음. 향후 운영 GET-only44 단1회<120초 및 PM2 restartdelta0을 확인한 뒤 출력검증. 운영해소/최종gate/build는 아직 미검증. 로컬산출물 `.verify/profit-profile-*.jsonl`은 commits제외.

검색어: profit-coherent-performance 최근44 502 read-only PM2 requestmemo FX moneySHA peakRSS
