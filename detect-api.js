import * as apis from "./apis/index.js";

export async function detectAndPrioritizeApis(url, opts = {}) {
  const fetch = opts.fetch ?? globalThis.fetch;
  const log = opts.log;

  const [
    activitypubObject,
    mastodonInstanceV1,
    mastodonInstanceV2,
    misskeyMeta,
  ] = await Promise.all(
    [
      fetch(url, { headers: { accept: "application/activity+json" } }),
      fetch(`${url.origin}/api/v1/instance`),
      fetch(`${url.origin}/api/v2/instance`),
      fetch(`${url.origin}/api/meta`, {
        method: "post",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ detail: false }),
      }),
    ].map((p) => p.then(jsonObjectOrNull).catch(() => null))
  );

  const confidence = {
    backend: -1.0,
    activitypub: 1.0,
    mastodon: 1.0,
    misskey: 1.0,
  };

  if (activitypubObject) {
    const context = activitypubObject["@context"];

    if (context === _activitypubContext) {
      confidence.activitypub *= 1.0;
    } else if (
      Array.isArray(context) &&
      context.includes(_activitypubContext)
    ) {
      confidence.activitypub *= 1.0;
    } else {
      confidence.activitypub *= 0.0;
    }
  } else {
    confidence.activitypub *= 0.0;
  }

  if (mastodonInstanceV2) {
    confidence.mastodon *= 1.0;
    confidence.activitypub *= 0.7;
  } else if (mastodonInstanceV1) {
    confidence.mastodon *= 0.9;
    confidence.activitypub *= 0.7;
  } else {
    confidence.mastodon *= 0.0;
  }

  if (misskeyMeta) {
    if (_compatibleMisskeySourceRepos.has(misskeyMeta.repositoryUrl)) {
      confidence.misskey *= 1.0;
      confidence.activitypub *= 0.7;
    } else {
      confidence.misskey *= 0.8;
      confidence.activitypub *= 0.7;
    }
  } else {
    confidence.misskey *= 0.0;
  }

  log?.(url, confidence);

  return Object.entries(confidence)
    .filter((x) => x[1] >= 0)
    .sort((a, b) => b[1] - a[1])
    .map((x) => apis[x[0]]);
}

const _activitypubContext = "https://www.w3.org/ns/activitystreams";

const _compatibleMisskeySourceRepos = new Set([
  "https://github.com/misskey-dev/misskey",
  "https://gitlab.com/satoaki-ooto/foundkey",
  "https://codeberg.org/firefish/firefish",
  "https://gitlab.prometheus.systems/firefish/firefish",
]);

const jsonObjectOrNull = async (response) => {
  if (!response.ok) return null;
  const json = await response.json().catch(() => null);
  if (typeof json !== "object" || json === null) return null;
  return json;
};
