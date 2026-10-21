# NENOVA.EXE 관리자 설치파일

| 항목 | 내용 |
|---|---|
| 기간 | 2026-10-21 |
| 대상 | 기존 Wooribnc NENOVA.EXE 음수 주문 피벗 업데이트 |
| 원장 부작용 | DB 연결/쓰기 없음. 기존 검증된 EXE payload 그대로 포함 |
| 배포 | 로컬 단일 설치 EXE, 직원 PC별 실행 필요 |

## 고정 결정
- 네노바웹/Electron 업데이트가 아닌 native EXE 전용 설치기다.
- PR1132의 동일 SHA256 FEDEA619A6E54D6CDD58802E0707DD51D06F5D46E883F53F00134E801AC62F79 payload를 포함한다. GetData 두 바이트 변경 이외 재빌드 없음.
- 원본 4033996D20006213BD7D7C5454396421FC18B3836CCB7F2C47B1CB8C93C1BD63만 교체. 미지원 버전 거부, 이미 적용된 경우 재교체하지 않는다.
- Windows requireAdministrator manifest로 정상 UAC 경로 사용. PowerShell 수동 명령/정책 우회 불필요.
- 대상 PC의 모든 세션에 Nenova 프로세스가 있으면 중지 안내. 강제 종료 없음. 다른 PC는 중단 불필요.
- 고유 임시파일을 같은 디렉터리에 생성하고 두 번째 프로세스/원본 검사 뒤 File.Replace로 백업·교체. 후검증 실패 시 백업 검증 후 복원, 복원 실패 시 실행 금지와 백업 위치 안내.
- 자동 재실행하지 않는다. 사용자는 기존 바로가기로 일반 권한 실행한다.

### 1. 관리자 권한 설치로 다시 설계
**Q.** 관리자 권한으로 설치프로그램을 실행해서 작동하게 해 달라.
**A.** 단일 WinForms 설치기, 기본 경로 자동 제시·다른 위치 선택, 실행 여부 확인, 백업·교체·검증, 재설치 완료 안내를 구현했다.
**결과.** `scripts/native-pivot-setup/Setup.cs`, manifest, 빌드 스크립트, 실제 파일 교체 회귀 스크립트. binaries/fixture/screenshots는 outputs에만 보관하며 git에 포함하지 않는다.

## 기준선·부작용
| 기준 | 판정 | 근거 |
|---|---|---|
| 대상·실패 사유·복구 안내 | 적용 | 동일 Install helper가 UI와 회귀에 사용됨 |
| 키보드 | 적용 | 표준 입력/버튼, Tab순서, Enter 설치/완료 후 닫기, Escape 닫기 |
| 작은 화면 | 적용 | 580×410 렌더링 확인, 리사이즈 가능, 결과 스크롤 |
| 웹 shell·메뉴 등록 | 해당 없음 | 독립 native 설치기 |
| 페이지 세로 스크롤 | 예외 | 설치 결과는 read-only multiline 스크롤, 폼 크기 조절 가능 |
| ERP 업무키·차수 필터 | 변경 없음 | 기존 검증된 payload 해시 고정. 2025/2026 및 국가/차수 테스트는 FormQuantityPivot golden 근거 유지 |
| OrderDetail, ShipmentDetail, ShipmentDate, ShipmentFarm, StockHistory, Estimate, WebProfitReport | 보존 | 설치기는 DB API/연결 없음 |

## 검증
- 실제 fixture 원본 교체/원본 백업 일치/재설치 불변 통과.
- 실행 중 및 교체 직전 실행 감지, 손상 payload, 미지원 원본 모두 거부·원본 보존 통과.
- 최종 EXE 내 requireAdministrator manifest 및 embedded payload hash 확인.
- 폼 실제 버튼 실행으로 이미 설치된 상태·완료 후 Enter 닫기 대상 확인. 기본/작은 폼 렌더링 확인.
- 사용자 PC 관리자 UAC 직접 실행과 직원 PC 설치, 실제 로그인한 피벗 조회는 이 세션에서 미검증.
- 전체 ERP 검사/빌드 및 PR 결과는 후속 기록한다.

검색어: native-pivot-installer 관리자설치 requireAdministrator 단일EXE 직원PC 음수주문
