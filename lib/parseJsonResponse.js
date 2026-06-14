/** fetch 응답 — HTML(nginx 502/414 등) 대신 JSON 파싱 실패 시 명확한 오류 */

export async function parseJsonResponse(res) {
  const text = await res.text();
  if (!text) return {};
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<') || trimmed.startsWith('<!')) {
    if (res.status === 502) {
      throw new Error('서버 연결 오류(502). 잠시 후 다시 시도하세요.');
    }
    if (res.status === 414) {
      throw new Error('요청 URL이 너무 깁니다. 페이지를 새로고침하세요.');
    }
    throw new Error(
      `서버가 JSON 대신 HTML을 반환했습니다 (${res.status}). 로그인·배포 상태를 확인하세요.`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`응답 파싱 실패 (${res.status}): ${text.slice(0, 120)}`);
  }
}
