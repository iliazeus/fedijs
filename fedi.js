let _apis = null;
const _apiByOrigin = new Map();

let _activitypub;

export async function fetch(ref, opts = {}) {
  const responseType = opts.responseType ?? "object";

  if (!_apis) {
    _apis = (
      await Promise.all([
        import("./fedi-activitypub.js").catch((e) => void console.log(e)),
        import("./fedi-mastodon.js").catch((e) => void console.log(e)),
        import("./fedi-misskey.js").catch((e) => void console.log(e)),
      ])
    ).filter((x) => !!x);

    _activitypub = _apis.find((x) => x.type === "activitypub");

    console.log(_apis);
  }

  const log = opts.log;

  if (ref === undefined || ref === null) return ref;

  if (typeof ref === "string") {
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
    let bestConfidence = 0;

    await Promise.all(
      _apis.map((api) =>
        api
          .checkUrl(url, opts)
          .then((confidence) => {
            if (confidence > bestConfidence) {
              bestApi = api;
              bestConfidence = confidence;
            }
          })
          .catch((error) => log?.(error))
      )
    );

    const result = await _fetchByUrl(bestApi, url, opts);

    _apiByOrigin.set(url.origin, bestApi);
    return result;
  }

  if (typeof ref === "object") {
    if (ref === null) return ref;

    const id = ref.id;
    const fetchedFromOrigin = ref._fedijs?.fetchedFromOrigin;

    if (
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
  const responseType = opts.responseType ?? "object";

  if (responseType === "object") {
    return await api.fetchObjectByUrl(url, opts);
  }

  if (responseType === "collection") {
    return await api.fetchCollectionByUrl(url, opts);
  }

  throw new TypeError(`unknown responseType: ${responseType}`);
}
