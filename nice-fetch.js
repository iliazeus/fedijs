import { pipe, pLimit, sleep } from "./util.js";

export const makeNiceFetch = (opts = {}) => {
  const {
    fetch: baseFetch = globalThis.fetch,
    maxRetryCount,
    retryTimeout,
    timeout,
    corsProxyPrefix,
    concurrency,
  } = opts;

  if (!baseFetch) throw new TypeError(`no base fetch specified`);

  return pipe(
    baseFetch,
    withConcurrency({ concurrency }),
    withTimeout({ timeout }),
    withCorsProxy({ corsProxyPrefix }),
    withRetry({ maxRetryCount, retryTimeout })
  );
};

export default makeNiceFetch;

export const withRetry =
  ({ maxRetryCount, retryTimeout }) =>
  (fetch) => {
    if (!maxRetryCount) return fetch;

    return async function fetchWithRetry(url, init = {}) {
      let lastResponse = null;
      let lastError = null;

      for (let retryCount = 0; retryCount <= maxRetryCount; retryCount += 1) {
        try {
          const response = await fetch(url, init);
          if (response.ok) return response;

          lastError = null;
          lastResponse = response;

          if (response.status === 429 || response.status === 503) {
            const retryAfter =
              response.headers.get("retry-after") ??
              response.headers.get("ratelimit-reset") ??
              response.headers.get("x-ratelimit-reset") ??
              retryTimeout / 1000 ??
              0;

            const retryAfterMs = Number(retryAfter) * 1000;
            if (Number.isNaN(retryAfterMs)) {
              retryAfterMs = new Date(retryAfter).valueOf() - Date.now();
            }

            if (retryAfterMs > 0) await sleep(retryAfterMs, init.signal);
            continue;
          }

          if (response.status >= 500) {
            if (retryTimeout) await sleep(retryTimeout, init.signal);
            continue;
          }

          return response;
        } catch (error) {
          if (error === init.signal?.reason) throw error;

          lastResponse = null;
          lastError = error;

          if (retryTimeout) await sleep(retryTimeout, init.signal);
        }
      }

      if (lastError) throw lastError;
      return lastResponse;
    };
  };

export const withCorsProxy =
  ({ corsProxyPrefix }) =>
  (fetch) => {
    if (!corsProxyPrefix) return fetch;

    const proxiedOrigins = new Set();

    return async function fetchWithCorsProxy(url, init = {}) {
      const parsedUrl = new URL(url, "local://");
      if (parsedUrl.protocol === "local:") {
        return await fetch(url, init);
      }

      if (!proxiedOrigins.has(parsedUrl.origin)) {
        try {
          const response = await fetch(url, init);
          return response;
        } catch (error) {
          if (error === init.signal?.reason) throw error;
          proxiedOrigins.add(parsedUrl.origin);
        }
      }

      const proxiedUrl = corsProxyPrefix + encodeURIComponent(url);
      return await fetch(proxiedUrl, init);
    };
  };

export const withTimeout =
  ({ timeout }) =>
  (fetch) => {
    if (!timeout) return fetch;

    return async function fetchWithTimeout(url, init = {}) {
      if (!init.signal && AbortSignal.timeout) {
        return await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(timeout),
        });
      }

      const controller = new AbortController();
      const follow = () => controller.abort(init.signal.reason);

      const timer = setTimeout(() => controller.abort(), timeout);
      init.signal?.addEventListener("abort", follow, { once: true });

      try {
        return await fetch(url, init);
      } finally {
        clearTimeout(timer);
        init.signal?.removeEventListener("abort", follow);
      }
    };
  };

export const withConcurrency =
  ({ concurrency }) =>
  (fetch) => {
    if (!concurrency || concurrency === Infinity) return fetch;

    const limit = pLimit(concurrency);

    return async function fetchWithConcurrency(url, init = {}) {
      return await limit(fetch, url, init);
    };
  };
