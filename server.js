import * as http from "node:http";
import * as fedi from "./fedi.js";

const undici = await import("undici").catch(() => null);
const nodeFetch = await import("node-fetch").catch(() => null);

let baseFetch;

if (undici) {
  const dispatcher = new undici.Agent({
    maxRedirections: 5,
    maxResponseSize: 2 * 1024 * 1024,
    strictContentLength: false,
  });

  baseFetch = async function wrappedUndiciFetch(url, init = {}) {
    return await undici.fetch(url, { ...init, dispatcher });
  };
} else if (nodeFetch) {
  baseFetch = async function wrappedNodeFetch(url, init = {}) {
    return await nodeFetch.default(url, {
      ...init,
      follow: 5,
      size: 2 * 1024 * 1024,
    });
  };
} else {
  console.warn(`no fetch packages found; some limits will not be enforced`);
  console.warn(`please install either undici or node-fetch to resolve`);

  if (!globalThis.fetch) throw new Error(`global fetch is not available`);

  baseFetch = globalThis.fetch;
}

const commonHeaders = {
  "access-control-allow-origin": "*",
  "cache-control": "max-age=60, immutable",
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== "GET") {
      throw Object.assign(new Error("method not allowed"), { statusCode: 405 });
    }

    let paramUrl;
    try {
      paramUrl = new URL(decodeURIComponent(req.url?.slice(1)));
    } catch {
      throw Object.assign(new Error("invalid parameter url"), {
        statusCode: 400,
      });
    }

    console.log(`${new Date().toISOString()} < get ${paramUrl}`);

    const response = await fedi.fetch(paramUrl, {
      ...Object.fromEntries(paramUrl.searchParams.entries()),
      responseType: "object",

      log: (s) => console.log(`${new Date().toISOString()} ${s}`),

      fetch: async function wrappedFetch(url, init) {
        console.log(
          `${new Date().toISOString()} > ${init?.method ?? "get"} ${url}`
        );

        let response;

        try {
          response = await baseFetch(url, {
            ...init,
            signal: AbortSignal.timeout(30_000),
          });
        } catch (error) {
          console.log(
            `${new Date().toISOString()} > ${
              init?.method ?? "get"
            } ${url} ${error}`
          );
          throw error;
        }

        console.log(
          `${new Date().toISOString()} > ${init?.method ?? "get"} ${url} ${
            response.status
          }`
        );

        return response;
      },
    });

    const body = Buffer.from(JSON.stringify(response), "utf-8");

    const headers = {
      "content-type":
        'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
      "content-length": body.byteLength,
    };

    if (response.type === "Person") {
      headers["cache-control"] = "max-age=3600, immutable";
    } else if (response.type === "Note") {
      headers["cache-control"] = "max-age=600, immutable";
    }

    res
      .writeHead(200, {
        ...commonHeaders,
        ...headers,
      })
      .end(body);
  } catch (error) {
    console.error(error);

    const body = Buffer.from(
      JSON.stringify({ error: error.json ?? error.message }),
      "utf-8"
    );

    res
      .writeHead(error.statusCode ?? 500, {
        ...commonHeaders,
        "content-type": "application/json",
        "content-length": body.byteLength,
      })
      .end(body);
  }
});

server.listen(process.env.PORT ?? 8081, () => {
  let address = server.address();

  if (typeof address === "object") {
    if (address.family === "IPv6") {
      address = `[${address.address}]:${address.port}`;
    } else {
      address = `${address.address}:${address.port}`;
    }
  }

  console.log(`server listening at ${address}`);
});
