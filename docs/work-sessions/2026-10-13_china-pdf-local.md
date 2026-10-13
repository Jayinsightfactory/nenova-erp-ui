# 중국 해상 PDF 시간초과 재진단 및 로컬 처리

| 항목 | 기록 |
|---|---|
| 요청 | 41-1 중국 해상 PDF 정상 처리, 검증 후 배포 |
| 기준 | origin/master 26d3ff31, codex/china-pdf-local |
| 화면 | 수입부 패킹 리스트 |
| 원장 부작용 | 주문/입고/분배/재고/견적/원가 저장 없음 |
| 설계 | docs/plans/china-pdf-local.md |

## 고정 결정
- 이전 1회 유료 승인 소진. 이번 작업은 추가 유료 호출 없이 실제 PDF 브라우저 로컬 처리로 검증한다.
- unknown/scanned/손상 양식을 부분 성공 처리하지 않는다. 미지원이면 파일 유지 + 기존 명시 AI 선택 경로.
- null 가격은 0원이 아니다. 원문확인·사유·입력 전 다운로드/입고 차단을 유지한다.
- CN 정확한 박스·단·송이·길이·행별 GW와 source_format을 보존한다. 운임 합계에 반복 상품금액을 넣지 않는다.

### 1. 요청과 원인 정정
**Q.** PDF 분석 시간초과 원인 해결, 같은 파일 검증 후 배포.

**A.** 이전 분석은17:26 KST 시작했고 다른 PR1043의 운영 배포38368892257이17:29:07에 PM2 reload를 실행했다. 17:36 오류 문구는 getPackingPdfJob→recoverDeadOwner의 소유 프로세스 소멸 분기에서만 발생한다. 따라서 공급자10분시간초과로만 설명한 이전 기록을 정정한다. 배포 중단과 불필요한 CN AI 의존을 분리한다.

- 기존 NL-only 로컬 라우팅 때문에 텍스트 읽기 가능한 중국 PDF도 AI로 전송됐다.
- 현재 file SHA256 `1e66a6877cc58cdebc73055664ed7bda0fe612b0d32e3c075a964e1077ef530d`; PDF.js 텍스트101품목, 인쇄 합계와 대조:429박스/5390단/68775송이/GW4005.12/상품126325CNY/총172150.50CNY.
- 마지막 Sinensis white140단의 원문단가/금액은 '-'다. 자동0원대체는 금지한다.
- 기존 비동기 provider 경로가 PM2 reload를 넘어 실행을 지속한다는 보장은 없다. 이번 대상은 브라우저 로컬 경로로 해당 의존을 제거한다.

## 모델·권한
- 메인: 설계·통합·외부읽기·PR·배포 담당.
- Banach: gpt-5.6-sol/xhigh 설계/최종검토 P0_LOCAL 읽기전용.
- Locke: gpt-6-sol/high 구현, 지정terra미지원으로대체, 순수parser/fixture/tests만 P0_LOCAL.
- Mill: gpt-6-luna/high 기계검증, 지정5.6-luna미지원으로대체, exactfile위치fixture/브라우저검증 P0_LOCAL.
- 파일/의존성/근거는 메인이 준비, 자식에게 운영 쓰기/비밀/API호출 권한 없음.

## 검증·배포
- `test:erp-contract`, `test:erp-manifest -- --changed-from origin/master`, `guard:erp-writes`, `test:nenova-dnspy-evidence`, production build 통과. 추가 포맷 import에 맞게 기존 두 UI 테스트의 명시 모듈 mock도 갱신했다.
- 실제 PDF를 실제 PDF.js worker와 PackingListTool로1920×1080/100%,1280×800에서 검증:101행,7페이지 렌더, 인쇄 합계 일치. 누락단가1행/명시0원0행을 구분. 원본 검토 gate는 해제하지 않았다.
- 브라우저 검사 POST0/운영 ERP 쓰기0/저장0/유료 호출0. 서버 배포 및 운영 업로드 결과는 배포 후 별도 기록한다.
- private outputs/china-pdf-local 및 원문은 커밋하지 않는다. 기존 무관한 worktree 변경은 보존한다.
