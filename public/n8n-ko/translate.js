/* n8n 한글 오버레이 — n8n 페이지(n8n.nenovaweb.com)에 nginx sub_filter로 주입된다.
 * 우하단 🇰🇷 토글 버튼으로 켜고 끈다. 주요 UI 용어만 "정확히 일치하는 텍스트"에 한해 치환하여
 * 사용자 입력/코드/표현식/데이터는 건드리지 않는다(안전). 완벽한 전체 번역이 아니라 편의용 오버레이.
 * 용어 추가/수정은 아래 KO 사전만 늘리면 된다.
 */
(function () {
  if (window.__n8nKoLoaded) return;
  window.__n8nKoLoaded = true;

  // EN → KO (정확히 일치하는 전체 텍스트만 치환)
  var KO = {
    'Overview': '개요', 'Personal': '개인', 'Workflows': '워크플로우', 'Credentials': '자격증명',
    'Executions': '실행기록', 'Variables': '변수', 'Templates': '템플릿', 'Insights': '인사이트',
    'Help': '도움말', 'Settings': '설정', 'Admin Panel': '관리자', 'What’s New': '새소식',
    'Create Workflow': '워크플로우 만들기', 'Add workflow': '워크플로우 추가', 'Start from scratch': '빈 워크플로우로 시작',
    'Build a workflow': '워크플로우 만들기', 'Open': '열기', 'New': '새로 만들기',
    'Save': '저장', 'Saved': '저장됨', 'Publish': '게시', 'Download': '다운로드', 'Duplicate': '복제',
    'Rename': '이름 변경', 'Delete': '삭제', 'Archive': '보관', 'Favorite': '즐겨찾기',
    'Import from URL...': 'URL에서 가져오기...', 'Import from File...': '파일에서 가져오기...',
    'Edit description': '설명 편집', 'Add tag': '태그 추가',
    'Active': '활성', 'Inactive': '비활성',
    'Editor': '편집기', 'Evaluations': '평가',
    'Add first step…': '첫 단계 추가…', 'Add first step...': '첫 단계 추가...',
    'Execute workflow': '워크플로우 실행', 'Execute step': '단계 실행', 'Execute previous nodes': '이전 노드 실행',
    'Test workflow': '워크플로우 테스트', 'Test step': '단계 테스트', 'Test URL': '테스트 URL', 'Stop': '중지',
    'Parameters': '매개변수', 'Docs': '문서', 'Input': '입력', 'Output': '출력',
    'No input data': '입력 데이터 없음', 'No output data': '출력 데이터 없음', 'set mock data': '모의 데이터 설정',
    'No fields - node executed, but no items were sent on this branch': '필드 없음 - 노드는 실행됐지만 이 분기로 전달된 항목이 없습니다',
    'Variables and context': '변수 및 컨텍스트', 'Schema': '스키마', 'Table': '표', 'JSON': 'JSON',
    'Connection': '연결', 'Sharing': '공유', 'Details': '세부정보', 'Account': '계정',
    'Set up credential': '자격증명 설정', 'Create new credential': '새 자격증명 만들기',
    'Name': '이름', 'Value': '값', 'Description': '설명', 'Type': '유형', 'Method': '메서드', 'URL': 'URL',
    'Authentication': '인증', 'Header Auth': '헤더 인증', 'Generic Credential Type': '일반 자격증명 유형',
    'Send Query Parameters': '쿼리 파라미터 전송', 'Query Parameters': '쿼리 파라미터',
    'Add Query Parameter': '쿼리 파라미터 추가', 'Specify Query Parameters': '쿼리 파라미터 지정',
    'Using Fields Below': '아래 필드 사용', 'Import cURL': 'cURL 가져오기', 'Allowed HTTP Request Domains': '허용 HTTP 요청 도메인', 'All': '전체',
    'Cancel': '취소', 'Confirm': '확인', 'Close': '닫기', 'Back': '뒤로', 'Next': '다음',
    'Continue': '계속', 'Retry': '재시도', 'Yes': '예', 'No': '아니오', 'OK': '확인', 'Import': '가져오기',
    'Sign in': '로그인', 'Sign out': '로그아웃', 'Log out': '로그아웃',
    'Email': '이메일', 'Password': '비밀번호', 'First Name': '이름', 'Last Name': '성',
    'Set up owner account': '관리자 계정 설정', 'Owner': '소유자', 'Member': '멤버', 'Admin': '관리자',
    'Add node': '노드 추가', 'Search nodes...': '노드 검색...', 'On a schedule': '스케줄로', 'Manual Trigger': '수동 트리거',
    'Node executed successfully': '노드가 성공적으로 실행되었습니다', 'Workflow executed successfully': '워크플로우가 성공적으로 실행되었습니다',
    'Error': '오류', 'Warning': '경고', 'Success': '성공', 'Loading': '로딩 중', 'Logs': '로그',
    'Clear execution': '실행 지우기', 'Read our docs': '문서 보기',
    'Copy': '복사', 'Paste': '붙여넣기', 'Edit': '편집', 'Add': '추가', 'Remove': '제거'
  };

  var enabled = localStorage.getItem('n8nKo') !== 'off';
  var SKIP = /^(SCRIPT|STYLE|TEXTAREA|INPUT|CODE|PRE|SELECT|OPTION)$/;
  var timer = null, observer = null;

  function translateRoot(root) {
    try {
      var it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      var batch = [], n;
      while ((n = it.nextNode())) batch.push(n);
      for (var i = 0; i < batch.length; i++) {
        var node = batch[i], p = node.parentElement;
        if (!p || SKIP.test(p.tagName) || p.isContentEditable) continue;
        var key = node.nodeValue.trim();
        if (key && KO[key] && node.nodeValue.indexOf(KO[key]) === -1) {
          node.nodeValue = node.nodeValue.replace(key, KO[key]);
        }
      }
      var els = root.querySelectorAll ? root.querySelectorAll('[placeholder],[title],[aria-label]') : [];
      for (var j = 0; j < els.length; j++) {
        ['placeholder', 'title', 'aria-label'].forEach(function (a) {
          var v = els[j].getAttribute(a);
          if (v && KO[v.trim()]) els[j].setAttribute(a, KO[v.trim()]);
        });
      }
    } catch (e) { /* noop */ }
  }

  function scheduleTranslate() {
    if (!enabled) return;
    if (timer) return;
    timer = setTimeout(function () { timer = null; translateRoot(document.body); }, 250);
  }

  function start() {
    translateRoot(document.body);
    observer = new MutationObserver(scheduleTranslate);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function makeButton() {
    var b = document.createElement('button');
    b.id = 'n8n-ko-toggle';
    b.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;padding:7px 12px;' +
      'border-radius:18px;border:1px solid #d0d0d0;background:#fff;cursor:pointer;font-size:13px;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.18);';
    b.textContent = enabled ? '🇰🇷 한글 ON' : '🇰🇷 한글 OFF';
    b.title = '클릭하면 n8n 화면 한글 표시를 켜고 끕니다';
    b.onclick = function () {
      enabled = !enabled;
      localStorage.setItem('n8nKo', enabled ? 'on' : 'off');
      // 끌 때는 새로고침으로 원본(영어) 복원, 켤 때는 즉시 번역
      location.reload();
    };
    document.body.appendChild(b);
  }

  function init() {
    if (!document.body) { setTimeout(init, 100); return; }
    makeButton();
    if (enabled) start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
