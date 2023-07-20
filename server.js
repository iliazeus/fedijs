import * as http from "node:http";
import * as fedi from "./fedi.js";

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

    const response = await fedi.fetch(paramUrl, {
      ...Object.fromEntries(paramUrl.searchParams.entries()),
      responseType: "object",
      fetch: globalThis.fetch,
    });

    const body = Buffer.from(JSON.stringify(response), "utf-8");

    res
      .writeHead(200, {
        "access-control-allow-origin": "*",
        "content-type":
          'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
        "content-length": body.byteLength,
      })
      .end(body);
  } catch (error) {
    const body = Buffer.from(
      JSON.stringify({ error: error.json ?? error.message }),
      "utf-8"
    );

    res
      .writeHead(error.statusCode ?? 500, {
        "access-control-allow-origin": "*",
        "content-type": "application/json",
        "content-length": body.byteLength,
      })
      .end(body);
  }
});

server.listen(process.env.PORT ?? 8081);
