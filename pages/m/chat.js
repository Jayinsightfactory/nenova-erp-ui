// pages/m/chat.js — 모바일 챗봇 페이지 (내부 직원용)
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import OrderModifyPanel from '../../components/m/OrderModifyPanel';
import { getCurrentWeek } from '../../lib/useWeekInput';

function formatWeekDisplayLocal(week) {
  const raw = String(week || '').trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${Number(m[2])}-${Number(m[3])}차`;
  const mm = raw.match(/^(\d{2})-(\d{2})$/);
  if (mm) return `${Number(mm[1])}-${Number(mm[2])}차`;
  return raw;
}

function normalizeWeekInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = raw.match(/^(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = raw.match(/^(\d{1,2})\s*차\s*(\d{1,2})?$/);
  if (m) return `${m[1].padStart(2, '0')}-${String(m[2] || '01').padStart(2, '0')}`;
  return raw;
}

function toChatOrderWeek(value) {
  const normalized = normalizeWeekInput(value);
  const m = normalized.match(/^\d{4}-(\d{2}-\d{2})$/);
  return m ? m[1] : normalized;
}

function isValidOrderWeek(value) {
  const m = String(value || '').match(/^(\d{2})-(\d{2})$/);
  if (!m) return false;
  const week = Number(m[1]);
  const seq = Number(m[2]);
  return week >= 1 && week <= 52 && seq >= 1 && seq <= 4;
}

function weekSortKey(value) {
  const m = String(value || '').match(/^(\d{2})-(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 10 + Number(m[2]);
}

function buildDataWeekOptions(dbWeeks = []) {
  return [...new Set(dbWeeks.map(toChatOrderWeek).filter(isValidOrderWeek))]
    .sort((a, b) => weekSortKey(b) - weekSortKey(a));
}

function customerLabel(c) {
  if (!c) return '';
  return `${c.CustName || ''}${c.CustArea ? ` / ${c.CustArea}` : ''}`.trim();
}

function productLabel(p) {
  if (!p) return '';
  const name = p.DisplayName || p.ProdName || '';
  const group = [p.CounName, p.FlowerName].filter(Boolean).join(' / ');
  return `${name}${group ? ` / ${group}` : ''}`.trim();
}

function customerMatchesQuery(customer, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return [
    customer?.CustName,
    customer?.CustArea,
    customer?.Manager,
    customer?.OrderCode,
    customer?.CustCode,
  ].some(v => String(v || '').toLowerCase().includes(q));
}

function cleanDirectText(content) {
  return String(content || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^(제가 이해한 조건|검색 경로|조회된 후보\/행):/.test(line))
    .join('\n');
}

function cardToPlainText(card) {
  if (!card) return '';
  const lines = [];
  if (card.title) lines.push(card.title);
  if (card.subtitle) lines.push(card.subtitle);
  for (const row of card.rows || []) {
    const label = String(row?.label || '').trim();
    const value = String(row?.value || '').trim();
    if (label || value) lines.push(`${label}${label && value ? ' ' : ''}${value}`.trim());
  }
  if (card.footer) lines.push(card.footer);
  return lines.join('\n');
}

function messagesToDirectAnswer(messages = []) {
  const textLines = [];
  const cardLines = [];
  let hasDetailedText = false;
  for (const msg of messages || []) {
    if (msg.type === 'text') {
      if (String(msg.content || '').includes('\n\n')) hasDetailedText = true;
      const text = cleanDirectText(msg.content);
      if (text) {
        textLines.push(text);
      }
    } else if (msg.type === 'card') {
      const text = cardToPlainText(msg.card);
      if (text) cardLines.push(text);
    } else if (msg.type === 'cards') {
      for (const card of msg.cards || []) {
        const text = cardToPlainText(card);
        if (text) cardLines.push(text);
      }
    }
  }
  const lines = hasDetailedText ? textLines : [...textLines, ...cardLines];
  return lines.join('\n\n').trim() || '조회 결과가 없습니다.';
}

function introMessage(user) {
  return `안녕하세요, ${user?.userName || user?.userId || ''}님\n차수, 담당자, 업체, 품종을 선택해 버튼을 누르거나 자유롭게 질문하세요.`;
}

function normalizeSavedChatMessage(msg) {
  if (!msg || typeof msg !== 'object') return msg;
  if (typeof msg.content !== 'string') return msg;
  return {
    ...msg,
    content: msg.content
      .replace('상단 바로 조회에서 기준차수, 업체, 품종을 선택하거나 자유롭게 질문하세요.', '위에서 기준차수, 업체, 품종을 선택해 버튼을 누르거나 자유롭게 질문하세요.')
      .replace(/바로\s*조회/g, '질문 버튼'),
  };
}

export default function MobileChat() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingStage, setLoadingStage] = useState(''); // 로딩 단계 표시
  const [directOpen, setDirectOpen] = useState(true);
  const [modifyOpen, setModifyOpen] = useState(false);
  const [weeks, setWeeks] = useState([]);
  const [directWeek, setDirectWeek] = useState('');
  const [shipmentWeek2, setShipmentWeek2] = useState('');
  const [allCustomers, setAllCustomers] = useState([]);
  const [selectedManager, setSelectedManager] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [productQuery, setProductQuery] = useState('');
  const [productOptions, setProductOptions] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const scrollRef = useRef(null);

  // ── localStorage 영속 히스토리 키
  const HISTORY_KEY = 'nenova_chat_history_v1';

  // 로컬 저장
  const saveHistory = (msgs) => {
    try {
      // 최근 100개만 저장 (용량 제한)
      const toSave = msgs.slice(-100);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(toSave));
    } catch (_) { /* quota exceeded 무시 */ }
  };

  // 로컬 로드
  const loadHistory = () => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return null;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr) || arr.length === 0) return null;
      return arr.map(normalizeSavedChatMessage);
    } catch (_) { return null; }
  };

  // ── 인증 체크 (기존 PC 세션 재사용)
  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => {
        if (d?.success && d?.user) {
          setMe(d.user);
          // 로컬 히스토리 복원 (있으면)
          const saved = loadHistory();
          if (saved && saved.length > 0) {
            setMessages(saved);
          } else {
            setMessages([
              {
                role: 'bot',
                type: 'text',
                content: introMessage(d.user),
                ts: Date.now(),
              },
            ]);
          }
        } else {
          router.replace('/login?next=/m/chat');
        }
      })
      .catch(() => router.replace('/login?next=/m/chat'))
      .finally(() => setAuthChecked(true));
  }, [router]);

  useEffect(() => {
    if (!authChecked || !me) return;
    fetch('/api/orders/weeks')
      .then(r => r.json())
      .then(d => {
        const list = buildDataWeekOptions((d.weeks || []).filter(Boolean));
        // 기본 기준차수 = 오늘 날짜 기준 현재 차수(예: '23-01'). 목록 최대값(52-02 등) 아님.
        const cur = toChatOrderWeek(getCurrentWeek());
        const merged = (cur && !list.includes(cur)) ? [cur, ...list] : list;
        setWeeks(merged);
        setDirectWeek(prev => (prev && merged.includes(toChatOrderWeek(prev)) ? toChatOrderWeek(prev) : (cur || merged[0] || '')));
      })
      .catch(() => {
        setWeeks([]);
        setDirectWeek('');
      });
  }, [authChecked, me]);

  useEffect(() => {
    if (!authChecked || !me) return;
    fetch('/api/customers/search')
      .then(r => r.json())
      .then(d => setAllCustomers(d.customers || []))
      .catch(() => setAllCustomers([]));
  }, [authChecked, me]);

  const managerOptions = useMemo(() => (
    [...new Set(allCustomers.map(c => c.Manager || '미지정'))]
      .sort((a, b) => a.localeCompare(b, 'ko'))
  ), [allCustomers]);

  const customerOptions = useMemo(() => {
    let list = allCustomers;
    if (selectedManager) {
      list = list.filter(c => (c.Manager || '미지정') === selectedManager);
    }
    list = list.filter(c => customerMatchesQuery(c, customerQuery));
    return list
      .sort((a, b) => `${a.CustArea || ''}${a.CustName || ''}`.localeCompare(`${b.CustArea || ''}${b.CustName || ''}`, 'ko'))
      .slice(0, 30);
  }, [allCustomers, selectedManager, customerQuery]);

  useEffect(() => {
    const q = productQuery.trim();
    if (q.length < 1) {
      setProductOptions([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/products/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then(r => r.json())
        .then(d => setProductOptions((d.products || []).slice(0, 12)))
        .catch(() => {});
    }, 180);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [productQuery]);

  // ── 메시지 스크롤 + localStorage 자동 저장
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    if (messages.length > 0) saveHistory(messages);
  }, [messages, sending]);

  // ── 메시지 전송 (payload 는 structured intent — 선택지 버튼에서 전달)
  async function send(text, payload = null, options = {}) {
    const q = (text ?? input).trim();
    if (!q || sending) return;
    setInput('');
    const userMsg = { role: 'user', type: 'text', content: q, ts: Date.now() };
    setMessages(m => [...m, userMsg]);
    setSending(true);

    // 로딩 단계 시뮬레이션 (실제 타이밍에 맞춰)
    setLoadingStage('질문 분석 중...');
    const t1 = setTimeout(() => setLoadingStage('DB 조회 중...'), 1500);
    const t2 = setTimeout(() => setLoadingStage('답변 작성 중...'), 4000);
    const t3 = setTimeout(() => setLoadingStage('생각이 길어져요 (최대 20초)...'), 10000);

    try {
      const clientHistory = messages.slice(-12).map(m => ({
        role: m.role,
        type: m.type,
        content: m.content || '',
        card: m.card || null,
        cards: m.cards || null,
        payload: m.payload || null,
      }));
      const r = await fetch('/api/m/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q, payload, clientHistory }),
      });
      const d = await r.json();
      if (d?.success) {
        const rawMessages = d.messages || [{ type: 'text', content: d.content || '...' }];
        const visibleMessages = options.directAnswerOnly
          ? [{ type: 'text', content: messagesToDirectAnswer(rawMessages) }]
          : rawMessages;
        const botMsgs = visibleMessages.map(m => ({
          role: 'bot',
          ...m,
          ts: Date.now(),
        }));
        setMessages(m => [...m, ...botMsgs]);
      } else {
        setMessages(m => [...m, { role: 'bot', type: 'text', content: `⚠️ ${d?.error || '오류가 발생했습니다.'}`, ts: Date.now() }]);
      }
    } catch (e) {
      setMessages(m => [...m, { role: 'bot', type: 'text', content: `⚠️ 네트워크 오류: ${e.message}`, ts: Date.now() }]);
    } finally {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      setLoadingStage('');
      setSending(false);
    }
  }

  function sendDirect(kind) {
    const week = toChatOrderWeek(directWeek);
    if (!week || sending) return;
    const prod = selectedProduct;
    const cust = selectedCustomer;
    const week2 = toChatOrderWeek(shipmentWeek2);
    const shipmentWeeks = [...new Set([week, week2].filter(isValidOrderWeek))];
    if (kind === 'farm' && !prod?.ProdKey) return;
    if (kind === 'shipment' && !cust?.CustKey) return;

    if (kind === 'stock') {
      setDirectOpen(false);
      send(`${formatWeekDisplayLocal(week)} 재고 확인`, {
        intent: 'stock',
        mode: 'weekStockStatus',
        week,
        hideZero: true,
      }, { directAnswerOnly: true });
      return;
    }
    if (kind === 'farm') {
      setDirectOpen(false);
      send(`${formatWeekDisplayLocal(week)} ${prod.DisplayName || prod.ProdName} 농장 품목수량확인`, {
        intent: 'stock',
        mode: 'incomingFarm',
        week,
        prodKey: prod.ProdKey,
        groupBy: 'product',
      }, { directAnswerOnly: true });
      return;
    }
    if (kind === 'order') {
      setDirectOpen(false);
      const label = cust?.CustKey
        ? `${formatWeekDisplayLocal(week)} ${cust.CustName} 주문 확인`
        : `${formatWeekDisplayLocal(week)} 주문 확인`;
      send(label, {
        intent: 'order',
        week,
        ...(cust?.CustKey ? { custKey: cust.CustKey, mode: 'byItem' } : {}),
      }, { directAnswerOnly: true });
      return;
    }
    setDirectOpen(false);
    const weekText = shipmentWeeks.map(formatWeekDisplayLocal).join(',');
    const managerText = selectedManager ? `${selectedManager} 담당 ` : '';
    const sumText = shipmentWeeks.length > 1 ? ' 합산수량' : '';
    send(`${weekText} ${managerText}${cust.CustName} 출고 수량 확인${sumText}`, {
      intent: 'shipment',
      mode: 'items',
      week: shipmentWeeks[0],
      weeks: shipmentWeeks,
      custKey: cust.CustKey,
      ...(selectedManager ? { manager: selectedManager } : {}),
      ...(prod?.ProdKey ? { prodKey: prod.ProdKey, prodName: prod.DisplayName || prod.ProdName } : {}),
    }, { directAnswerOnly: true });
  }

  if (!authChecked) {
    return (
      <div className="m-loading">
        <Head><title>모바일 챗 · 네노바</title></Head>
        로딩 중...
      </div>
    );
  }

  return (
    <div className="m-chat-root">
      <Head>
        <title>네노바 챗봇</title>
      </Head>

      {/* 상단 바 */}
      <header className="m-topbar">
        <button
          type="button"
          className="m-home-btn"
          aria-label="홈"
          onClick={() => {
            if (sending) return;
            setMessages([{
              role: 'bot',
              type: 'text',
              content: introMessage(me),
              ts: Date.now(),
            }]);
            setInput('');
            // 로컬 히스토리도 정리
            try { localStorage.removeItem(HISTORY_KEY); } catch (_) {}
            // 서버 대화 기록도 초기화 (실패해도 UI 는 리셋됨)
            fetch('/api/m/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reset: true }),
            }).catch(() => {});
          }}
        >
          🏠
        </button>
        <div className="m-topbar-title">
          <span className="m-logo">🌸</span>
          <span>네노바 챗봇</span>
          <span className="m-version">{process.env.NEXT_PUBLIC_BUILD_VERSION || 'v?'}</span>
        </div>
        <div className="m-topbar-user">
          {me?.userName || me?.userId}
        </div>
      </header>

      <DirectLookupPanel
        open={directOpen}
        setOpen={setDirectOpen}
        weeks={weeks}
        week={directWeek}
        setWeek={setDirectWeek}
        shipmentWeek2={shipmentWeek2}
        setShipmentWeek2={setShipmentWeek2}
        managerOptions={managerOptions}
        selectedManager={selectedManager}
        setSelectedManager={(manager) => {
          setSelectedManager(manager);
          setSelectedCustomer(null);
          setCustomerQuery('');
        }}
        customerQuery={customerQuery}
        setCustomerQuery={setCustomerQuery}
        customerOptions={customerOptions}
        selectedCustomer={selectedCustomer}
        setSelectedCustomer={setSelectedCustomer}
        productQuery={productQuery}
        setProductQuery={setProductQuery}
        productOptions={productOptions}
        selectedProduct={selectedProduct}
        setSelectedProduct={setSelectedProduct}
        sending={sending}
        onRun={sendDirect}
        onOpenModify={() => { setDirectOpen(false); setModifyOpen(true); }}
      />

      <OrderModifyPanel
        open={modifyOpen}
        setOpen={setModifyOpen}
        week={toChatOrderWeek(directWeek)}
      />

      {/* 메시지 영역 */}
      <div className="m-messages" ref={scrollRef}>
        {messages.map((m, i) => (
          <MessageBubble key={i} msg={m} onQuickAction={send} />
        ))}
        {sending && (
          <div className="m-msg bot">
            <div className="m-bubble bot typing">
              <span /><span /><span />
              {loadingStage && <div className="m-loading-stage">{loadingStage}</div>}
            </div>
          </div>
        )}
      </div>

      {/* 입력 영역 */}
      <form
        className="m-inputbar"
        onSubmit={e => { e.preventDefault(); send(); }}
      >
        <input
          type="text"
          className="m-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="질문을 입력하세요..."
          autoComplete="off"
          disabled={sending}
        />
        <button
          type="submit"
          className="m-send-btn"
          disabled={sending || !input.trim()}
          aria-label="전송"
        >
          ➤
        </button>
      </form>

      <style jsx global>{`
        html, body, #__next { height: 100%; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', '맑은 고딕', sans-serif;
          background: #F5F7FA;
          color: #1a202c;
          -webkit-font-smoothing: antialiased;
        }
        * { box-sizing: border-box; }
        button { font-family: inherit; }
      `}</style>

      <style jsx>{`
        .m-loading {
          display: flex; align-items: center; justify-content: center;
          height: 100vh; color: #666; font-size: 14px;
        }
        .m-chat-root {
          display: flex;
          flex-direction: column;
          height: 100vh;
          height: 100dvh;
          max-width: 768px;
          margin: 0 auto;
          background: #F5F7FA;
          padding-bottom: env(safe-area-inset-bottom);
        }
        .m-topbar {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          background: #2b6cb0;
          color: white;
          padding-top: calc(12px + env(safe-area-inset-top));
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .m-home-btn {
          flex-shrink: 0;
          width: 36px;
          height: 36px;
          border: none;
          border-radius: 50%;
          background: rgba(255,255,255,0.18);
          color: white;
          font-size: 18px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .m-home-btn:active { background: rgba(255,255,255,0.3); }
        .m-topbar-title { flex: 1; }
        .m-topbar-title {
          display: flex; align-items: center; gap: 8px;
          font-weight: 700; font-size: 16px;
        }
        .m-version {
          font-size: 10px;
          font-weight: 500;
          opacity: 0.7;
          padding: 2px 6px;
          background: rgba(255,255,255,0.15);
          border-radius: 4px;
          letter-spacing: 0.2px;
          font-family: 'Menlo','Monaco',monospace;
        }
        .m-logo { font-size: 20px; }
        .m-topbar-user {
          font-size: 12px;
          opacity: 0.85;
          padding: 4px 10px;
          background: rgba(255,255,255,0.15);
          border-radius: 12px;
        }
        .m-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          -webkit-overflow-scrolling: touch;
        }
        .m-inputbar {
          flex-shrink: 0;
          display: flex;
          gap: 8px;
          padding: 10px 12px;
          background: white;
          border-top: 1px solid #E2E8F0;
          padding-bottom: calc(10px + env(safe-area-inset-bottom));
        }
        .m-input {
          flex: 1;
          padding: 10px 14px;
          border: 1px solid #CBD5E0;
          border-radius: 20px;
          font-size: 15px;
          background: #F7FAFC;
          outline: none;
          min-height: 40px;
        }
        .m-input:focus { border-color: #2b6cb0; background: white; }
        .m-send-btn {
          width: 40px; height: 40px;
          border: none;
          border-radius: 50%;
          background: #2b6cb0;
          color: white;
          font-size: 16px;
          cursor: pointer;
          flex-shrink: 0;
        }
        .m-send-btn:disabled { background: #A0AEC0; cursor: not-allowed; }
      `}</style>
    </div>
  );
}

function DirectLookupPanel({
  open,
  setOpen,
  weeks,
  week,
  setWeek,
  shipmentWeek2,
  setShipmentWeek2,
  managerOptions,
  selectedManager,
  setSelectedManager,
  customerQuery,
  setCustomerQuery,
  customerOptions,
  selectedCustomer,
  setSelectedCustomer,
  productQuery,
  setProductQuery,
  productOptions,
  selectedProduct,
  setSelectedProduct,
  sending,
  onRun,
  onOpenModify,
}) {
  return (
    <section className={`m-direct ${open ? 'open' : 'closed'}`}>
      <button type="button" className="m-direct-toggle" onClick={() => setOpen(!open)}>
        <span>🔎 기준차수 빠른조회</span>
        <span className="m-direct-status">
          {week ? formatWeekDisplayLocal(week) : '차수 선택'}{shipmentWeek2 ? ` + ${formatWeekDisplayLocal(shipmentWeek2)}` : ''}{selectedManager ? ` · ${selectedManager}` : ''}{selectedCustomer ? ` · ${selectedCustomer.CustName}` : ''}{selectedProduct ? ` · ${selectedProduct.DisplayName || selectedProduct.ProdName}` : ''}
        </span>
        <span>{open ? '접기' : '열기'}</span>
      </button>
      {open && (
        <div className="m-direct-body">
          <WeekWheel weeks={weeks} value={week} onChange={setWeek} />

          {/* 기준차수만으로 바로 결과 — 패스트 트랙 */}
          <div className="m-direct-actions fast">
            <button type="button" disabled={sending || !week} onClick={() => onRun('stock')}>📦 재고확인</button>
            <button type="button" disabled={sending || !week} onClick={() => onRun('order')}>📋 주문확인</button>
            <button type="button" disabled={sending || !week} onClick={onOpenModify}>✏️ 주문수정</button>
          </div>
          <div className="m-direct-sub">아래에서 업체·품목을 선택하면 출고량·농장 확인이 활성화됩니다</div>

          <WeekSelectField
            label="출고 합산차수"
            weeks={weeks}
            value={shipmentWeek2}
            onChange={setShipmentWeek2}
          />

          <ManagerSelect
            managers={managerOptions}
            value={selectedManager}
            onChange={setSelectedManager}
          />

          <SearchPickField
            label="업체선택"
            value={customerQuery}
            setValue={(v) => { setCustomerQuery(v); setSelectedCustomer(null); }}
            placeholder={selectedManager ? `${selectedManager} 업체 검색` : '업체명 입력'}
            selectedText={selectedCustomer ? customerLabel(selectedCustomer) : ''}
            onClear={() => { setSelectedCustomer(null); setCustomerQuery(''); }}
            options={customerOptions}
            optionKey="CustKey"
            renderOption={customerLabel}
            onPick={(c) => { setSelectedCustomer(c); setCustomerQuery(c.CustName || ''); }}
          />

          <SearchPickField
            label="품종"
            value={productQuery}
            setValue={(v) => { setProductQuery(v); setSelectedProduct(null); }}
            placeholder="품목명 입력"
            selectedText={selectedProduct ? productLabel(selectedProduct) : ''}
            onClear={() => { setSelectedProduct(null); setProductQuery(''); }}
            options={productOptions}
            optionKey="ProdKey"
            renderOption={productLabel}
            onPick={(p) => { setSelectedProduct(p); setProductQuery(p.DisplayName || p.ProdName || ''); }}
          />

          <div className="m-direct-actions">
            <button
              type="button"
              disabled={sending || !week || !selectedCustomer}
              onClick={() => onRun('shipment')}
            >
              🚚 출고량확인
            </button>
            <button
              type="button"
              disabled={sending || !week || !selectedProduct}
              onClick={() => onRun('farm')}
            >
              🌾 농장확인
            </button>
          </div>
        </div>
      )}
      <style jsx>{`
        .m-direct {
          flex-shrink: 0;
          background: #fff;
          border-bottom: 1px solid #dbe3ea;
        }
        .m-direct-toggle {
          width: 100%;
          min-height: 40px;
          border: 0;
          background: #f8fafc;
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 8px;
          align-items: center;
          padding: 8px 12px;
          color: #1e293b;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
          text-align: left;
        }
        .m-direct-status {
          min-width: 0;
          color: #64748b;
          font-weight: 700;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
        .m-direct-body {
          display: grid;
          gap: 8px;
          padding: 10px 12px 12px;
        }
        .m-direct-field {
          display: grid;
          gap: 4px;
          font-size: 11px;
          color: #475569;
          font-weight: 800;
        }
        .m-direct-field input {
          width: 100%;
          min-height: 34px;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          padding: 0 10px;
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
          background: #fff;
        }
        .m-direct-actions {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 6px;
        }
        .m-direct-actions button {
          min-height: 36px;
          border: 0;
          border-radius: 8px;
          background: #2563eb;
          color: #fff;
          font-size: 11px;
          font-weight: 900;
          cursor: pointer;
        }
        .m-direct-actions button:nth-child(2) { background: #0f766e; }
        .m-direct-actions button:nth-child(3) { background: #7c3aed; }
        .m-direct-actions.fast button:nth-child(3) { background: #ea580c; }
        .m-direct-sub { font-size: 10px; color: #64748b; font-weight: 700; text-align: center; margin: -2px 0 2px; }
        .m-direct-actions button:disabled {
          background: #cbd5e1;
          color: #64748b;
          cursor: not-allowed;
        }
      `}</style>
    </section>
  );
}

function WeekSelectField({ label, weeks, value, onChange }) {
  const list = weeks?.length ? weeks : [];
  return (
    <label className="m-small-select">
      <span>{label}</span>
      <select value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">선택 안함</option>
        {list.slice(0, 80).map(w => (
          <option key={w} value={w}>{formatWeekDisplayLocal(w)}</option>
        ))}
      </select>
      <style jsx>{`
        .m-small-select {
          display: grid;
          gap: 4px;
          color: #475569;
          font-size: 11px;
          font-weight: 900;
        }
        .m-small-select select {
          width: 100%;
          min-height: 34px;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          padding: 0 10px;
          background: #fff;
          color: #0f172a;
          font-size: 13px;
          font-weight: 800;
        }
      `}</style>
    </label>
  );
}

function ManagerSelect({ managers, value, onChange }) {
  return (
    <label className="m-small-select">
      <span>담당자선택</span>
      <select value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">전체 담당자</option>
        {(managers || []).map(m => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      <style jsx>{`
        .m-small-select {
          display: grid;
          gap: 4px;
          color: #475569;
          font-size: 11px;
          font-weight: 900;
        }
        .m-small-select select {
          width: 100%;
          min-height: 34px;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          padding: 0 10px;
          background: #fff;
          color: #0f172a;
          font-size: 13px;
          font-weight: 800;
        }
      `}</style>
    </label>
  );
}

function WeekWheel({ weeks, value, onChange }) {
  const list = weeks?.length ? weeks : [];
  const selected = isValidOrderWeek(toChatOrderWeek(value)) ? toChatOrderWeek(value) : list[0];
  const wheelRef = useRef(null);

  useEffect(() => {
    const el = wheelRef.current;
    if (!el) return;
    const active = el.querySelector(`button[data-week="${selected}"]`);
    if (active) active.scrollIntoView({ block: 'center' });
  }, [selected]);

  return (
    <div className="m-week-box">
      <div className="m-week-head">
        <span>기준차수</span>
        <span>{selected ? formatWeekDisplayLocal(selected) : '데이터 없음'}</span>
      </div>
      <div className="m-week-wheel" aria-label="기준차수 선택" ref={wheelRef}>
        {list.length === 0 ? (
          <div className="m-week-empty">실제 데이터가 있는 차수가 없습니다.</div>
        ) : list.slice(0, 80).map(w => {
          const active = w === selected;
          return (
            <button
              type="button"
              key={w}
              data-week={w}
              className={active ? 'active' : ''}
              onClick={() => onChange(w)}
            >
              {formatWeekDisplayLocal(w)}
            </button>
          );
        })}
      </div>
      <div className="m-week-help">NENOVA.EXE 운영 데이터가 있는 차수만 표시합니다.</div>
      <style jsx>{`
        .m-week-box {
          display: grid;
          gap: 5px;
        }
        .m-week-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          color: #475569;
          font-size: 11px;
          font-weight: 900;
        }
        .m-week-head span:last-child {
          color: #1d4ed8;
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          border-radius: 999px;
          padding: 2px 8px;
        }
        .m-week-wheel {
          height: 96px;
          overflow-y: auto;
          display: grid;
          gap: 4px;
          padding: 4px;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          background: #f8fafc;
          scroll-snap-type: y mandatory;
          -webkit-overflow-scrolling: touch;
        }
        .m-week-wheel button {
          min-height: 30px;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          background: #fff;
          color: #334155;
          font-size: 13px;
          font-weight: 800;
          cursor: pointer;
          scroll-snap-align: center;
        }
        .m-week-wheel button.active {
          background: #2563eb;
          color: #fff;
          border-color: #2563eb;
          box-shadow: 0 2px 8px rgba(37, 99, 235, 0.25);
        }
        .m-week-empty {
          min-height: 84px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
        }
        .m-week-help {
          color: #64748b;
          font-size: 11px;
          line-height: 1.3;
        }
      `}</style>
    </div>
  );
}

function SearchPickField({ label, value, setValue, placeholder, selectedText, onClear, options, optionKey, renderOption, onPick }) {
  return (
    <label className="m-pick-field">
      <span>{label}</span>
      {selectedText ? (
        <div className="m-picked">
          <span>{selectedText}</span>
          <button type="button" onClick={onClear}>변경</button>
        </div>
      ) : (
        <>
          <input
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={placeholder}
          />
          {options.length > 0 && (
            <div className="m-pick-list">
              {options.map(o => (
                <button
                  type="button"
                  key={o[optionKey]}
                  onClick={() => onPick(o)}
                >
                  {renderOption(o)}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <style jsx>{`
        .m-pick-field {
          display: grid;
          gap: 4px;
          font-size: 11px;
          color: #475569;
          font-weight: 800;
          position: relative;
        }
        .m-pick-field input {
          width: 100%;
          min-height: 34px;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          padding: 0 10px;
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
          background: #fff;
        }
        .m-picked {
          min-height: 34px;
          border: 1px solid #bae6fd;
          border-radius: 8px;
          padding: 6px 7px 6px 10px;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          align-items: center;
          background: #f0f9ff;
          color: #0f172a;
          font-size: 12px;
          font-weight: 800;
        }
        .m-picked span {
          min-width: 0;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
        .m-picked button {
          min-height: 24px;
          border: 1px solid #7dd3fc;
          border-radius: 6px;
          background: #fff;
          color: #0369a1;
          font-size: 11px;
          font-weight: 900;
          cursor: pointer;
        }
        .m-pick-list {
          max-height: 138px;
          overflow: auto;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          background: #fff;
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
        }
        .m-pick-list button {
          width: 100%;
          min-height: 34px;
          border: 0;
          border-bottom: 1px solid #eef2f7;
          background: #fff;
          color: #0f172a;
          font-size: 12px;
          font-weight: 700;
          text-align: left;
          padding: 7px 10px;
          cursor: pointer;
        }
        .m-pick-list button:active { background: #eff6ff; }
      `}</style>
    </label>
  );
}

// ── 메시지 버블 컴포넌트
function MessageBubble({ msg, onQuickAction }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`m-msg ${isUser ? 'user' : 'bot'}`}>
      <div className={`m-bubble ${isUser ? 'user' : 'bot'}`}>
        {msg.type === 'text' && <div className="m-bubble-text">{msg.content}</div>}
        {msg.type === 'card' && <CardBlock card={msg.card} />}
        {msg.type === 'cards' && (
          <div className="m-cards-group">
            {(msg.cards || []).map((c, i) => <CardBlock key={i} card={c} />)}
          </div>
        )}
        {msg.type === 'actions' && (
          <div className="m-actions">
            {(msg.actions || []).map((a, i) => (
              <button
                key={i}
                className={`m-action-btn ${a.primary ? 'primary' : ''}`}
                onClick={() => onQuickAction(a.text, a.payload || null)}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
        {msg.type === 'choices' && (
          <div className="m-choices">
            {msg.prompt && <div className="m-choices-prompt">{msg.prompt}</div>}
            <div className="m-choices-list">
              {(msg.choices || []).map((c, i) => (
                <button
                  key={i}
                  className="m-choice-btn"
                  onClick={() => onQuickAction(c.text || c.label, c.payload || null)}
                >
                  <span className="m-choice-label">{c.label}</span>
                  {c.sub && <span className="m-choice-sub">{c.sub}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <style jsx>{`
        .m-msg { display: flex; }
        .m-msg.user { justify-content: flex-end; }
        .m-msg.bot { justify-content: flex-start; }
        .m-bubble {
          max-width: 85%;
          padding: 10px 14px;
          border-radius: 16px;
          font-size: 14px;
          line-height: 1.5;
          white-space: pre-wrap;
          word-break: break-word;
          box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        }
        .m-bubble.user {
          background: #2b6cb0;
          color: white;
          border-bottom-right-radius: 4px;
        }
        .m-bubble.bot {
          background: white;
          color: #2D3748;
          border-bottom-left-radius: 4px;
        }
        .m-bubble.typing {
          display: flex; align-items: center; flex-wrap: wrap;
          gap: 4px; padding: 12px 16px;
        }
        .m-loading-stage {
          flex-basis: 100%;
          font-size: 11px; color: #718096;
          margin-top: 4px;
        }
        .m-bubble.typing span {
          width: 6px; height: 6px; border-radius: 50%;
          background: #A0AEC0;
          animation: typing 1.4s infinite;
        }
        .m-bubble.typing span:nth-child(2) { animation-delay: 0.2s; }
        .m-bubble.typing span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes typing {
          0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-4px); }
        }
        .m-cards-group { display: flex; flex-direction: column; gap: 8px; }
        .m-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
        .m-action-btn {
          padding: 6px 12px;
          border: 1px solid #CBD5E0;
          background: white;
          border-radius: 14px;
          font-size: 12px;
          cursor: pointer;
        }
        .m-action-btn:active { background: #EDF2F7; }
        .m-action-btn.primary {
          background: #2b6cb0; color: white; border-color: #2b6cb0;
        }
        .m-action-btn.primary:active { background: #1e4e8c; }
        .m-choices { margin-top: 6px; }
        .m-choices-prompt {
          font-size: 12px; color: #4A5568; margin-bottom: 6px; font-weight: 600;
        }
        .m-choices-list {
          display: flex; flex-direction: column; gap: 6px;
        }
        .m-choice-btn {
          display: flex; flex-direction: column; align-items: flex-start;
          gap: 2px;
          padding: 10px 12px;
          border: 1px solid #CBD5E0;
          background: white;
          border-radius: 10px;
          font-size: 13px;
          cursor: pointer;
          text-align: left;
          min-height: 44px;
          width: 100%;
        }
        .m-choice-btn:active { background: #EDF2F7; border-color: #2b6cb0; }
        .m-choice-label { font-weight: 600; color: #1A202C; }
        .m-choice-sub { font-size: 11px; color: #718096; }
      `}</style>
    </div>
  );
}

// ── 결과 카드 컴포넌트 (Phase 3에서 확장)
function CardBlock({ card }) {
  if (!card) return null;
  return (
    <div className="m-card">
      {card.title && <div className="m-card-title">{card.title}</div>}
      {card.subtitle && <div className="m-card-subtitle">{card.subtitle}</div>}
      {card.rows && (
        <div className="m-card-rows">
          {card.rows.map((r, i) => (
            <div key={i} className="m-card-row">
              <span className="m-card-label">{r.label}</span>
              <span className="m-card-value">{r.value}</span>
            </div>
          ))}
        </div>
      )}
      {card.footer && <div className="m-card-footer">{card.footer}</div>}
      <style jsx>{`
        .m-card {
          background: #F7FAFC;
          border: 1px solid #E2E8F0;
          border-radius: 10px;
          padding: 10px 12px;
          font-size: 13px;
        }
        .m-card-title { font-weight: 700; color: #1A202C; margin-bottom: 2px; }
        .m-card-subtitle { font-size: 11px; color: #718096; margin-bottom: 6px; }
        .m-card-rows { display: flex; flex-direction: column; gap: 3px; }
        .m-card-row {
          display: flex; justify-content: space-between; align-items: baseline;
        }
        .m-card-label { color: #4A5568; font-size: 12px; }
        .m-card-value { color: #1A202C; font-weight: 600; }
        .m-card-footer { margin-top: 6px; padding-top: 6px; border-top: 1px solid #E2E8F0; font-size: 11px; color: #718096; }
      `}</style>
    </div>
  );
}
