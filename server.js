import http from "node:http";
import { readdir, rm, stat } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveProvider } from "./src/providers/index.js";
import { createJob, getJob, listJobs } from "./src/jobStore.js";
import { getOauthSession, openPixivOauthInSystemBrowser, startPixivOauth, submitPixivOauthCode } from "./src/oauthStore.js";
import { startDownload } from "./src/runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const downloadsDir = path.join(__dirname, "downloads");
const port = Number(process.env.PORT || 3000);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".mp3", "audio/mpeg"],
  [".m4a", "audio/mp4"],
  [".wav", "audio/wav"],
  [".flac", "audio/flac"],
  [".ogg", "audio/ogg"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
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

function resolveDownloadPath(relativePath = "") {
  const normalized = path.normalize(decodeURIComponent(relativePath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(downloadsDir, normalized);
  if (!filePath.startsWith(downloadsDir)) {
    throw new Error("Invalid download path.");
  }
  return filePath;
}

async function buildDownloadTree(dir = downloadsDir, relativePath = "") {
  if (!existsSync(dir)) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const items = await Promise.all(entries
    .filter((entry) => !entry.name.startsWith("."))
    .map(async (entry) => {
      const entryRelativePath = path.join(relativePath, entry.name);
      const entryPath = path.join(dir, entry.name);
      const info = await stat(entryPath);

      if (entry.isDirectory()) {
        return {
          type: "directory",
          name: entry.name,
          path: entryRelativePath,
          updatedAt: info.mtime.toISOString(),
          children: await buildDownloadTree(entryPath, entryRelativePath),
        };
      }

      return {
        type: "file",
        name: entry.name,
        path: entryRelativePath,
        size: info.size,
        updatedAt: info.mtime.toISOString(),
        mediaUrl: `/media/${entryRelativePath.split(path.sep).map(encodeURIComponent).join("/")}`,
        mediaType: mediaKind(entry.name),
      };
    }));

  return items.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true });
  });
}

function mediaKind(filename) {
  const ext = path.extname(filename).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return "image";
  if ([".mp4", ".webm"].includes(ext)) return "video";
  if ([".mp3", ".m4a", ".wav", ".flac", ".ogg"].includes(ext)) return "audio";
  return "file";
}

async function serveDownloadFile(res, relativePath) {
  const filePath = resolveDownloadPath(relativePath);
  if (!existsSync(filePath) || (await stat(filePath)).isDirectory()) {
    sendJson(res, 404, { error: "File not found" });
    return;
  }

  res.writeHead(200, {
    "content-type": mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
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

    if (req.method === "POST" && requestUrl.pathname === "/api/oauth/pixiv/start") {
      sendJson(res, 202, { session: startPixivOauth() });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/oauth/pixiv/submit") {
      const { id, code } = await readJson(req);
      if (!code || !String(code).trim()) {
        throw new Error("请输入 Pixiv callback 里的 code 或完整 callback URL。");
      }
      sendJson(res, 202, { session: await submitPixivOauthCode(id, String(code).trim()) });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/oauth/pixiv/open") {
      const { id } = await readJson(req);
      sendJson(res, 202, { session: openPixivOauthInSystemBrowser(id) });
      return;
    }

    const oauthMatch = requestUrl.pathname.match(/^\/api\/oauth\/pixiv\/([^/]+)$/);
    if (req.method === "GET" && oauthMatch) {
      const session = getOauthSession(oauthMatch[1]);
      sendJson(res, session ? 200 : 404, session || { error: "OAuth session not found" });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/jobs") {
      sendJson(res, 200, { jobs: listJobs() });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/downloads") {
      sendJson(res, 200, { root: downloadsDir, items: await buildDownloadTree() });
      return;
    }

    if (req.method === "DELETE" && requestUrl.pathname === "/api/downloads") {
      const { path: targetPath } = await readJson(req);
      if (!targetPath || !String(targetPath).trim()) {
        throw new Error("Missing download path.");
      }
      const filePath = resolveDownloadPath(String(targetPath));
      if (filePath === downloadsDir) {
        throw new Error("Cannot delete downloads root.");
      }
      if (!existsSync(filePath)) {
        sendJson(res, 404, { error: "Download item not found" });
        return;
      }
      await rm(filePath, { recursive: true, force: true });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname.startsWith("/media/")) {
      await serveDownloadFile(res, requestUrl.pathname.slice("/media/".length));
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
