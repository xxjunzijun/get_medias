const form = document.querySelector("#resolveForm");
const urlInput = document.querySelector("#urlInput");
const providerPanel = document.querySelector("#providerPanel");
const jobsList = document.querySelector("#jobsList");
const refreshJobs = document.querySelector("#refreshJobs");
const toast = document.querySelector("#toast");

let currentProvider = null;
let pollTimer = null;
let oauthPollTimer = null;
let toastTimer = null;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await resolveUrl(urlInput.value.trim());
});

refreshJobs.addEventListener("click", loadJobs);

async function resolveUrl(url) {
  providerPanel.className = "provider-panel is-empty";
  providerPanel.innerHTML = `
    <div class="empty-illustration" aria-hidden="true"><span>…</span></div>
    <div class="empty-copy">
      <p class="section-kicker">正在识别</p>
      <h2>正在解析媒体信息</h2>
      <p class="muted">通常只需要几秒钟，请稍候。</p>
    </div>
  `;

  try {
    const data = await requestJson("/api/resolve", { url });
    currentProvider = data.provider;
    renderProvider(data.provider);
  } catch (error) {
    currentProvider = null;
    renderError(error.message);
  }
}

function renderProvider(provider) {
  const formatButtons = provider.formats.map((format) => `
    <label class="format-option">
      <input type="radio" name="format" value="${escapeAttr(format.id)}" ${format.id === provider.defaultFormat ? "checked" : ""}>
      <span>
        <strong>${escapeHtml(format.label)}</strong>
        <small>${escapeHtml(format.detail)}</small>
      </span>
    </label>
  `).join("");

  providerPanel.className = "provider-panel";
  providerPanel.innerHTML = `
    <div class="provider-copy">
      <p class="muted">已识别 · ${escapeHtml(provider.name)}</p>
      <h2>${escapeHtml(provider.description)}</h2>
      <p class="requirements">本机工具：${provider.requirements.map((item) => `<code>${escapeHtml(item)}</code>`).join(" ")}</p>
      ${provider.auth ? renderAuthCard(provider.auth) : ""}
    </div>
    <form id="downloadForm" class="download-form">
      <div class="format-grid">${formatButtons}</div>
      <button type="submit">加入下载队列</button>
    </form>
  `;

  document.querySelector("#downloadForm").addEventListener("submit", startDownload);
  document.querySelector("#startPixivOauth")?.addEventListener("click", startPixivOauth);
  document.querySelector("#pixivOauthForm")?.addEventListener("submit", submitPixivOauthCode);
  document.querySelector("#openPixivSystemBrowser")?.addEventListener("click", openPixivSystemBrowser);
  document.querySelector("#copyPixivOauthUrl")?.addEventListener("click", copyPixivOauthUrl);
}

function renderAuthCard(auth) {
  if (auth.type !== "pixiv-oauth") return "";

  return `
    <section class="auth-card">
      <div>
        <p class="muted">${escapeHtml(auth.label)}</p>
        <p>${escapeHtml(auth.description)}</p>
      </div>
      <button id="startPixivOauth" type="button" class="ghost-button">开始授权</button>
      <div id="pixivOauthState" class="oauth-state"></div>
      <form id="pixivOauthForm" class="oauth-form" hidden>
        <input id="pixivOauthCode" name="code" placeholder="粘贴 callback URL 或 code" autocomplete="off">
        <button type="submit">提交 code</button>
      </form>
    </section>
  `;
}

async function startPixivOauth() {
  const button = document.querySelector("#startPixivOauth");
  button.disabled = true;
  button.textContent = "启动中";

  try {
    const data = await requestJson("/api/oauth/pixiv/start", {});
    renderOauthSession(data.session);
    pollOauth(data.session.id);
  } catch (error) {
    renderOauthError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "重新开始授权";
  }
}

async function submitPixivOauthCode(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.dataset.sessionId;
  const code = new FormData(form).get("code");

  try {
    const data = await requestJson("/api/oauth/pixiv/submit", { id, code });
    renderOauthSession(data.session);
    pollOauth(data.session.id);
  } catch (error) {
    renderOauthError(error.message);
  }
}

