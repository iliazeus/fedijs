export const type = "activitypub";

export async function checkUrl(url, opts = {}) {
  return await _checkObject(await fetchObjectByUrl(url, opts), opts);
}

async function _checkObject(obj, opts = {}) {
  if (typeof obj !== "object" || obj === null) return 0;

  let context = obj["@context"];

  if (typeof context === "string") {
    return context === "https://www.w3.org/ns/activitystreams" ? 0.5 : 0;
  }

  if (Array.isArray(context)) {
    return context.some((x) => x === "https://www.w3.org/ns/activitystreams")
      ? 0.4
      : 0;
  }

  if (context) {
    return 0.1;
  }

  return 0;
}

async function _fetchObject(ref, opts = {}) {
  if (typeof ref === "object" && ref !== null) return ref;
  if (typeof ref === "string") return await fetchObjectByUrl(ref, opts);
  return ref;
}

export async function fetchObjectByUrl(url, opts = {}) {
  const fetch = opts.fetch ?? globalThis.fetch;
  const signal = opts.signal;

  const response = await fetch(url, {
    headers: { accept: "application/activity+json" },
    signal,
  });

  if (!response.ok) {
    throw Object.assign(
      new Error(`failed to fetch ${url}`, {
        json: await response.json().catch(() => undefined),
      })
    );
  }

  const obj = await response.json();
  obj._fedijs = {
    fetchedFromOrigin: url.origin,
    api: "activitypub",
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
