// Only preview/export reads belong here. Never cancel or replay an ERP apply.
export function createImportReadRequests({ timeoutMs = 60000, schedule = setTimeout, cancel = clearTimeout } = {}) {
  const requests = new Map();
  const abort = channel => {
    const request = requests.get(channel);
    if (!request) return;
    requests.delete(channel);
    cancel(request.timer);
    request.controller.abort();
  };
  return {
    abortAll() { for (const channel of [...requests.keys()]) abort(channel); },
    start(channel) {
      abort(channel);
      const controller = new AbortController();
      const request = { controller, timedOut: false };
      requests.set(channel, request);
      request.timer = schedule(() => { request.timedOut = true; controller.abort(); }, timeoutMs);
      return {
        signal: controller.signal,
        isCurrent: () => requests.get(channel) === request,
        get timedOut() { return request.timedOut; },
        finish() {
          cancel(request.timer);
          if (requests.get(channel) === request) requests.delete(channel);
        },
      };
    },
  };
}
