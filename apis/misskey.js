import { ApiError } from "../util.js";

import * as activitypub from "./activitypub.js";

export const API_KIND = "misskey";

export async function fetchObjectByUrl(url, opts = {}) {
  if (url.protocol === "fedijs:") {
    const query = url.searchParams.get("q");

    if (query === "replies") {
      const origin = url.searchParams.get("o");
      const noteId = url.searchParams.get("id");

      const children = await _apiFetch(
        `${origin}/api/notes/children`,
        { noteId, depth: 1, limit: 50 },
        opts
      );

      return _convertNoteRepliesCollection(
        children.filter((x) => x.replyId === noteId),
        new URL(origin),
        opts
      );
    }

    throw new Error(`unsupported query: ${url}`);
  }

  try {
    const obj = await activitypub.fetchObjectByUrl(url, opts);
    obj._fedijs.api = API_KIND;

    if (obj.type === "Note") {
      const children = await _apiFetch(
        `${url.origin}/api/notes/children`,
        { noteId: match[1], depth: 1, limit: 50 },
        opts
      );

      obj.replies = _convertNoteRepliesCollection(
        children.filter((x) => x.reply.uri === obj.id),
        url,
        opts
      );
    }

    return obj;
  } catch (error) {
    let match;

    match = url.pathname.match(/^\/notes\/([^/]+)$/);
    if (match) {
      const note = await _apiFetch(
        `${url.origin}/api/notes/show`,
        { noteId: match[1] },
        opts
      );

      const children = await _apiFetch(
        `${url.origin}/api/notes/children`,
        { noteId: match[1], depth: 1, limit: 50 },
        opts
      );

      return _convertNote(note, url, { ...opts, children });
    }

    throw error;
  }
}

export async function fetchCollectionByUrl(url, opts = {}) {
  const obj = await fetchObjectByUrl(url, opts);
  return activitypub.collectionFromObject(obj, opts);
}

function _convertUser(user, url, opts = {}) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    _fedijs: {
      fetchedFromOrigin: url.origin,
      api: API_KIND,
    },

    type: "Person",
    id: `${url.origin}/users/${user.id}`,
    url: `${url.origin}/@${user.username}`,
    preferredUsername: user.username,
    published: user.createdAt,
    icon: user.avatarUrl && { url: user.avatarUrl },
  };
}

function _convertNote(note, url, opts = {}) {
  const children = opts.children;

  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    _fedijs: {
      fetchedFromOrigin: url.origin,
      api: API_KIND,
    },

    type: "Note",
    id: note.uri ?? `${url.origin}/notes/${note.id}`,
    url: note.url ?? `${url.origin}/notes/${note.id}`,
    attributedTo: _convertUser(note.user, url, { opts }),
    published: note.createdAt,
    content: note.text,

    attachment: note.files?.map((x) => _convertNoteFile(x, url, opts)),

    inReplyTo: note.reply?.uri,

    replies: children
      ? _convertNoteRepliesCollection(
          children.filter((x) => x.replyId === note.id),
          url,
          opts
        )
      : `fedijs://misskey?o=${url.origin}&q=replies&id=${note.id}`,
  };
}

function _convertNoteFile(file, url, opts = {}) {
  let type = "Document";
  if (file.type.startsWith("image/")) type = "Image";
  if (file.type.startsWith("audio/")) type = "Audio";
  if (file.type.startsWith("video/")) type = "Video";

  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    _fedijs: {
      fetchedFromOrigin: url.origin,
      api: API_KIND,
    },

    type,
    id: file.url,
    url: file.url,
    summary: file.comment,
  };
}

function _convertNoteRepliesCollection(notes, url, opts = {}) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    _fedijs: {
      fetchedFromOrigin: url.origin,
      api: API_KIND,
    },

    type: "Collection",
    totalItems: notes.length,

    first: {
      "@context": "https://www.w3.org/ns/activitystreams",
      _fedijs: {
        fetchedFromOrigin: url.origin,
        api: API_KIND,
      },

      type: "CollectionPage",
      items: notes.map((x) =>
        _convertNote(x, url, { ...opts, children: undefined })
      ),
    },
  };
}

async function _apiFetch(url, params, opts = {}) {
  const fetch = opts.fetch ?? globalThis.fetch;

  const response = await fetch(url, {
    method: "post",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw await ApiError.fromResponse(API_KIND, response);
  }

  return await response.json();
}
