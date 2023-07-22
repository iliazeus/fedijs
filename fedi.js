import * as apis from "./apis/index.js";
import { detectAndPrioritizeApis } from "./detect-api.js";

const _prioritizedApisByOrigin = new Map();

export async function fetch(ref, opts = {}) {
  const responseType = opts.responseType ?? "object";
  const log = opts.log;

  if (ref === undefined || ref === null) return ref;

  if (typeof ref === "string") {
    ref = new URL(ref);
  }

  if (ref instanceof URL) {
    if (opts.backendUrl) {
      log?.(`fetching from backend: ${ref}`);
      try {
        const result = await _fetchByUrl(apis.backend, ref, opts);
        log?.(`fetched from backend: ${ref}`);
        return result;
      } catch (error) {
        log?.(`error fetching ${ref} from backend: ${error}`);
        throw error;
      }
    }

    if (ref.protocol === "fedijs:") {
      // browser URL parsers don't seem to like non-http(s) URLs
      const httpsRef = new URL(ref);
      httpsRef.protocol = "https:";

      const api = apis[httpsRef.hostname];

      if (!api) {
        log?.(`${httpsRef.hostname} API not available`);
        throw new Error(`${httpsRef.hostname} API not available`);
      }

      log?.(`fetching ${ref} with ${api.API_KIND} API`);
      try {
        const result = await _fetchByUrl(api, ref, opts);
        log?.(`fetched ${ref} wit ${api.API_KIND} API`);
        return result;
      } catch (error) {
        log?.(`error fetching ${ref} with ${api.API_KIND} API: ${error}`);
        throw error;
      }
    }

    let prioritizedApis = _prioritizedApisByOrigin.get(ref.origin);

    if (!prioritizedApis) {
      prioritizedApis = await detectAndPrioritizeApis(ref, opts);
      _prioritizedApisByOrigin.set(ref.origin, prioritizedApis);
    }

    log?.(
      `API priority for ${ref} is ${prioritizedApis
        .map((x) => x.API_KIND)
        .join(", ")}`
    );

    const errors = [];

    for (const api of prioritizedApis) {
      log?.(`attempting ${api.API_KIND} API for ${ref}`);
      try {
        const result = await _fetchByUrl(api, ref, opts);
        log?.(`successfully used ${api.API_KIND} API for ${ref}`);
        return result;
      } catch (error) {
        log?.(`error attempting ${api.API_KIND} API for ${ref}: ${error}`);
        errors.push(error);
      }
    }

    throw new AggregateError(errors, `no API was successful for ${ref}`);
  }

  if (typeof ref === "object") {
    if (ref === null) return ref;

    const id = ref.id;
    const fetchedFromOrigin = ref._fedijs?.fetchedFromOrigin;
    const partial = ref._fedijs?.partial;

    if (typeof id === "string") {
      if (!partial && fetchedFromOrigin === new URL(id).origin) {
        log?.(`object is whole and trusted - returning`);
        return ref;
      } else if (fetchedFromOrigin !== new URL(id).origin) {
        log?.(`object is not trusted - refetching`);
        return await fetch(id, opts);
      } else {
        log?.(`object is partial - refetching`);
        return await fetch(id, opts);
      }
    } else {
      log?.(`object is transient - returning`);

      if (responseType === "collection") {
        if (Symbol.asyncIterator in ref) return ref;

        log?.(`but first, converting to AsyncIterable collection`);
        return apis.activitypub.collectionFromObject(ref, opts);
      }

      return ref;
    }
  }

  log?.(`invalid type of reference: ${ref}`);
  throw new TypeError(`invalid type of reference: ${ref}`);
}

async function _fetchByUrl(api, url, opts = {}) {
  const responseType = opts.responseType ?? "object";

  switch (responseType) {
    case "object":
      return await api.fetchObjectByUrl(url, opts);
    case "collection":
      return await api.fetchCollectionByUrl(url, opts);
  }
}
