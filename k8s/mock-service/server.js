const http = require("http");
const crypto = require("crypto");

const SERVICE_NAME = process.env.SERVICE_NAME || "unknown";
const PORT = parseInt(process.env.PORT || "8080", 10);
const DOWNSTREAM = (process.env.DOWNSTREAM_URLS || "")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

function buildTraceparent(incoming) {
  if (incoming && /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(incoming)) {
    const traceId = incoming.split("-")[1];
    return `00-${traceId}-${randomHex(8)}-01`;
  }
  return `00-${randomHex(16)}-${randomHex(8)}-01`;
}

function callDownstream(url, traceparent) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname,
      method: "GET",
      headers: { traceparent },
      timeout: 3000,
    };
    const req = http.request(opts, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ url, status: res.statusCode }));
    });
    req.on("error", (e) => resolve({ url, error: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ url, error: "timeout" }); });
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200);
    res.end("ok");
    return;
  }

  const incomingTp = req.headers["traceparent"];
  const outgoingTp = buildTraceparent(incomingTp);

  const downstream = await Promise.all(
    DOWNSTREAM.map((url) => callDownstream(url, outgoingTp))
  );

  const payload = {
    service: SERVICE_NAME,
    traceparent: outgoingTp,
    downstream,
    timestamp: new Date().toISOString(),
  };

  res.writeHead(200, {
    "Content-Type": "application/json",
    traceparent: outgoingTp,
  });
  res.end(JSON.stringify(payload));
});

server.listen(PORT, () =>
  console.log(`${SERVICE_NAME} listening on :${PORT}, downstream: ${DOWNSTREAM.join(", ") || "none"}`)
);
