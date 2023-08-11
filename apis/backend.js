import { ApiError } from "../util.js";

export const API_KIND = "backend";

export async function checkUrl(url, opts = {}) {
  return -1;
}

async function _fetchObject(ref, opts = {}) {
  if (typeof ref === "object" && ref !== null) return ref;
  if (typeof ref === "string") return await fetchObjectByUrl(ref, opts);
  return ref;
}

export async function fetchObjectByUrl(url, opts = {}) {
  const fetch = opts.fetch ?? globalThis.fetch;
  const signal = opts.signal;
  const backendUrl = opts.backendUrl;

  if (!backendUrl) throw new TypeError("backendUrl");

  const response = await fetch(backendUrl + "/" + encodeURIComponent(url), {
    headers: { accept: "application/activity+json" },
    signal,
  });

  if (!response.ok) {
    throw await ApiError.fromResponse(API_KIND, response);
  }

  const obj = await response.json();
  return obj;
}

export async function fetchCollectionByUrl(url, opts = {}) {
  const obj = await fetchObjectByUrl(url, opts);
  return collectionFromObject(obj, opts);
}

function collectionFromObject(obj, opts = {}) {
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
