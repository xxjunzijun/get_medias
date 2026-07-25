const downloadsNav = document.querySelector("#downloadsNav");
const downloadsList = document.querySelector("#downloadsList");
const refreshDownloads = document.querySelector("#refreshDownloads");
const librarySummary = document.querySelector("#librarySummary");
const librarySearch = document.querySelector("#librarySearch");
const visibleTaskCount = document.querySelector("#visibleTaskCount");
const filterPills = document.querySelector(".filter-pills");
const lightbox = document.querySelector("#lightbox");
const lightboxImage = document.querySelector("#lightboxImage");
const lightboxCaption = document.querySelector("#lightboxCaption");
const closeLightbox = document.querySelector("#closeLightbox");
const prevLightbox = document.querySelector("#prevLightbox");
const nextLightbox = document.querySelector("#nextLightbox");
const toast = document.querySelector("#toast");

const siteOrder = ["bilibili", "youtube", "pixiv"];
const siteLabels = {
  bilibili: "Bilibili 视频",
  youtube: "YouTube 视频",
  pixiv: "Pixiv 图片",
};

let currentGroups = [];
let selectedGroupPath = "";
let currentImages = [];
let currentImageIndex = 0;
let activeSiteFilter = "all";
let searchTerm = "";
let toastTimer = null;

refreshDownloads.addEventListener("click", loadDownloads);
librarySearch.addEventListener("input", (event) => {
  searchTerm = event.currentTarget.value.trim().toLocaleLowerCase();
  ensureVisibleSelection();
  renderLibrary();
});
filterPills.addEventListener("click", (event) => {
  const button = event.target.closest("[data-site-filter]");
  if (!button) return;
  activeSiteFilter = button.dataset.siteFilter;
  filterPills.querySelectorAll("[data-site-filter]").forEach((item) => {
    item.classList.toggle("is-active", item === button);
  });
  ensureVisibleSelection();
  renderLibrary();
});
downloadsNav.addEventListener("click", handleNavClick);
downloadsList.addEventListener("click", handleContentClick);
closeLightbox.addEventListener("click", hideLightbox);
prevLightbox.addEventListener("click", () => moveLightbox(-1));
nextLightbox.addEventListener("click", () => moveLightbox(1));
lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox) hideLightbox();
});
document.addEventListener("keydown", (event) => {
  if (lightbox.hidden) return;
  if (event.key === "Escape") hideLightbox();
  if (event.key === "ArrowLeft") moveLightbox(-1);
  if (event.key === "ArrowRight") moveLightbox(1);
});

async function loadDownloads() {
  downloadsNav.innerHTML = `<p class="muted empty-list">正在读取...</p>`;
  downloadsList.innerHTML = renderEmptyState("正在读取 downloads 目录");

  const data = await fetch("/api/downloads").then((response) => response.json());
  currentGroups = buildTaskGroups(data.items || []);
  ensureVisibleSelection();
  renderLibrary();
}

function buildTaskGroups(siteDirs) {
  return siteDirs.flatMap((site) => {
    if (site.type !== "directory") return [];

    const taskDirs = site.children.filter((item) => item.type === "directory");
    const looseFiles = site.children.filter((item) => item.type === "file");
    const tasks = taskDirs.map((task) => createTaskGroup(
      site.name,
      task.name,
      task.path,
      task.children || [],
      task.updatedAt,
      task.metadata,
    ));

    if (looseFiles.length) {
      tasks.unshift(createTaskGroup(site.name, site.name, site.path, looseFiles, site.updatedAt, site.metadata));
    }

    return tasks;
  }).sort((a, b) => {
    const siteDelta = siteOrder.indexOf(a.site) - siteOrder.indexOf(b.site);
    return siteDelta || compareNewestFirst(a.updatedAt, b.updatedAt);
  });
}

