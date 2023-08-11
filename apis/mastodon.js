import * as activitypub from "./activitypub.js";
import { apply, ApiError } from "../util.js";

export const API_KIND = "mastodon";

export const fetchObjectByUrl = apply(
  withFedijsSchemeHandler,
  withMissingRepliesHandler,
  withMastodonAccountFallback,
  withMastodonStatusFallback,
  withMastodonRepliesFallback,
  fetchObjectWithActivitypub
);

function withFedijsSchemeHandler(next) {
  return async function handleFedijsScheme(url, opts = {}) {
    if (url.protocol !== "fedijs:") {
      return await next(url, opts);
    }

    const query = url.searchParams.get("q");

    if (query === "replies") {
      const origin = url.searchParams.get("o");
      const statusId = url.searchParams.get("id");

      const context = await _apiFetch(
        `${origin}/api/v1/statuses/${statusId}/context`,
        opts
      );

      return _convertStatusRepliesCollection(
        context.descendants.filter((x) => x.in_reply_to_id === statusId),
        new URL(origin),
        opts
      );
    }

    throw new Error(`unsupported query: ${url}`);
  };
}

function withMissingRepliesHandler(next) {
  return async function handleMissingReplies(url, opts = {}) {
    const obj = await next(url, opts);

    if (obj.type !== "Note" || obj.replies) {
      return obj;
    }

    url = await _apiFetchLocation(url, opts);
    obj.url = String(url);

    const match = url.pathname.match(/\/([^/]+)$/);

    if (match) {
      const context = await _apiFetch(
        `${url.origin}/api/v1/statuses/${match[1]}/context`,
        opts
      );

      obj.replies = _convertStatusRepliesCollection(
        context.descendants.filter((x) => x.in_reply_to_id === match[1]),
        url,
        opts
      );
    }

    return obj;
  };
}

function withMastodonAccountFallback(next) {
  return async function fallbackToMastodonAccount(url, opts = {}) {
    try {
      return await next(url, opts);
    } catch (error) {
      const match = url.pathname.match(/^\/(?:users\/|@)([^/]+)$/);

      if (!match) {
        // TODO: compose errors properly
        throw error;
      }

      const account = await _apiFetch(
        `${url.origin}/api/v1/accounts/lookup?acct=${match[1]}`,
        opts
      );

      return _convertAccount(account, url, opts);
    }
  };
}

function withMastodonStatusFallback(next) {
  return async function fallbackToMastodonStatus(url, opts = {}) {
    try {
      return await next(url, opts);
    } catch (error) {
      const match = url.pathname.match(
        /^\/(?:users\/|@)([^/]+)\/(?:statuses\/)?([^/]+)$/
      );

      if (!match) {
        // TODO: compose errors properly
        throw error;
      }

      const status = await _apiFetch(
        `${url.origin}/api/v1/statuses/${match[2]}`,
        opts
      );

      const context = await _apiFetch(
        `${url.origin}/api/v1/statuses/${match[2]}/context`,
        opts
      );

      return _convertStatus(status, url, { ...opts, context });
    }
  };
}

function withMastodonRepliesFallback(next) {
  return async function fallbackToMastodonReplies(url, opts = {}) {
    try {
      return await next(url, opts);
    } catch (error) {
      const match = (match = url.pathname.match(
        /^\/(?:users\/|@)([^/]+)\/(?:statuses\/)?([^/]+)\/replies$/
      ));

      if (!match) {
        // TODO: compose errors properly
        throw error;
      }

      const status = await _apiFetch(
        `${url.origin}/api/v1/statuses/${match[2]}`,
        opts
      );

      const context = await _apiFetch(
        `${url.origin}/api/v1/statuses/${match[2]}/context`,
        opts
      );

      const apStatus = _convertStatus(status, url, { ...opts, context });
      return apStatus.replies;
    }
  };
}

