import http from "node:http";
import { readFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveProvider } from "./src/providers/index.js";
import { createJob, getJob, listJobs } from "./src/jobStore.js";
import { startDownload } from "./src/runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 3000);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function normalizePublicPath(urlPath) {
  const safePath = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  return safePath === "/" ? "/index.html" : safePath;
}

async function serveStatic(req, res, pathname) {
  const filePath = path.join(publicDir, normalizePublicPath(pathname));
  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  res.writeHead(200, {
    "content-type": mimeTypes.get(path.extname(filePath)) || "application/octet-stream",
  });
  createReadStream(filePath).pipe(res);
}

async function router(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === "POST" && requestUrl.pathname === "/api/resolve") {
      const { url } = await readJson(req);
      const provider = resolveProvider(url);
      sendJson(res, 200, {
        provider: provider.describe(url),
      });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/download") {
      const body = await readJson(req);
      const provider = resolveProvider(body.url);
      const job = createJob(provider.describe(body.url), body);
      startDownload(job, provider, body);
      sendJson(res, 202, { job });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/jobs") {
      sendJson(res, 200, { jobs: listJobs() });
      return;
    }

    const jobMatch = requestUrl.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (req.method === "GET" && jobMatch) {
      const job = getJob(jobMatch[1]);
      sendJson(res, job ? 200 : 404, job || { error: "Job not found" });
      return;
    }

    if (req.method === "GET") {
      await serveStatic(req, res, requestUrl.pathname);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

http.createServer(router).listen(port, () => {
  console.log(`Get Videos is running at http://localhost:${port}`);
});
