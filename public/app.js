const form = document.querySelector("#resolveForm");
const urlInput = document.querySelector("#urlInput");
const providerPanel = document.querySelector("#providerPanel");
const jobsList = document.querySelector("#jobsList");
const refreshJobs = document.querySelector("#refreshJobs");

let currentProvider = null;
let pollTimer = null;

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
    </div>
    <form id="downloadForm" class="download-form">
      <div class="format-grid">${formatButtons}</div>
      <button type="submit">开始下载</button>
    </form>
  `;

  document.querySelector("#downloadForm").addEventListener("submit", startDownload);
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
    renderError(error.message);
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

loadJobs();
