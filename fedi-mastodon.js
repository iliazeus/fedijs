import * as activitypub from "./fedi-activitypub.js";

export const type = "mastodon";

export async function checkUrl(url, opts = {}) {
  try {
    const instanceV2 = await _apiFetch(`${url.origin}/api/v2/instance`, opts);

    return instanceV2.source_url === "https://github.com/mastodon/mastodon"
      ? 1
      : 0.8;
  } catch {
    const instanceV1 = await _apiFetch(`${url.origin}/api/v1/instance`, opts);

    if (instanceV1.pleroma?.metadata.features.includes("mastodon_api"))
      return 0.9;

    return 0.8;
  }
}

export async function fetchObjectByUrl(url, opts = {}) {
  try {
    const obj = await activitypub.fetchObjectByUrl(url, opts);
    obj._fedijs.api = "mastodon";
    return obj;
  } catch (error) {
    let match;

    match = url.pathname.match(/^\/(?:users\/|@)([^/]+)$/);
    if (match) {
      const account = await _apiFetch(
        `${url.origin}/api/v1/accounts/lookup?acct=${match[1]}`
      );
      return _convertAccount(account, url, opts);
    }

    match = url.pathname.match(
      /^\/(?:users\/|@)([^/]+)\/(?:statuses\/)?([^/]+)$/
    );
    if (match) {
      const status = await _apiFetch(
        `${url.origin}/api/v1/statuses/${match[2]}`
      );
      const context = await _apiFetch(
        `${url.origin}/api/v1/statuses/${match[2]}/context`
      );
      return _convertStatus(status, url, { ...opts, context });
    }

    match = url.pathname.match(
      /^\/(?:users\/|@)([^/]+)\/(?:statuses\/)?([^/]+)\/replies$/
    );
    if (match) {
      const status = await _apiFetch(
        `${url.origin}/api/v1/statuses/${match[2]}`
      );
      const context = await _apiFetch(
        `${url.origin}/api/v1/statuses/${match[2]}/context`
      );

      const apStatus = _convertStatus(status, url, { ...opts, context });
      return apStatus.replies;
    }

    throw error;
  }
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
      api: "mastodon",
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

  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    _fedijs: {
      fetchedFromOrigin: url.origin,
      api: "mastodon",
    },

    type: "Note",
    id: status.uri,
    url: status.url,
    attributedTo: _convertAccount(status.account, url, opts),
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
          { ...opts, status }
        )
      : `${status.uri}/replies`,
  };
}

function _convertStatusRepliesCollection(statuses, url, opts = {}) {
  const status = opts.status;
  if (!status) throw new TypeError("status");

  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    _fedijs: {
      fetchedFromOrigin: url.origin,
      api: "mastodon",
    },

    type: "Collection",
    id: `${status.uri}/replies`,
    totalItems: status.replies_count,

    first: {
      "@context": "https://www.w3.org/ns/activitystreams",
      _fedijs: {
        fetchedFromOrigin: url.origin,
        api: "mastodon",
      },

      type: "CollectionPage",
      id: `${status.uri}/replies?page=true`,
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
      api: "mastodon",
    },

    type,
    id: att.url,
    url: att.url,
    summary: att.description,
  };
}

async function _apiFetch(url, opts = {}) {
  const fetch = opts.fetch ?? globalThis.fetch;

  const response = await fetch(url);
  const json = await response.json();

  if (!response.ok) {
    throw Object.assign(new Error(json.error), { code: response.status });
  }

  return json;
}

async function* _apiFetchPaged(url, opts = {}) {
  const fetch = opts.fetch ?? globalThis.fetch;

  do {
    const response = await fetch(url);
    const json = await response.json();

    if (!response.ok) {
      throw Object.assign(new Error(json.error), { code: response.status });
    }

    yield json;

    const links = (response.headers.get("link") ?? "")
      .split(",")
      .map((x) => x.split(";").map((y) => y.trim()));

    url = links.find(([href, rel]) => rel === 'rel="next"')?.[0];
  } while (url);
}
