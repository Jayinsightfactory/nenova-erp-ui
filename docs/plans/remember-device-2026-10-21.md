# 이 기기 로그인 유지

사용자 선택: 모든 계정 기본 변경이 아니라 로그인 화면의 명시적 기기별 opt-in.

- 미선택: 기존 JWT 8시간, 외부 Bearer JWT/서비스 토큰 정책 보존.
- 선택: HttpOnly/Secure/SameSite=Strict host-only cookie의 임의 256-bit 기기 자격증명. 서버에는 SHA256 파일 키와 비밀번호 변경 감지용 keyed HMAC만 저장; 비밀번호/원문 토큰 저장 금지.
- 서버 저장은 ignored `data/runtime/remember-device`, ERP DB는 UserInfo SELECT만. 주문/출고/재고/견적/WebProfitReport 전부 보존, 스키마 변경 없음.
- 브라우저 제한 내 최대400일, 일반 브라우저는 사용 시 하루에 한 번 만료 갱신. 기존 NenovaDesktop의 cookie-change listener는 업무 view를 stop/hide하므로 웹앱은 중간 쿠키 갱신 없이 고정400일이다. 8시간 경과로 해제되지 않으며 만료/쿠키 삭제는 재로그인 필요.
- 매 인증 시 현재 계정·권한·비밀번호 지문 확인. 비활성/삭제/비밀번호 변경 시 거부. DB/저장소 실패는 fail closed.
- 로그아웃/성공한 다른 로그인은 현재 기기 세션 서버 폐기. 폐기 표식은 갱신 경쟁에도 보존. 다른 기기에는 영향 없음.
- API와 SSR 모두 동일 검증을 await. 비동기 결과를 참으로 취급해 접근을 허용하는 회귀 금지.
- 웹/모바일 로그인에 기본 해제 체크박스, 공용 PC 안내. 원문 비밀번호/기기 자격증명을 localStorage에 저장하지 않는다. EXE 로그인/원장과는 무관한 웹 세션 변경이다.
- 검증: 시간 이동(8시간/400일), 서버 재시작, 갱신, 기기 분리, 폐기 경쟁, 비밀번호/권한 변경, DB 실패, 기본8시간/Bearer/서비스 회귀, 실제 브라우저 체크박스 전송, 전체ERP gate/build/CI/Cafe24 smoke.
