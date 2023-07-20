const _proxiedOrigins = new Set();

export const niceFetch = async (url, opts = {}) => {
  const origin = new URL(url, window.location.href).origin;

  const useCorsProxy = opts.useCorsProxy || _proxiedOrigins.has(origin);

  if (opts.corsProxyPrefix && useCorsProxy) {
    url = opts.corsProxyPrefix + encodeURIComponent(url);
  }

  let response;

  for (
    let retryCount = 0;
    retryCount <= opts.maxRetryCount ?? 0;
    retryCount += 1
  ) {
    const controller = new AbortController();
    const follow = () => controller.abort(opts.signal.reason);
    if (opts.timeout) setTimeout(() => controller.abort(), opts.timeout);
    opts.signal?.addEventListener("abort", follow, { once: true });

    try {
      response = await globalThis.fetch(url, {
        ...opts,
        signal: controller.signal,
      });
    } catch (error) {
      if (!useCorsProxy) {
        _proxiedOrigins.add(origin);
        return await niceFetch(url, { ...opts, useCorsProxy: true });
      }

      throw error;
    } finally {
      opts.signal?.removeEventListener("abort", follow);
    }

    if (response.ok) return response;

    if (response.status === 429 || response.status === 503) {
      const retryAfter =
        response.headers.get("retry-after") ??
        response.headers.get("ratelimit-reset") ??
        response.headers.get("x-ratelimit-reset") ??
        5;

      const retryAfterMs = Number(retryAfter) * 1000;
      if (Number.isNaN(retryAfterMs)) {
        retryAfterMs = new Date(retryAfter).valueOf() - Date.now();
      }

      await new Promise((cb) => setTimeout(cb, retryAfterMs));
      continue;
    }

    return response;
  }

  return response;
};

export default niceFetch;
