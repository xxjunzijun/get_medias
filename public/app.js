const form = document.querySelector("#resolveForm");
const urlInput = document.querySelector("#urlInput");
const providerPanel = document.querySelector("#providerPanel");
const jobsList = document.querySelector("#jobsList");
const refreshJobs = document.querySelector("#refreshJobs");

let currentProvider = null;
let pollTimer = null;
let oauthPollTimer = null;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await resolveUrl(urlInput.value.trim());
});

refreshJobs.addEventListener("click", loadJobs);

async function resolveUrl(url) {
  providerPanel.className = "provider-panel";
  providerPanel.innerHTML = `<p class="muted">正在解析...</p>`;

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
      <input type="radio" name="format" value="${format.id}" ${format.id === provider.defaultFormat ? "checked" : ""}>
      <span>
        <strong>${format.label}</strong>
        <small>${format.detail}</small>
      </span>
    </label>
  `).join("");

  providerPanel.innerHTML = `
    <div class="provider-copy">
      <p class="muted">已识别：${provider.name}</p>
      <h2>${provider.description}</h2>
      <p class="requirements">依赖：${provider.requirements.map((item) => `<code>${item}</code>`).join(" ")}</p>
      ${provider.auth ? renderAuthCard(provider.auth) : ""}
    </div>
    <form id="downloadForm" class="download-form">
      <div class="format-grid">${formatButtons}</div>
      <button type="submit">开始下载</button>
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
  if (!currentProvider) return;

  const format = new FormData(event.currentTarget).get("format");
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  button.textContent = "已加入任务";

  try {
    await requestJson("/api/download", {
      url: currentProvider.url,
      format,
    });
    await loadJobs();
    startPolling();
  } catch (error) {
    alert(`下载任务创建失败：${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = "开始下载";
  }
}

async function loadJobs() {
  const data = await fetch("/api/jobs").then((response) => response.json());
  renderJobs(data.jobs || []);
}

function renderJobs(jobs) {
  if (!jobs.length) {
    jobsList.innerHTML = `<p class="muted empty-list">暂无任务</p>`;
    return;
  }

  jobsList.innerHTML = jobs.map((job) => `
    <article class="job-card">
      <div class="job-topline">
        <div>
          <p class="muted">${job.provider.name}</p>
          <h3>${job.request.url}</h3>
        </div>
        <span class="status status-${job.status}">${statusLabel(job.status)}</span>
      </div>
      <dl>
        <div><dt>格式</dt><dd>${job.request.format}</dd></div>
        <div><dt>输出目录</dt><dd>${job.expectedOutput || "等待生成"}</dd></div>
      </dl>
      ${job.command ? `<pre class="command">${escapeHtml(job.command)}</pre>` : ""}
      ${job.output ? `<pre class="output">${escapeHtml(job.output)}</pre>` : ""}
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
    <p class="muted">解析失败</p>
    <h2>${escapeHtml(message)}</h2>
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

loadJobs();
