import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const PIXIV_CLIENT_ID = "MOBrBDS8blbauoSck0ZfDbtuzpyT";
const PIXIV_CLIENT_SECRET = "lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj";
const PIXIV_REDIRECT_URI = "https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback";
const PIXIV_USER_AGENT = "PixivAndroidApp/5.0.234 (Android 11; Pixel 5)";
const execFileAsync = promisify(execFile);

const sessions = new Map();

export function startPixivOauth() {
  const codeVerifier = base64Url(crypto.randomBytes(32));
  const codeChallenge = base64Url(crypto.createHash("sha256").update(codeVerifier).digest());
  const loginUrl = new URL("https://app-api.pixiv.net/web/v1/login");
  loginUrl.searchParams.set("client", "pixiv-android");
  loginUrl.searchParams.set("code_challenge_method", "S256");
  loginUrl.searchParams.set("code_challenge", codeChallenge);

  const session = {
    id: crypto.randomUUID(),
    provider: "pixiv",
    status: "waiting",
    loginUrl: loginUrl.toString(),
    challengePreview: codeChallenge.slice(0, 10),
    error: "",
    configPath: galleryDlConfigPath(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    codeVerifier,
  };

  sessions.set(session.id, session);
  return serializeSession(session);
}

export async function submitPixivOauthCode(id, input) {
  const session = sessions.get(id);
  if (!session) {
    throw new Error("授权会话不存在或已过期，请重新开始。");
  }

  updateSession(session, { status: "submitting", error: "" });

  try {
    const code = extractCode(input);
    const token = await exchangePixivCode(code, session.codeVerifier);
    await writePixivRefreshToken(token);
    updateSession(session, { status: "completed" });
  } catch (error) {
    const message = formatErrorMessage(error);
    console.error("[pixiv-oauth] submit failed", {
      sessionId: id,
      message,
      stack: error.stack,
      cause: serializeCause(error.cause),
      proxy: proxyEnvSummary(),
    });
    updateSession(session, { status: "failed", error: message });
  }

  return serializeSession(session);
}

export function getOauthSession(id) {
  const session = sessions.get(id);
  return session ? serializeSession(session) : null;
}

export function openPixivOauthInSystemBrowser(id) {
  const session = sessions.get(id);
  if (!session) {
    throw new Error("授权会话不存在或已过期，请重新开始。");
  }

  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32"
    ? ["/c", "start", "", session.loginUrl]
    : [session.loginUrl];

  const child = spawn(opener, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return serializeSession(session);
}

async function exchangePixivCode(code, codeVerifier) {
  const body = new URLSearchParams({
    client_id: PIXIV_CLIENT_ID,
    client_secret: PIXIV_CLIENT_SECRET,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    include_policy: "true",
    redirect_uri: PIXIV_REDIRECT_URI,
  });

  const data = await postPixivToken(body);

  if (data.error) {
    const reason = data.error_description || data.error;
    throw new Error(`Pixiv 授权失败：${reason}。请确认 callback URL 来自当前这次“开始授权”生成的链接；如果中途重新点过“开始授权”，旧 code 会和新会话不匹配。`);
  }

  if (!data.refresh_token) {
    throw new Error("Pixiv 授权响应里没有 refresh_token。");
  }

  return data.refresh_token;
}

async function postPixivToken(body) {
  const url = "https://oauth.secure.pixiv.net/auth/token";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": PIXIV_USER_AGENT,
      },
      body,
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const reason = data.error_description || data.error || `HTTP ${response.status}`;
      throw new Error(`Pixiv token endpoint failed: ${reason}`);
    }

    return data;
  } catch (error) {
    console.error("[pixiv-oauth] fetch token request failed, trying curl fallback", {
      message: error.message,
      cause: serializeCause(error.cause),
      proxy: proxyEnvSummary(),
    });
    return postPixivTokenWithCurl(url, body);
  }
}

async function postPixivTokenWithCurl(url, body) {
  try {
    const { stdout } = await execFileAsync("curl", [
      "--fail-with-body",
      "--silent",
      "--show-error",
      "--max-time",
      "20",
      "--request",
      "POST",
      "--header",
      "content-type: application/x-www-form-urlencoded",
      "--header",
      `user-agent: ${PIXIV_USER_AGENT}`,
      "--data",
      body.toString(),
      url,
    ], {
      maxBuffer: 1024 * 1024,
      env: process.env,
    });

    return JSON.parse(stdout);
  } catch (error) {
    const stderr = error.stderr?.toString().trim();
    const stdout = error.stdout?.toString().trim();
    error.message = [
      "Pixiv token 请求失败。",
      stderr || stdout || error.message,
      proxyEnvSummary().hasProxy
        ? "检测到代理环境变量；如果仍失败，请确认 systemd 服务继承了 HTTPS_PROXY/HTTP_PROXY。"
        : "当前 Node 进程未检测到 HTTPS_PROXY/HTTP_PROXY；Linux 服务器无法直连 Pixiv 时需要给服务配置代理。",
    ].join(" ");
    throw error;
  }
}

async function writePixivRefreshToken(token) {
  const configPath = galleryDlConfigPath();
  let config = {};

  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(`无法读取 gallery-dl 配置文件 ${configPath}：${error.message}`);
    }
  }

  config.extractor ||= {};
  config.extractor.pixiv ||= {};
  config.extractor.pixiv["refresh-token"] = token;

  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function extractCode(input) {
  const value = String(input || "").trim();
  if (!value) {
    throw new Error("请输入 Pixiv callback 里的 code 或完整 callback URL。");
  }

  try {
    const parsed = new URL(value);
    const code = parsed.searchParams.get("code");
    if (code) return code;
  } catch {
    // Plain code values are expected here.
  }

  const query = value.replace(/^[?#]/, "");
  const params = new URLSearchParams(query);
  const code = params.get("code");
  if (code) return code;

  const codeMatch = value.match(/(?:^|[?&#])code=([^&#\s]+)/);
  if (codeMatch) return decodeURIComponent(codeMatch[1]);

  return value;
}

function galleryDlConfigPath() {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdgConfigHome, "gallery-dl", "config.json");
}

function base64Url(buffer) {
  return buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function formatErrorMessage(error) {
  const parts = [error.message];
  const cause = serializeCause(error.cause);
  if (cause) parts.push(`cause: ${cause}`);
  return parts.join(" ");
}

function serializeCause(cause) {
  if (!cause) return "";
  return [
    cause.code,
    cause.errno,
    cause.syscall,
    cause.hostname,
    cause.address,
    cause.port,
    cause.message,
  ].filter(Boolean).join(" ");
}

function proxyEnvSummary() {
  return {
    hasProxy: Boolean(process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy),
    hasNoProxy: Boolean(process.env.NO_PROXY || process.env.no_proxy),
  };
}

function updateSession(session, patch) {
  Object.assign(session, patch, { updatedAt: new Date().toISOString() });
}

function serializeSession(session) {
  const { codeVerifier, ...safeSession } = session;
  return safeSession;
}