function pollOauth(id) {
  clearInterval(oauthPollTimer);
  oauthPollTimer = setInterval(async () => {
    const response = await fetch(`/api/oauth/pixiv/${id}`);
    const session = await response.json();
    if (!response.ok) {
      renderOauthError(session.error || "授权状态读取失败");
      clearInterval(oauthPollTimer);
      return;
    }

    renderOauthSession(session);
    if (["completed", "failed"].includes(session.status)) {
      clearInterval(oauthPollTimer);
    }
  }, 1000);
}

function renderOauthSession(session) {
  const state = document.querySelector("#pixivOauthState");
  const form = document.querySelector("#pixivOauthForm");
  if (!state || !form) return;

  form.hidden = !session.loginUrl || ["completed", "failed"].includes(session.status);
  form.dataset.sessionId = session.id;

  if (session.status === "completed") {
    state.innerHTML = `
      <div class="oauth-status oauth-completed">
        <strong>授权完成</strong>
        <p>Pixiv 登录态已保存到 <code>${escapeHtml(session.configPath || "gallery-dl config")}</code>，现在可以直接开始下载。</p>
      </div>
    `;
    return;
  }

  const loginLink = session.loginUrl
    ? `<span class="oauth-actions"><a href="${session.loginUrl}" target="_blank" rel="noreferrer">在当前浏览器打开</a><button id="openPixivSystemBrowser" type="button" class="ghost-button" data-session-id="${session.id}">用系统浏览器打开</button><button id="copyPixivOauthUrl" type="button" class="ghost-button" data-login-url="${session.loginUrl}">复制授权链接</button></span>`
    : "正在等待 gallery-dl 生成登录链接...";

  state.innerHTML = `
    <div class="oauth-status oauth-${session.status}">
      <strong>${oauthStatusLabel(session.status)}</strong>
      ${session.challengePreview ? `<p class="oauth-fingerprint">当前授权指纹：<code>${escapeHtml(session.challengePreview)}</code></p>` : ""}
      <p>${loginLink}</p>
      ${session.loginUrl ? `<ol><li>打开链接前，先打开开发者工具 Network 面板，并启用 Preserve Log / 保留日志。</li><li>登录 Pixiv 后点「继续使用此账号」。如果 Safari 提示网址无效，这是正常的。</li><li>在保留下来的 Network 记录里找最后一个 callback 请求，复制包含 code= 的 URL。</li><li>如果 Safari 仍然清空记录，复制授权链接到 Chrome 或 Edge，打开 DevTools Network 并勾选 Preserve log 后重试。</li><li>把 code、包含 code 的地址、或 code=...&state=... 整段内容粘贴到下方并提交。</li></ol>` : ""}
      ${session.error ? `<p class="error-text">${escapeHtml(session.error)}</p>` : ""}
    </div>
  `;

  document.querySelector("#openPixivSystemBrowser")?.addEventListener("click", openPixivSystemBrowser);
  document.querySelector("#copyPixivOauthUrl")?.addEventListener("click", copyPixivOauthUrl);
}

async function openPixivSystemBrowser(event) {
  const button = event.currentTarget;
  const id = button.dataset.sessionId;
  button.disabled = true;
  button.textContent = "已打开";

  try {
    await requestJson("/api/oauth/pixiv/open", { id });
  } catch (error) {
    renderOauthError(error.message);
  } finally {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = "用系统浏览器打开";
    }, 1200);
  }
}

async function copyPixivOauthUrl(event) {
  const button = event.currentTarget;
  const url = button.dataset.loginUrl;

  try {
    await navigator.clipboard.writeText(url);
    button.textContent = "已复制";
  } catch {
    window.prompt("复制这条 Pixiv 授权链接", url);
  } finally {
    setTimeout(() => {
      button.textContent = "复制授权链接";
    }, 1200);
  }
}

