// lib/chat/handlers/orderRequest.js — 주문등록신청 + 승인대기 조회
import { query, sql } from '../../db';
import { extractWeek } from '../router';
import { findCustomer } from '../entities';

// 주문 신청 흐름: "주문 신청" 하면 거래처/차수 선택 안내
// 실제 저장은 별도 /api/m/order-request POST 로 (UI 폼에서 호출)
export async function handleOrderRequestFlow(text, user, mode) {
  if (mode === 'pending') {
    // 내가 요청한 것 + 관리자면 전체 pending
    const isAdmin = /admin|관리자|대표/i.test(user?.authority || '') || user?.deptName === '대표';
    const where = isAdmin ? '' : 'AND r.RequesterUserId = @uid';
    const params = isAdmin ? {} : { uid: { type: sql.NVarChar, value: user?.userId || '' } };

    const rows = await query(
      `SELECT TOP 20 r.RequestKey, r.OrderWeek, r.Status, r.CreatedAt, r.RequesterName,
              c.CustName,
              (SELECT COUNT(*) FROM OrderRequestDetail d WHERE d.RequestKey=r.RequestKey) AS itemCount
         FROM OrderRequest r
         JOIN Customer c ON c.CustKey = r.CustKey
        WHERE r.Status = 'pending' ${where}
        ORDER BY r.CreatedAt DESC`,
      params
    );

    if (rows.recordset.length === 0) {
      return { messages: [{ type: 'text', content: '📭 대기 중인 신청이 없습니다.' }] };
    }

    return {
      messages: [
        {
          type: 'text',
          content: `⏳ 승인 대기 ${rows.recordset.length}건${isAdmin ? ' (전체)' : ' (내 신청)'}`,
        },
        {
          type: 'cards',
          cards: rows.recordset.map(r => ({
            title: `#${r.RequestKey} · ${r.CustName}`,
            subtitle: `${r.OrderWeek} · ${new Date(r.CreatedAt).toLocaleDateString('ko-KR')}`,
            rows: [
              { label: '신청자', value: r.RequesterName || '-' },
              { label: '품목 수', value: `${r.itemCount}개` },
              { label: '상태', value: '⏳ 대기' },
            ],
          })),
        },
      ],
    };
  }

  // mode === 'new': 주문 신청 시작 안내
  const cust = await findCustomer(text);
  const week = extractWeek(text);

  if (!cust || !week) {
    return {
      messages: [
        {
          type: 'text',
          content:
`📝 주문 등록 신청

신청서를 작성하려면 모바일 UI에서 다음 정보가 필요합니다:
① 거래처 선택
② 차수 입력 (예: 15-02)
③ 품목/수량 추가

간단 신청은 아래 형식으로 메시지를 보내주세요:
"꽃길 15-02 주문신청"

그러면 거래처와 차수가 자동 인식되어 품목 입력 폼이 뜹니다.

※ 신청은 관리자 승인 후 실제 주문에 반영됩니다.`,
        },
        {
          type: 'actions',
          actions: [
            { label: '승인 대기 목록', text: '승인 대기 목록' },
            { label: '도움말', text: '도움말' },
          ],
        },
      ],
    };
  }

  // 거래처+차수 모두 인식됨 → 폼 열기 지시
  return {
    messages: [
      {
        type: 'text',
        content: `✏️ 주문 등록 신청\n거래처: ${cust.CustName}\n차수: ${week}\n\n품목/수량 입력 폼이 화면 하단에 열립니다. (※ 다음 커밋에서 UI 폼 연결)`,
      },
      {
        type: 'card',
        card: {
          title: '신청 내용',
          rows: [
            { label: '거래처', value: cust.CustName },
            { label: '차수', value: week },
            { label: '상태', value: '품목 입력 대기' },
          ],
          footer: '※ MVP에서는 "[+품목]" 메시지로 품목 추가, "[제출]"로 저장 가능 (차기 배포)',
        },
      },
    ],
    // 프런트엔드에서 폼을 열 수 있도록 힌트 전달
    formHint: {
      type: 'orderRequest',
      custKey: cust.CustKey,
      custName: cust.CustName,
      orderWeek: week,
    },
  };
}