function createTaskGroup(site, title, groupPath, items, updatedAt, metadata = null) {
  const files = flattenFiles(items);
  const cover = files.find((file) => file.mediaType === "image") || files.find((file) => file.mediaType === "video") || files[0];

  return {
    site,
    title,
    path: groupPath,
    files,
    cover,
    metadata,
    updatedAt: latestTime(files) || updatedAt,
    size: files.reduce((sum, file) => sum + (file.size || 0), 0),
  };
}

function flattenFiles(items) {
  return items.flatMap((item) => {
    if (item.type === "file") return [item];
    if (item.type === "directory") return flattenFiles(item.children || []);
    return [];
  }).sort((a, b) => compareNewestFirst(a.updatedAt, b.updatedAt));
}

function latestTime(files) {
  return files.map((file) => file.updatedAt).sort().at(-1);
}

function compareNewestFirst(left, right) {
  return new Date(right || 0) - new Date(left || 0);
}

function renderLibrary() {
  const fileCount = currentGroups.reduce((sum, group) => sum + group.files.length, 0);
  librarySummary.textContent = currentGroups.length
    ? `${currentGroups.length} 个任务 · ${fileCount} 个文件`
    : "暂无已下载内容";
  visibleTaskCount.textContent = visibleGroups().length;

  renderSidebar();
  renderSelectedGroup();
}

function renderSidebar() {
  const filteredGroups = visibleGroups();
  const groupsBySite = Object.groupBy
    ? Object.groupBy(filteredGroups, (group) => group.site)
    : groupBySite(filteredGroups);

  const sections = siteOrder.map((site) => {
    const groups = groupsBySite[site] || [];
    if (activeSiteFilter !== "all" && activeSiteFilter !== site) return "";
    return `
      <section class="nav-section">
        <div class="nav-section-title">
          <span>${escapeHtml(siteLabels[site])}</span>
          <small>${groups.length}</small>
        </div>
        <div class="nav-task-list">
          ${groups.length ? groups.map(renderNavTask).join("") : `<p class="muted nav-empty">暂无任务</p>`}
        </div>
      </section>
    `;
  }).join("");

  downloadsNav.innerHTML = filteredGroups.length
    ? sections
    : `<p class="muted empty-list">没有匹配的下载任务</p>`;
}

function renderNavTask(group) {
  const isImageCollection = group.files.length > 0
    && group.files.every((file) => file.mediaType === "image");
  const thumbnail = isImageCollection
    ? `<img class="nav-task-thumb" src="${escapeAttr(group.files[0].mediaUrl)}" alt="">`
    : `<span class="nav-task-icon" aria-hidden="true">${mediaGroupIcon(group)}</span>`;

  return `
    <button class="nav-task ${group.path === selectedGroupPath ? "is-active" : ""}" type="button" data-select-path="${escapeAttr(group.path)}">
      ${thumbnail}
      <span class="nav-task-copy">
        <strong>${escapeHtml(group.title)}</strong>
        <small>${group.files.length} 个文件 · ${formatBytes(group.size)}</small>
      </span>
    </button>
  `;
}

