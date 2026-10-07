# 2026-10-07 네노바 PC 프로그램 기획·구현·설치파일

| 항목 | 내용 |
|---|---|
| 화면 | 기존 Nenovaweb을 여는 별도 Windows 데스크톱 앱 |
| 목적 | Chrome/Excel 시트처럼 업무별 탭, 별도 창 이동과 재결합 |
| 원장 부작용 | 새 SQL·업무 저장 API 없음, 기존 서버 사용 |
| 설계 | docs/desktop/PRD.md, SECURITY.md |
| 검증 | docs/desktop/QA_2026-10-07.md |
| PR | https://github.com/Jayinsightfactory/nenova-erp-ui/pull/951 |

## 이어받을 때 고정된 결정

- `desktop/` 별도 Electron 패키지와 Windows x64 NSIS 설치기. 기존 nenova.exe와 별도 설치.
- 원격 화면은 preload/Node 없는 sandbox WebContentsView, 로컬 shell만 제한 IPC 사용.
- 탭·창 이동은 기존 WebContents를 옮겨 입력을 유지한다. 재실행 복원은 메타데이터이며 모든 미저장 폼 복원은 아니다.
- 한 계정 공유, 인증 변경 잠금, 다른 계정 확인 전 초안 저장소 정리. 창 구성 암호화와 packaged cookie encryption.
- 원격 창 opener를 보존하는 createWindow adoption을 사용한다. 인쇄/매칭 팝업을 deny 후 재생성하지 않는다.
- 코드 서명 인증서 없음. NotSigned 상태와 Windows 게시자 경고 가능성을 사용자에게 알린다.

### 1. 전체 PC 프로그램 제작

**Q.** 기존 네노바웹 UI를 한 프로그램에서 탭/시트로 열고, 창 분리·이동·닫기를 하며 쓸 수 있게 기획부터 설치파일까지 만들어 달라.

**A.** 메뉴 검색·즐겨찾기·독립 탭·이름 변경·드래그 순서 변경·창 분리/이동·재실행 복원을 구현했다. 기존 업무 화면과 서버 검증을 사용한다. 2025/2026 주소를 구분해 보관한다. 로컬 fixture 및 실제 운영 조회, NSIS 설치/실행/제거를 확인했다.

**결과.** desktop 소스, docs/desktop 설계·사용 설명·QA, Windows installer. PR #951과 연결된 Actions에서 최종 병합·검사·배포 상태를 확인할 수 있다. 최초 Windows CI 실행(37581392400)에서도 단위·Electron 수명주기·인증·별도 프로세스 복원 검사를 통과했다.

최종 사용자 전달 폴더는 `C:/Users/USER/Downloads/Nenova-Desktop-1.0.0`이며 설치파일 SHA256은 `0551EA17C393EADCFDAECBC158E57E072475BB41B7604F721CFF194958CF7FF6`이다. 실제 설치된 app.asar와 최종 빌드 app.asar SHA256 일치, 설치 앱 로그인·메뉴·2개 창 실행도 확인했다.

## 미포함/다음 단계

기업 코드 서명 인증서와 서명 배포, 자동 업데이트 채널은 별도 구성 대상. 전체 업무의 실제 저장·프린터 출력 회귀는 이 작업의 읽기 전용 운영 smoke에 포함되지 않았다.

## 로컬 임시 산출물

desktop/dist와 test-output은 미추적. 운영 읽기 smoke 스크립트는 OS Temp에만 있고 인증 비밀값을 기록하거나 패키지에 포함하지 않았다. 최종 설치파일·사용 안내·SHA256은 사용자 Downloads 하위 배포 폴더에 제공한다.
