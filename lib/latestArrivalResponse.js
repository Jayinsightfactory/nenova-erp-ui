const messages = {
  auth:'로그인을 확인한 뒤 최신 원가를 다시 조회하세요.',
  unavailable:'최신 원가를 불러오지 못했습니다.',
};

export async function readLatestArrivalResponse(response) {
  if ([401,403].includes(response.status)||response.redirected)
    throw new Error(messages.auth);
  if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json'))
    throw new Error(messages.unavailable);
  let data;
  try { data=await response.json(); }
  catch { throw new Error(messages.unavailable); }
  if (data?.success!==true||!data.references||typeof data.references!=='object'||Array.isArray(data.references))
    throw new Error(messages.unavailable);
  return data.references;
}
export const latestArrivalUnavailable=messages.unavailable;