function renderSelectedGroup() {
  const group = visibleGroups().find((item) => item.path === selectedGroupPath);
  if (!group) {
    downloadsList.innerHTML = renderEmptyState(
      currentGroups.length ? "没有找到匹配内容，试试其他关键词" : "下载完成的内容会出现在这里",
    );
    return;
  }

  const images = group.files.filter((file) => file.mediaType === "image");
  const videos = group.files.filter((file) => file.mediaType === "video");
  const audios = group.files.filter((file) => file.mediaType === "audio");
  const others = group.files.filter((file) => !["image", "video", "audio"].includes(file.mediaType));

  downloadsList.innerHTML = `
    <article class="media-detail">
      <header class="media-detail-header">
        <div>
          <span class="site-pill">${escapeHtml(siteLabels[group.site] || group.site)}</span>
          <h2>${escapeHtml(group.title)}</h2>
          <p>${group.files.length} 个文件 · ${formatBytes(group.size)} · ${new Date(group.updatedAt).toLocaleString()}</p>
          ${group.metadata?.sourceUrl ? `<a class="source-link" href="${escapeAttr(group.metadata.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(group.metadata.sourceUrl)}</a>` : ""}
        </div>
        <div class="media-detail-actions">
          ${group.metadata?.sourceUrl ? `
            <button class="redownload-button" type="button" data-redownload-path="${escapeAttr(group.path)}">
              <span aria-hidden="true">↻</span> 重新下载
            </button>
          ` : ""}
          <button class="danger-button" type="button" data-delete-path="${escapeAttr(group.path)}" data-delete-name="${escapeAttr(group.title)}">删除任务</button>
        </div>
      </header>

      ${images.length ? renderImageGrid(images) : ""}
      ${videos.length ? renderMediaList("视频", videos) : ""}
      ${audios.length ? renderMediaList("音频", audios) : ""}
      ${others.length ? renderMediaList("文件", others) : ""}
    </article>
  `;
}

function renderImageGrid(images) {
  return `
    <section class="media-section">
      <div class="media-section-title">
        <h3>图片</h3>
        <span>${images.length}</span>
      </div>
      <div class="masonry-grid">
        ${images.map((file, index) => renderImageTile(file, index)).join("")}
      </div>
    </section>
  `;
}

function renderImageTile(file, index) {
  return `
    <figure class="image-tile" style="--tile-index: ${Math.min(index, 12)}">
      <button type="button" data-view-image="${escapeAttr(file.path)}">
        <img src="${escapeAttr(file.mediaUrl)}" alt="${escapeAttr(file.name)}" loading="lazy">
      </button>
      <figcaption>
        <span>${escapeHtml(file.name)}</span>
        <button class="danger-link" type="button" data-delete-path="${escapeAttr(file.path)}" data-delete-name="${escapeAttr(file.name)}">删除</button>
      </figcaption>
    </figure>
  `;
}

function renderMediaList(title, files) {
  return `
    <section class="media-section">
      <div class="media-section-title">
        <h3>${title}</h3>
        <span>${files.length}</span>
      </div>
      <div class="media-list">
        ${files.map(renderMediaRow).join("")}
      </div>
    </section>
  `;
}

function renderMediaRow(file) {
  const preview = file.mediaType === "video"
    ? `<video controls src="${file.mediaUrl}"></video>`
    : file.mediaType === "audio"
      ? `<audio controls src="${file.mediaUrl}"></audio>`
      : `<a href="${file.mediaUrl}" target="_blank" rel="noreferrer">打开文件</a>`;

  return `
    <article class="media-row">
      <div>${preview}</div>
      <div>
        <strong>${escapeHtml(file.name)}</strong>
        <small>${formatBytes(file.size)}</small>
        <button class="danger-link" type="button" data-delete-path="${escapeAttr(file.path)}" data-delete-name="${escapeAttr(file.name)}">删除</button>
      </div>
    </article>
  `;
}

async function handleNavClick(event) {
  const task = event.target.closest("[data-select-path]");
  if (!task) return;
  selectedGroupPath = task.dataset.selectPath;
  renderLibrary();
}

async function handleContentClick(event) {
  const imageLink = event.target.closest("[data-view-image]");
  if (imageLink) {
    event.preventDefault();
    showLightbox(imageLink.dataset.viewImage);
    return;
  }

  const redownloadButton = event.target.closest("[data-redownload-path]");
  if (redownloadButton) {
    await redownloadGroup(redownloadButton);
    return;
  }

  const button = event.target.closest("[data-delete-path]");
  if (!button) return;

  const targetPath = button.dataset.deletePath;
  const targetName = button.dataset.deleteName;
  if (!confirm(`确定删除「${targetName}」吗？此操作不可恢复。`)) return;

  button.disabled = true;
  button.textContent = "删除中";

  const response = await fetch("/api/downloads", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: targetPath }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    showToast(data.error || "删除失败", true);
    button.disabled = false;
    button.textContent = button.classList.contains("danger-button") ? "删除任务" : "删除";
    return;
  }

  showToast(`已删除「${targetName}」`);
  await loadDownloads();
}

async function redownloadGroup(button) {
  const group = currentGroups.find((item) => item.path === button.dataset.redownloadPath);
  const sourceUrl = group?.metadata?.sourceUrl;
  if (!sourceUrl) {
    showToast("这个旧任务没有保存来源链接，无法快速重新下载", true);
    return;
  }

  const originalText = button.innerHTML;
  button.disabled = true;
  button.textContent = "正在加入队列";

  try {
    const response = await fetch("/api/download", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: sourceUrl,
        format: group.metadata.format || defaultFormatForSite(group.site),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "任务创建失败");

    button.textContent = "已加入队列";
    showToast(`已重新下载「${group.title}」，可前往下载器查看进度`);
  } catch (error) {
    button.innerHTML = originalText;
    button.disabled = false;
    showToast(`重新下载失败：${error.message}`, true);
    return;
  }

  setTimeout(() => {
    button.innerHTML = originalText;
    button.disabled = false;
  }, 1800);
}

function showLightbox(path) {
  const group = currentGroups.find((item) => item.path === selectedGroupPath);
  currentImages = (group?.files || []).filter((file) => file.mediaType === "image");
  currentImageIndex = Math.max(0, currentImages.findIndex((file) => file.path === path));
  renderLightbox();
  lightbox.hidden = false;
}

function renderLightbox() {
  const image = currentImages[currentImageIndex];
  if (!image) return;

  lightboxImage.classList.remove("is-switching");
  void lightboxImage.offsetWidth;
  lightboxImage.src = image.mediaUrl;
  lightboxImage.alt = image.name;
  lightboxCaption.textContent = `${image.name} · ${currentImageIndex + 1} / ${currentImages.length}`;
  lightboxImage.classList.add("is-switching");
  preloadAdjacentImages();
}

function moveLightbox(delta) {
  if (!currentImages.length) return;
  currentImageIndex = (currentImageIndex + delta + currentImages.length) % currentImages.length;
  renderLightbox();
}

function hideLightbox() {
  lightbox.hidden = true;
  lightboxImage.removeAttribute("src");
  lightboxImage.removeAttribute("alt");
}

function groupBySite(groups) {
  return groups.reduce((result, group) => {
    result[group.site] ||= [];
    result[group.site].push(group);
    return result;
  }, {});
}

function mediaGroupIcon(group) {
  if (group.files.some((file) => file.mediaType === "video")) return "▶";
  if (group.files.some((file) => file.mediaType === "audio")) return "♪";
  return "•";
}

function defaultFormatForSite(site) {
  return site === "pixiv" ? "images" : "mp4";
}

function preloadAdjacentImages() {
  if (currentImages.length < 2) return;
  [-1, 1].forEach((delta) => {
    const index = (currentImageIndex + delta + currentImages.length) % currentImages.length;
    const preview = new Image();
    preview.src = currentImages[index].mediaUrl;
  });
}

function visibleGroups() {
  return currentGroups.filter((group) => {
    if (activeSiteFilter !== "all" && group.site !== activeSiteFilter) return false;
    if (!searchTerm) return true;

    const searchable = [
      group.title,
      group.site,
      group.metadata?.sourceUrl,
      ...group.files.map((file) => file.name),
    ].filter(Boolean).join(" ").toLocaleLowerCase();

    return searchable.includes(searchTerm);
  });
}

function ensureVisibleSelection() {
  const groups = visibleGroups();
  if (!groups.some((group) => group.path === selectedGroupPath)) {
    selectedGroupPath = groups[0]?.path || "";
  }
}

function renderEmptyState(text) {
  return `
    <div class="empty-panel">
      <div class="empty-copy">
        <p class="section-kicker">Media Library</p>
        <h2>${escapeHtml(text)}</h2>
      </div>
    </div>
  `;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
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

loadDownloads().catch(() => {
  librarySummary.textContent = "读取失败";
  downloadsNav.innerHTML = `<p class="error-text empty-list">暂时无法读取媒体库</p>`;
  downloadsList.innerHTML = renderEmptyState("请确认服务正在运行后重试");
});
