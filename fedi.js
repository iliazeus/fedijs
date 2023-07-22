let _apis = null;
const _apiByOrigin = new Map();

let _activitypub;
let _backend;

export async function fetch(ref, opts = {}) {
  const responseType = opts.responseType ?? "object";

  if (!_apis) {
    _apis = (
      await Promise.all([
        import("./fedi-activitypub.js").catch((e) => void console.log(e)),
        import("./fedi-backend.js").catch((e) => void console.log(e)),
        import("./fedi-mastodon.js").catch((e) => void console.log(e)),
        import("./fedi-misskey.js").catch((e) => void console.log(e)),
      ])
    ).filter((x) => !!x);

    _activitypub = _apis.find((x) => x.API_KIND === "activitypub");
    _backend = _apis.find((x) => x.API_KIND === "backend");
  }

  const log = opts.log;

  if (ref === undefined || ref === null) return ref;

  if (typeof ref === "string" || ref instanceof URL) {
    const url = new URL(ref);

    const apiByOrigin = _apiByOrigin.get(url.origin);
    if (apiByOrigin) {
      try {
        return await _fetchByUrl(apiByOrigin, url, opts);
      } catch (error) {
        _apiByOrigin.delete(url.origin);
        throw error;
      }
    }

    let bestApi = _activitypub;

    if (opts.backendUrl) {
      bestApi = _backend;
    } else if (url.protocol === "fedijs:") {
      // browser URL parsers don't seem to like non-http(s) URLs
      url.protocol = "https:";

      bestApi = _apis.find((x) => x.API_KIND === url.hostname);

      // APIs need the protocol and searchParams, not the rest
      url.protocol = "fedijs:";
    } else {
      const guesses = await Promise.all(
        _apis.map(async (api) => {
          const confidence = await api.checkUrl(url, opts).catch((err) => {
            log?.(
              `${url} does not support ${api.API_KIND} because of error: ${err}`
            );

            return 0;
          });

          log?.(
            `${url} supports ${api.API_KIND} API with confidence ${confidence}`
          );

          return { api, confidence };
        })
      );

      let bestConfidence = 0;
      for (const { api, confidence } of guesses) {
        if (confidence > bestConfidence) {
          bestConfidence = confidence;
          bestApi = api;
        }
      }
    }

    log?.(`chosen ${bestApi.API_KIND} API for ${url}`);

    if (!bestApi) throw new Error(`unable to find api for ${url}`);
    const result = await _fetchByUrl(bestApi, url, opts);

    _apiByOrigin.set(url.origin, bestApi);
    return result;
  }

  if (typeof ref === "object") {
    if (ref === null) return ref;

    const id = ref.id;
    const fetchedFromOrigin = ref._fedijs?.fetchedFromOrigin;
    const partial = ref._fedijs?.partial;

    if (
      !partial &&
      typeof fetchedFromOrigin === "string" &&
      typeof id === "string" &&
      new URL(id).origin === fetchedFromOrigin &&
      !opts.reload
    ) {
      if (responseType === "object") {
        return ref;
      }

      if (responseType === "collection") {
        if (Symbol.asyncIterator in ref) return ref;
        return _activitypub.collectionFromObject(ref, opts);
      }
    }

    if (typeof id === "string") {
      try {
        return await fetch(ref.id, opts);
      } catch (error) {
        log?.(error);
        return ref;
      }
    }

    if (responseType === "object") return ref;

    if (responseType === "collection") {
      if (Symbol.asyncIterator in ref) return ref;
      return _activitypub.collectionFromObject(ref, opts);
    }
  }

  throw new TypeError(`could not fetch ${JSON.stringify(ref)}`);
}

async function _fetchByUrl(api, url, opts = {}) {
  const log = opts.log;
  const responseType = opts.responseType ?? "object";

  try {
    if (responseType === "object") {
      return await api.fetchObjectByUrl(url, opts);
    }

    if (responseType === "collection") {
      return await api.fetchCollectionByUrl(url, opts);
    }
  } catch (error) {
    if (api === _activitypub || api === _backend) throw error;

    log?.(`failed to use ${api.API_KIND} api for ${url}: ${error}`);
    log?.(`falling back to ${_activitypub.API_KIND} api`);

    try {
      return await _fetchByUrl(_activitypub, url, opts);
    } catch {
      throw error;
    }
  }

  throw new TypeError(`unknown responseType: ${responseType}`);
}
