// Browser-only local PDF preview for packing evidence review.
// No upload, CDN, font fetch, OCR, server call, or ERP interaction.
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(MAX_PDF_BYTES / 3) * 4;
const MAX_PAGES = 100;
const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
const MAX_CANVAS_EDGE = 8192;
const MAX_CSS_EDGE = 20000;
const OPERATION_TIMEOUT_MS = 60000;

function decodePdf(base64) {
  if (typeof base64 !== 'string' || !base64.trim()) {
    throw new Error('PDF base64 데이터가 없습니다.');
  }
  if (base64.length > MAX_BASE64_LENGTH) throw new Error('PDF는 20MiB 이하여야 합니다.');
  const encoded = base64.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
    || encoded.length % 4 === 1
    || (encoded.includes('=') && encoded.length % 4 !== 0)) {
    throw new Error('올바른 PDF base64 데이터가 아닙니다.');
  }
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const size = Math.floor(encoded.length * 3 / 4) - padding;
  if (size < 1 || size > MAX_PDF_BYTES) throw new Error('PDF 크기는 1바이트 이상, 20MiB 이하여야 합니다.');
  let binary;
  try { binary = globalThis.atob(encoded); }
  catch { throw new Error('PDF base64 데이터를 해석하지 못했습니다.'); }
  if (!binary.length || binary.length > MAX_PDF_BYTES) {
    throw new Error('PDF 크기는 1바이트 이상, 20MiB 이하여야 합니다.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function isValidNormalizedBBox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) return false;
  const [x, y, width, height] = bbox;
  const epsilon = 1e-7;
  return x >= 0 && y >= 0 && width > 0 && height > 0
    && x <= 1 && y <= 1 && x + width <= 1 + epsilon && y + height <= 1 + epsilon;
}

/** Return the text items participating in one and only one exact quote match. */
export function findUniqueQuoteItems(items, quote) {
  if (!Array.isArray(items) || typeof quote !== 'string' || !quote || !quote.trim()) return null;
  const entries = [];
  let pageText = '';
  for (const item of items) {
    if (!item || typeof item.str !== 'string' || !item.str.length) continue;
    if (pageText.length) pageText += ' ';
    const start = pageText.length;
    pageText += item.str;
    entries.push({ item, start, end: pageText.length });
  }
  if (!pageText || quote.length > pageText.length) return null;

  const matches = [];
  let offset = 0;
  while (offset <= pageText.length - quote.length) {
    const index = pageText.indexOf(quote, offset);
    if (index < 0) break;
    matches.push(index);
    if (matches.length > 1) return null;
    offset = index + 1;
  }
  if (matches.length !== 1) return null;
  const start = matches[0];
  const end = start + quote.length;
  const matched = entries.filter(entry => entry.end > start && entry.start < end).map(entry => entry.item);
  return matched.length ? matched : null;
}

function itemViewportRect(pdfjs, viewport, item) {
  if (!Array.isArray(item?.transform) || item.transform.length < 6 || !Number.isFinite(item.width)) return null;
  const transform = pdfjs.Util.transform(viewport.transform, item.transform);
  if (!transform.every(Number.isFinite)) return null;
  const directionLength = Math.hypot(transform[0], transform[1]);
  const width = Math.abs(item.width * viewport.scale);
  if (!(directionLength > 0) || !(width > 0)) return null;
  const alongX = transform[0] / directionLength * width;
  const alongY = transform[1] / directionLength * width;
  const verticalX = transform[2];
  const verticalY = transform[3];
  const points = [
    [transform[4], transform[5]],
    [transform[4] + alongX, transform[5] + alongY],
    [transform[4] + verticalX, transform[5] + verticalY],
    [transform[4] + alongX + verticalX, transform[5] + alongY + verticalY],
  ];
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function unionNormalizedRects(rects, viewport) {
  if (!rects.length || !(viewport.width > 0) || !(viewport.height > 0)) return null;
  const left = Math.min(...rects.map(rect => rect[0]));
  const top = Math.min(...rects.map(rect => rect[1]));
  const right = Math.max(...rects.map(rect => rect[2]));
  const bottom = Math.max(...rects.map(rect => rect[3]));
  const paddingX = Math.min(3 / viewport.width, 0.01);
  const paddingY = Math.min(2 / viewport.height, 0.01);
  const x = Math.max(0, left / viewport.width - paddingX);
  const y = Math.max(0, top / viewport.height - paddingY);
  const boundedRight = Math.min(1, right / viewport.width + paddingX);
  const boundedBottom = Math.min(1, bottom / viewport.height + paddingY);
  const bbox = [x, y, boundedRight - x, boundedBottom - y];
  return isValidNormalizedBBox(bbox) ? bbox : null;
}

async function boundedDestroy(loadingTask) {
  if (!loadingTask) return;
  let timer;
  try {
    await Promise.race([
      loadingTask.destroy(),
      new Promise(resolve => { timer = globalThis.setTimeout(resolve, 2000); }),
    ]);
  } catch {
    // A failed worker may not acknowledge teardown; its native port is still terminated below.
  } finally {
    if (timer != null) globalThis.clearTimeout(timer);
  }
}

export async function loadPdfPreview(base64) {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    throw new Error('PDF 미리보기는 Web Worker를 지원하는 브라우저에서만 가능합니다.');
  }
  const data = decodePdf(base64);
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
  let nativeWorker;
  let pdfWorker;
  let loadingTask;
  let pdf;
  let destroyed = false;
  let activeRender = null;
  let renderGeneration = 0;
  let rejectWorkerFailure;
  const pagePromises = new Map();
  const textPromises = new Map();
  const workerFailure = new Promise((_, reject) => { rejectWorkerFailure = reject; });
  workerFailure.catch(() => {});

  const failWorker = message => rejectWorkerFailure?.(new Error(message));
  const onWorkerError = () => failWorker('로컬 PDF worker를 불러오거나 실행하지 못했습니다.');
  const onMessageError = () => failWorker('로컬 PDF worker 통신에 실패했습니다.');
  const raceWorker = (promise, timeoutMessage) => {
    let timer;
    return Promise.race([
      promise,
      workerFailure,
      new Promise((_, reject) => {
        timer = globalThis.setTimeout(() => reject(new Error(timeoutMessage)), OPERATION_TIMEOUT_MS);
      }),
    ]).finally(() => {
      if (timer != null) globalThis.clearTimeout(timer);
    });
  };

  const cancelActiveRender = async () => {
    if (!activeRender) return;
    const render = activeRender;
    activeRender = null;
    try { render.task.cancel(); } catch { /* already complete */ }
    try { await render.promise; } catch { /* cancellation is expected */ }
  };

  const destroy = async () => {
    if (destroyed) return;
    destroyed = true;
    renderGeneration += 1;
    await cancelActiveRender();
    if (nativeWorker) {
      nativeWorker.removeEventListener('error', onWorkerError);
      nativeWorker.removeEventListener('messageerror', onMessageError);
    }
    try {
      await boundedDestroy(loadingTask);
    } finally {
      try { pdfWorker?.destroy(); }
      finally { nativeWorker?.terminate(); }
    }
    pagePromises.clear();
    textPromises.clear();
  };

  try {
    // This literal form lets webpack emit the installed worker as a same-origin asset.
    nativeWorker = new Worker(new URL('./importAwbWorker.js', import.meta.url), { type: 'module' });
    nativeWorker.addEventListener('error', onWorkerError);
    nativeWorker.addEventListener('messageerror', onMessageError);
    pdfWorker = new pdfjs.PDFWorker({ port: nativeWorker });
    loadingTask = pdfjs.getDocument({
      data,
      worker: pdfWorker,
      isEvalSupported: false,
      enableXfa: false,
      useWorkerFetch: false,
      useWasm: false,
      disableFontFace: true,
      useSystemFonts: false,
      // No URL, cMapUrl, standardFontDataUrl, wasmUrl, or remote fallback.
    });
    pdf = await raceWorker(loadingTask.promise, 'PDF 미리보기 준비 시간이 초과되었습니다.');
    if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1) {
      throw new Error('PDF에 읽을 수 있는 페이지가 없습니다.');
    }
    if (pdf.numPages > MAX_PAGES) throw new Error('PDF는 최대 100페이지까지 읽을 수 있습니다.');
  } catch (error) {
    await destroy();
    throw error;
  }

  const getPage = pageNumber => {
    if (destroyed) return Promise.reject(new Error('종료된 PDF 미리보기입니다.'));
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) {
      return Promise.reject(new Error('PDF 페이지 번호가 범위를 벗어났습니다.'));
    }
    if (!pagePromises.has(pageNumber)) {
      pagePromises.set(pageNumber, raceWorker(pdf.getPage(pageNumber), 'PDF 페이지 읽기 시간이 초과되었습니다.'));
    }
    return pagePromises.get(pageNumber);
  };

  const getTextContent = async pageNumber => {
    if (!textPromises.has(pageNumber)) {
      textPromises.set(pageNumber, (async () => {
        const page = await getPage(pageNumber);
        return raceWorker(page.getTextContent(), 'PDF 근거 위치 확인 시간이 초과되었습니다.');
      })());
    }
    return textPromises.get(pageNumber);
  };

  return {
    numPages: pdf.numPages,
    async renderPage(pageNumber, canvas, scale = 1) {
      if (destroyed) throw new Error('종료된 PDF 미리보기입니다.');
      if (!canvas || typeof canvas.getContext !== 'function') throw new Error('PDF canvas를 찾지 못했습니다.');
      if (!Number.isFinite(scale) || scale < 0.25 || scale > 4) throw new Error('PDF 확대 비율이 범위를 벗어났습니다.');
      const generation = ++renderGeneration;
      await cancelActiveRender();
      const page = await getPage(pageNumber);
      if (destroyed) throw new Error('종료된 PDF 미리보기입니다.');
      if (generation !== renderGeneration) return { cancelled: true };
      const viewport = page.getViewport({ scale });
      if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)
        || viewport.width <= 0 || viewport.height <= 0
        || viewport.width > MAX_CSS_EDGE || viewport.height > MAX_CSS_EDGE) {
        throw new Error('PDF 페이지 크기가 미리보기 허용 범위를 벗어났습니다.');
      }
      const cssPixels = Math.max(1, viewport.width * viewport.height);
      const deviceScale = Math.max(1, Number(globalThis.devicePixelRatio) || 1);
      const outputScale = Math.min(
        deviceScale,
        Math.sqrt(MAX_CANVAS_PIXELS / cssPixels),
        MAX_CANVAS_EDGE / viewport.width,
        MAX_CANVAS_EDGE / viewport.height,
      );
      if (!Number.isFinite(outputScale) || outputScale <= 0) {
        throw new Error('PDF 페이지 렌더링 크기를 계산하지 못했습니다.');
      }
      const pixelWidth = Math.max(1, Math.floor(viewport.width * outputScale));
      const pixelHeight = Math.max(1, Math.floor(viewport.height * outputScale));
      if (pixelWidth > MAX_CANVAS_EDGE || pixelHeight > MAX_CANVAS_EDGE
        || pixelWidth * pixelHeight > MAX_CANVAS_PIXELS) {
        throw new Error('PDF 페이지가 canvas 픽셀 한도를 초과했습니다.');
      }
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.style.width = `${Math.round(viewport.width * 100) / 100}px`;
      canvas.style.height = `${Math.round(viewport.height * 100) / 100}px`;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('PDF canvas를 초기화하지 못했습니다.');
      const task = page.render({
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
        background: 'rgb(255,255,255)',
      });
      const render = { task, promise: task.promise };
      if (generation !== renderGeneration) {
        try { task.cancel(); } catch { /* superseded before publication */ }
        return { cancelled: true };
      }
      activeRender = render;
      try {
        await raceWorker(task.promise, 'PDF 페이지 렌더링 시간이 초과되었습니다.');
        return { width: viewport.width, height: viewport.height, pixelWidth, pixelHeight, scale };
      } catch (error) {
        if (error?.name === 'RenderingCancelledException') return { cancelled: true };
        throw error;
      } finally {
        if (activeRender === render) activeRender = null;
      }
    },
    async locateEvidence(pageNumber, evidence) {
      if (destroyed) throw new Error('종료된 PDF 미리보기입니다.');
      const evidencePage = Number(evidence?.page);
      if (!Number.isInteger(evidencePage) || evidencePage < 1 || evidencePage > pdf.numPages || evidencePage !== pageNumber) {
        return { source: 'none', bbox: null, label: '위치 확인 필요' };
      }
      const page = await getPage(pageNumber);
      const content = await getTextContent(pageNumber);
      const matchedItems = findUniqueQuoteItems(content.items, evidence?.quote);
      if (matchedItems) {
        const viewport = page.getViewport({ scale: 1 });
        const rects = matchedItems.map(item => itemViewportRect(pdfjs, viewport, item)).filter(Boolean);
        const bbox = unionNormalizedRects(rects, viewport);
        if (bbox) return { source: 'text', bbox, label: '원문 일치 근거' };
      }
      if (isValidNormalizedBBox(evidence?.bbox)) {
        return { source: 'bbox', bbox: evidence.bbox.slice(), label: 'AI 추정 영역 · 직접 확인' };
      }
      return { source: 'none', bbox: null, label: '위치 확인 필요' };
    },
    destroy,
  };
}

export default loadPdfPreview;
