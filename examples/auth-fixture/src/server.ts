import http from "node:http";
import { handle, type RequestLike } from "./app.ts";

const PORT = Number(process.env.PORT ?? 4321);

const server = http.createServer((nodeReq, nodeRes) => {
  const chunks: Buffer[] = [];
  nodeReq.on("data", (c: Buffer) => chunks.push(c));
  nodeReq.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    let body: unknown;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }

    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(nodeReq.headers)) {
      headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
    }

    const url = new URL(nodeReq.url ?? "/", `http://localhost:${PORT}`);
    const req: RequestLike = {
      method: nodeReq.method ?? "GET",
      path: url.pathname,
      headers,
      body,
    };

    const res = handle(req);
    nodeRes.writeHead(res.status, {
      "content-type": "application/json",
      ...(res.headers ?? {}),
    });
    nodeRes.end(JSON.stringify(res.body ?? {}));
  });
});

server.listen(PORT, () => {
  console.log(`auth-fixture listening on http://127.0.0.1:${PORT}`);
});
