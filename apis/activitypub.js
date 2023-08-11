import { ApiError } from "../util.js";

export const API_KIND = "activitypub";

async function _fetchObject(ref, opts = {}) {
  if (typeof ref === "object" && ref !== null) return ref;
  if (typeof ref === "string") return await fetchObjectByUrl(ref, opts);
  return ref;
}

export async function fetchObjectByUrl(url, opts = {}) {
  if (url.protocol === "fedijs:") {
    throw new Error(
      `"fedijs://" protocol not supported for plain ActivityPub API`
    );
  }

  const fetch = opts.fetch ?? globalThis.fetch;
  const signal = opts.signal;

  const response = await fetch(url, {
    headers: { accept: "application/activity+json" },
    signal,
  });

  if (!response.ok) {
    throw await ApiError.fromResponse(API_KIND, response);
  }

  const obj = await response.json();
  obj._fedijs = {
    fetchedFromOrigin: url.origin,
    api: API_KIND,
  };
  return obj;
}

export async function fetchCollectionByUrl(url, opts = {}) {
  const obj = await fetchObjectByUrl(url, opts);
  return collectionFromObject(obj, opts);
}

export function collectionFromObject(obj, opts = {}) {
  const maxEmptyPages = (opts.maxEmptyPages ??= 2);
  const direction = opts.direction ?? (obj.first ? "forward" : "backward");

  return {
    _fedijs: obj._fedijs,
    id: obj.id,
    size: obj.totalItems,
    [Symbol.asyncIterator]:
      direction === "forward"
        ? async function* () {
            if (obj.items) yield* obj.items;

            let emptyPagesLoaded = 0;

            for (let page = obj.first; page; page = page.next) {
              page = await _fetchObject(page, opts);

              const items = page.orderedItems ?? page.items;
              if (items) yield* items;

              if (!items || items.length === 0) emptyPagesLoaded += 1;
              if (emptyPagesLoaded >= maxEmptyPages) return;
              if (page.id && page.id === page.next) return;
            }
          }
        : async function* () {
            if (obj.items) yield* obj.items.reverse();

            let emptyPagesLoaded = 0;

            for (let page = obj.last; page; page = page.prev) {
              page = await _fetchObject(page, opts);

              const items = page.orderedItems ?? page.items;
              if (items) yield* items.reverse();

              if (!items || items.length === 0) emptyPagesLoaded += 1;
              if (emptyPagesLoaded >= maxEmptyPages) return;
              if (page.id && page.id === page.prev) return;
            }
          },
  };
}
