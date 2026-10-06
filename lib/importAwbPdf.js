// Browser-only replacement for the source HTML's extractPdfText and
// extractPdfPage1Items. No CDN, upload, OCR, server call or ERP interaction.
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 100;
const MAX_TEXT_LENGTH = 50000;
const MAX_BASE64_LENGTH = Math.ceil(MAX_PDF_BYTES / 3) * 4;

function decodePdf(base64) {
  if (typeof base64 !== 'string' || !base64.trim()) {
    throw new Error('PDF base64 데이터가 없습니다.');
  }
  // Reject oversized input before atob allocates the decoded binary string.
  if (base64.length > MAX_BASE64_LENGTH) throw new Error('PDF는 20MiB 이하여야 합니다.');
  const encoded = base64.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1 || (encoded.includes('=') && encoded.length % 4 !== 0)) {
    throw new Error('올바른 PDF base64 데이터가 아닙니다.');
  }
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const size = Math.floor(encoded.length * 3 / 4) - padding;
  if (size > MAX_PDF_BYTES) throw new Error('PDF는 20MiB 이하여야 합니다.');
  let binary;
  try { binary = globalThis.atob(encoded); }
  catch { throw new Error('PDF base64 데이터를 해석하지 못했습니다.'); }
  if (!binary.length || binary.length > MAX_PDF_BYTES) throw new Error('PDF 크기는 1바이트 이상, 20MiB 이하여야 합니다.');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function destroyLoadingTask(loadingTask) {
  if (!loadingTask) return;
  let timer;
  try {
    // A crashed worker cannot acknowledge transport destruction. Bound teardown
    // so the native worker is still terminated in the caller's finally block.
    await Promise.race([
      loadingTask.destroy(),
      new Promise(resolve => { timer = globalThis.setTimeout(resolve, 2000); }),
    ]);
  } catch {
    // Preserve the original parse/limit error; native termination follows.
  } finally {
    if (timer != null) globalThis.clearTimeout(timer);
  }
}

/** PackingListTool optional prop:
 *   readAwbPdf(base64) -> Promise<{text: string, items: {str, x, y}[]}>
 * Input is raw base64 (not a data URL), matching the original HTML caller.
 * Text is joined in PDF item order with one space, then '\n' per page.
 * Coordinates are original PDF coordinates, not viewport-scaled positions.
 * Exceeding any limit throws; scanned PDFs return empty text for the existing
 * manual-entry UI to handle. The caller owns all UI and prop integration.
 */
export async function readAwbPdf(base64) {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    throw new Error('PDF 읽기는 Web Worker를 지원하는 브라우저에서만 가능합니다.');
  }
  const data = decodePdf(base64);
  // Deferred import keeps browser-only PDF.js globals out of server rendering.
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
  let nativeWorker, pdfWorker, loadingTask, timeout;
  let onWorkerError, onMessageError;
  try {
    // Keep this literal new Worker(new URL(..., import.meta.url)) shape:
    // webpack emits the installed worker as a same-origin application asset.
    // Do not replace with workerSrc, a CDN URL or a fake-worker fallback.
    nativeWorker = new Worker(new URL('./importAwbWorker.js', import.meta.url), { type: 'module' });
    const workerFailure = new Promise((_, reject) => {
      onWorkerError = () => reject(new Error('로컬 PDF worker를 불러오거나 실행하지 못했습니다. 수동으로 입력하세요.'));
      onMessageError = () => reject(new Error('로컬 PDF worker 통신에 실패했습니다. 수동으로 입력하세요.'));
      nativeWorker.addEventListener('error', onWorkerError);
      nativeWorker.addEventListener('messageerror', onMessageError);
      // Also reject a stalled worker/document rather than leaving the UI busy.
      timeout = globalThis.setTimeout(() => reject(new Error('PDF 읽기 시간이 초과되었습니다. 수동으로 입력하세요.')), 60000);
    });
    // Register a rejection handler even if constructing PDFWorker/getDocument
    // throws before the first race is awaited.
    workerFailure.catch(() => {});
    const awaitWorker = promise => Promise.race([promise, workerFailure]);
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
      // No URL/cMapUrl/standardFontDataUrl/wasmUrl: PDF bytes stay local and
      // extraction never resolves document-provided links or remote resources.
    });
    const pdf = await awaitWorker(loadingTask.promise);
    if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1) throw new Error('PDF에 읽을 수 있는 페이지가 없습니다.');
    if (pdf.numPages > MAX_PAGES) throw new Error('PDF는 최대 100페이지까지 읽을 수 있습니다.');

    const pageTexts = [], items = [], pages = [];
    let textLength = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await awaitWorker(pdf.getPage(pageNumber));
      try {
        const content = await awaitWorker(page.getTextContent());
        const strings = [], pageItems = [];
        for (const item of content.items) {
          // TextMarkedContent has no str; Array.join in the original treats
          // such entries as empty strings, so preserve their separator slot.
          const str = typeof item.str === 'string' ? item.str : '';
          textLength += str.length + (strings.length > 0 ? 1 : 0);
          if (textLength + 1 > MAX_TEXT_LENGTH) throw new Error('PDF 추출 텍스트는 최대 50,000자까지 읽을 수 있습니다.');
          strings.push(str);
          if (str.trim().length > 0) {
            const x = item.transform?.[4], y = item.transform?.[5];
            if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('PDF 첫 페이지의 텍스트 좌표를 읽지 못했습니다.');
            const positioned={ str: str.trim(), x, y: Math.round(y), width:Number.isFinite(item.width)?item.width:0 };
            pageItems.push(positioned);
            if(pageNumber===1)items.push(positioned);
          }
        }
        textLength += 1; // Original adds a newline even for an empty page.
        if (textLength > MAX_TEXT_LENGTH) throw new Error('PDF 추출 텍스트는 최대 50,000자까지 읽을 수 있습니다.');
        pageTexts.push(strings.join(' ') + '\n');
        pages.push({text:strings.join(' '),items:pageItems});
      } finally {
        page.cleanup();
      }
    }
    return { text: pageTexts.join(''), items, pages };
  } finally {
    if (timeout != null) globalThis.clearTimeout(timeout);
    if (nativeWorker) {
      if (onWorkerError) nativeWorker.removeEventListener('error', onWorkerError);
      if (onMessageError) nativeWorker.removeEventListener('messageerror', onMessageError);
    }
    try {
      await destroyLoadingTask(loadingTask);
    } finally {
      try { pdfWorker?.destroy(); }
      finally { nativeWorker?.terminate(); }
    }
  }
}

export default readAwbPdf;
