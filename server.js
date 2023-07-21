import * as http from "node:http";
import * as fedi from "./fedi.js";

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

    console.log(`< get ${paramUrl}`);

    const response = await fedi.fetch(paramUrl, {
      ...Object.fromEntries(paramUrl.searchParams.entries()),
      responseType: "object",

      fetch: (url, opts) => {
        console.log(`> ${opts?.method ?? "get"} ${url}`);

        return globalThis.fetch(url, {
          ...opts,
          signal: AbortSignal.timeout(10_000),
        });
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

server.listen(process.env.PORT ?? 8081);
