# 품목 행과 페이지·차수 구분
기초수량/현재수량/최신변경을 같은 table row에 표시. 기존 calculateLedger와 복사 계산 유지. 페이지 고유 ID+전체 YYYY-WW-SS를 저장 식별자로 사용. 동일 페이지 같은 차수는 기존 최신 저장본을 열고, 다른 페이지/연도/차수의 이벤트·적용원문은 분리. 기존 v1 저장본은 제목별 페이지로 읽기 호환. UserFavorite kakao-stock-ledger snapshot만 추가, 기존 snapshot 및 ERP 원장/API/SQL/EXE/견적·매출 영향 없음. 미저장 페이지 전환은 메모리 초안 보존, 창닫기 경고. 서버 CAS/동시편집 병합은 이번 범위 밖이며 snapshot 보존으로 이전본 열기 가능.
