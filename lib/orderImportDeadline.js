// Stop waiting in the browser; this does not cancel or retry a server write.
export async function withOrderImportDeadline(request, { timeoutMs = 120000 } = {}) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(request),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('서버 응답 대기 시간이 초과되었습니다. 서버 처리가 취소된 것은 아닙니다.');
          error.code = 'ORDER_IMPORT_RESPONSE_TIMEOUT';
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
