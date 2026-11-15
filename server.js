// Runs the same /api handlers as Vercel, plus the static page, on plain Node.
// Used by Docker, the e2e tests and local development. Vercel does not use this file.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 6 * 1024 * 1024;
// Only these files are public. Everything else (source, config, tests, .git) is a 404.
const PUBLIC = /^(index\.html|app\.js|style\.css|(lib|vendor)\/[A-Za-z0-9_-]+\.js)$/;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const API = /^\/api\/([a-z][a-z-]*)$/;
// Same site-wide security headers Vercel sends, read from vercel.json so there is one source.
const SITE_HEADERS = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8"))
  .headers.filter((h) => h.source === "/(.*)").flatMap((h) => h.headers);

function send(res, status, body, type = "application/json; charset=utf-8") {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": type });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error("Payload too large"), { status: 413 })); req.resume(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function serveApi(name, req, res, url) {
  let mod;
  try { mod = await import(pathToFileURL(path.join(ROOT, "api", name + ".js")).href); }
  catch { return send(res, 404, { error: "Not found" }); }
  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    let raw;
    try { raw = await readBody(req); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
    if (raw) {
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: "Invalid JSON" }); }
    }
  }
  const vreq = { method: req.method, headers: req.headers, query: Object.fromEntries(url.searchParams), body };
  const vres = {
    statusCode: 200,
    setHeader: (k, v) => res.setHeader(k, v),
    status(n) { this.statusCode = n; return this; },
    json(o) { send(res, this.statusCode, o); return this; },
  };
  await mod.default(vreq, vres);
}

async function serveStatic(pathname, res) {
  let rel;
  try { rel = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html"; } catch { return send(res, 400, "Bad path", "text/plain"); }
  if (rel.includes("..") || !PUBLIC.test(rel)) return send(res, 404, "Not found", "text/plain");
  try {
    const data = await readFile(path.join(ROOT, rel));
    res.writeHead(200, { "content-type": TYPES[path.extname(rel)] || "application/octet-stream" });
    res.end(data);
  } catch { send(res, 404, "Not found", "text/plain"); }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    for (const h of SITE_HEADERS) res.setHeader(h.key, h.value);
    try {
      const url = new URL(req.url, "http://localhost");
      const m = API.exec(url.pathname);
      if (m) await serveApi(m[1], req, res, url);
      else if (url.pathname.startsWith("/api/")) send(res, 404, { error: "Not found" });
      else await serveStatic(url.pathname, res);
    } catch (e) {
      console.error(e);
      send(res, 500, { error: "Server error" });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.env.SEED_ON_START === "1") {
    const { db, ensure } = await import("./api/_lib.js");
    const { seedDemo } = await import("./lib/seed.js");
    await ensure();
    console.log(`seeded ${await seedDemo(db())} demo parties`);
  }
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => console.log(`tee-khao on http://localhost:${port}`));
}