function renderOauthError(message) {
  const state = document.querySelector("#pixivOauthState");
  if (state) {
    state.innerHTML = `<p class="error-text">${escapeHtml(message)}</p>`;
  }
}

async function startDownload(event) {
  event.preventDefault();

  const requestedUrl = urlInput.value.trim();
  if (!requestedUrl) return;

  const selectedFormat = new FormData(event.currentTarget).get("format");
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;

  try {
    let provider = currentProvider;
    if (!provider || provider.url !== requestedUrl) {
      button.textContent = "解析中";
      const data = await requestJson("/api/resolve", { url: requestedUrl });
      provider = data.provider;
      currentProvider = provider;
      renderProvider(provider);
    }

    const format = provider.formats.some((item) => item.id === selectedFormat)
      ? selectedFormat
      : provider.defaultFormat;

    button.textContent = "已加入任务";
    await requestJson("/api/download", {
      url: requestedUrl,
      format,
    });
    showToast("任务已加入下载队列");
    await loadJobs();
    startPolling();
  } catch (error) {
    showToast(`下载任务创建失败：${error.message}`, true);
  } finally {
    const latestButton = document.querySelector("#downloadForm button");
    if (latestButton) {
      latestButton.disabled = false;
      latestButton.textContent = "加入下载队列";
    }
  }
}

async function loadJobs() {
  const data = await fetch("/api/jobs").then((response) => response.json());
  renderJobs(data.jobs || []);
}

function renderJobs(jobs) {
  if (!jobs.length) {
    jobsList.innerHTML = `<p class="muted empty-list">还没有下载任务，从上方粘贴一个链接开始吧。</p>`;
    return;
  }

  jobsList.innerHTML = jobs.map((job) => `
    <article class="job-card">
      <div class="job-topline">
        <div>
          <p class="section-kicker">${escapeHtml(job.provider.name)}</p>
          <h3>${escapeHtml(job.request.url)}</h3>
        </div>
        <span class="status status-${escapeAttr(job.status)}">${escapeHtml(statusLabel(job.status))}</span>
      </div>
      ${["queued", "running"].includes(job.status) ? `<div class="job-progress" aria-label="${statusLabel(job.status)}"></div>` : ""}
      <dl>
        <div><dt>格式</dt><dd>${escapeHtml(job.request.format)}</dd></div>
        <div><dt>保存位置</dt><dd>${escapeHtml(job.expectedOutput || "等待生成")}</dd></div>
      </dl>
      ${job.command || job.output ? `
        <details class="job-log">
          <summary>查看任务日志</summary>
          ${job.command ? `<pre class="command">${escapeHtml(job.command)}</pre>` : ""}
          ${job.output ? `<pre class="output">${escapeHtml(job.output)}</pre>` : ""}
        </details>
      ` : ""}
      ${job.error ? `<p class="error-text">${escapeHtml(job.error)}</p>` : ""}
    </article>
  `).join("");
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    await loadJobs();
    const hasRunningJob = [...document.querySelectorAll(".status-running, .status-queued")].length > 0;
    if (!hasRunningJob) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }, 1500);
}

async function requestJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function renderError(message) {
  providerPanel.className = "provider-panel has-error";
  providerPanel.innerHTML = `
    <p class="section-kicker">解析失败</p>
    <h2>${escapeHtml(message)}</h2>
    <p class="muted">请检查链接是否完整，或尝试重新粘贴。</p>
  `;
}

function statusLabel(status) {
  return {
    queued: "排队中",
    running: "下载中",
    completed: "已完成",
    failed: "失败",
  }[status] || status;
}

function oauthStatusLabel(status) {
  return {
    starting: "正在启动授权",
    waiting: "等待登录 code",
    submitting: "正在提交 code",
    completed: "授权完成",
    failed: "授权失败",
  }[status] || status;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3600);
}

loadJobs().then(() => {
  const hasRunningJob = document.querySelector(".status-running, .status-queued");
  if (hasRunningJob) startPolling();
}).catch(() => {
  jobsList.innerHTML = `<p class="error-text empty-list">暂时无法读取任务，请稍后刷新。</p>`;
});
