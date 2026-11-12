// Minimal stand-in for Vercel's req/res so handlers can be called directly.
export async function call(handler, { method = "GET", query = {}, body, headers = {} } = {}) {
  const res = {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(n) { this.statusCode = n; return this; },
    json(o) { this.body = o; return this; },
  };
  await handler({ method, query, body, headers }, res);
  return res;
}