async function fetchObjectWithActivitypub(url, opts = {}) {
  const obj = await activitypub.fetchObjectByUrl(url, opts);
  obj._fedijs.api = API_KIND;
  return obj;
}

export async function fetchCollectionByUrl(url, opts = {}) {
  const obj = await fetchObjectByUrl(url, opts);
  return activitypub.collectionFromObject(obj, opts);
}

function _convertAccount(account, url, opts = {}) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    _fedijs: {
      fetchedFromOrigin: url.origin,
      api: API_KIND,
    },

    type: "Person",
    id: `${url.origin}/users/${account.username}`,
    url: account.url,
    preferredUsername: account.username,
    published: account.created_at,
    icon:
      (account.avatar_static && { url: account.avatar_static }) ||
      (account.avatar && { url: account.avatar }),
  };
}

function _convertStatus(status, url, opts = {}) {
  const context = opts.context;

  // apparently, akkoma does that sometimes? something to do with unauthed user?
  // event though it doesn't mind giving the account via activitypub
  const hasAccount = status.account && Object.keys(status.account).length > 0;

  const partial = !hasAccount || !context;

  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    _fedijs: {
      fetchedFromOrigin: url.origin,
      api: API_KIND,
      partial,
    },

    type: "Note",
    id: status.uri,
    url: status.url,
    attributedTo: hasAccount
      ? _convertAccount(status.account, url, opts)
      : null,
    published: status.created_at,
    content: status.content,
    attachment: status.mediaAttachments?.map((x) =>
      _convertMediaAttachment(x, url, opts)
    ),

    inReplyTo: context?.ancestors.find((x) => status.in_reply_to_id === x.id)
      ?.uri,

    replies: context?.descendants
      ? _convertStatusRepliesCollection(
          context.descendants.filter((x) => x.in_reply_to_id === status.id),
          url,
          opts
        )
      : `fedijs://mastodon?o=${url.origin}&q=replies&id=${status.id}`,
  };
}

function _convertStatusRepliesCollection(statuses, url, opts = {}) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    _fedijs: {
      fetchedFromOrigin: url.origin,
      api: API_KIND,
    },

    type: "Collection",
    totalItems: statuses.length,

    first: {
      "@context": "https://www.w3.org/ns/activitystreams",
      _fedijs: {
        fetchedFromOrigin: url.origin,
        api: API_KIND,
      },

      type: "CollectionPage",
      items: statuses.map((x) =>
        _convertStatus(x, url, { ...opts, context: undefined })
      ),
    },
  };
}

function _convertMediaAttachment(att, url, opts = {}) {
  let type = "Document";
  if (att.type === "image") type = "Image";
  if (att.type === "audio") type = "Audio";
  if (att.type === "video" || att.type === "gifv") type = "Video";

  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    _fedijs: {
      fetchedFromOrigin: url.origin,
      api: API_KIND,
    },

    type,
    id: att.url,
    url: att.url,
    summary: att.description,
  };
}

async function _apiFetchLocation(url, opts = {}) {
  const fetch = opts.fetch ?? globalThis.fetch;

  const response = await fetch(url, { method: "head" });

  if (!response.ok) {
    throw await ApiError.fromResponse(API_KIND, response);
  }

  return new URL(response.url, url);
}

async function _apiFetch(url, opts = {}) {
  const fetch = opts.fetch ?? globalThis.fetch;

  const response = await fetch(url);

  if (!response.ok) {
    throw await ApiError.fromResponse(API_KIND, response);
  }

  return await response.json();
}

async function* _apiFetchPaged(url, opts = {}) {
  const fetch = opts.fetch ?? globalThis.fetch;

  do {
    const response = await fetch(url);

    if (!response.ok) {
      throw await ApiError.fromResponse(API_KIND, response);
    }

    yield await response.json();

    const links = (response.headers.get("link") ?? "")
      .split(",")
      .map((x) => x.split(";").map((y) => y.trim()));

    url = links.find(([href, rel]) => rel === 'rel="next"')?.[0];
  } while (url);
}
