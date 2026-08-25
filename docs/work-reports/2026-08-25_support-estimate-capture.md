# 작업 완료 보고 — 영업지원 처리상태 옆 견적서 캡쳐 (2026-08-25)

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-25 14:25 |
| 사용자 요청 | 처리상태 옆에 불량차감이 올라간 페이지를 캡쳐해서 보이게 해 달라 |
| 브랜치 | fix/support-estimate-capture |
| 커밋 | (배포 시 기록) |
| 배포 | Cafe24 예정 |

## AI 구성

| 담당 | 역할 |
|------|------|
| **Cursor** | 요청 분석, 읽기 전용 캡쳐 UI 구현, 계약·테스트·배포 |
| **Claude Code** | 미사용 |
| **Codex** | 미사용 |

## 작업 흐름

1. 처리상태 옆 견적서 목록 캡쳐 열 추가. 기존 음수 Estimate만 표시.
2. 호버 시 `previewCapture=1` 견적서 페이지를 iframe으로 읽기만 함.
3. `npm run test:erp-contract`, dnSpy evidence, manifest, write guard, build.

## 변경 요약

| 파일 | 내용 |
|------|------|
| `lib/salesDefectSupportStatus.js` | `buildSupportEstimateCapture` |
| `lib/estimateFixStatusLink.js` | `previewCapture=1` |
| `pages/sales/defect-deductions.js` | 견적서 캡쳐 열 |
| `pages/estimate.js` | 캡쳐 모드에서 목록만 표시 |
| `docs/contracts/sales-defect-deduction.json` | `OPEN_SUPPORT_ESTIMATE_CAPTURE` |

## 사용자 확인 포인트

- 영업지원 전산등록에서 처리상태 오른쪽 캡쳐에 불량차감 행이 보이는지
- 캡쳐를 클릭하면 해당 업체 견적서가 열리는지

## 미완

- 수입부 인쇄, 엑셀 거래처/농장 열 너비는 이번 범위 밖
