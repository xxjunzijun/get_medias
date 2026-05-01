const downloadsList = document.querySelector("#downloadsList");
const refreshDownloads = document.querySelector("#refreshDownloads");
const librarySummary = document.querySelector("#librarySummary");
const lightbox = document.querySelector("#lightbox");
const lightboxImage = document.querySelector("#lightboxImage");
const lightboxCaption = document.querySelector("#lightboxCaption");
const closeLightbox = document.querySelector("#closeLightbox");
const prevLightbox = document.querySelector("#prevLightbox");
const nextLightbox = document.querySelector("#nextLightbox");

let currentGroups = [];
let currentImages = [];
let currentImageIndex = 0;

refreshDownloads.addEventListener("click", loadDownloads);
downloadsList.addEventListener("click", handleLibraryClick);
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
  downloadsList.innerHTML = `<p class="muted empty-list">正在读取...</p>`;
  const data = await fetch("/api/downloads").then((response) => response.json());
  const groups = buildTaskGroups(data.items || []);
  currentGroups = groups;
  renderDownloads(groups);
}

function buildTaskGroups(siteDirs) {
  return siteDirs.flatMap((site) => {
    if (site.type !== "directory") return [];

    const taskDirs = site.children.filter((item) => item.type === "directory");
    const looseFiles = site.children.filter((item) => item.type === "file");
    const tasks = taskDirs.map((task) => createTaskGroup(site.name, task.name, task.path, task.children || [], task.updatedAt));

    if (looseFiles.length) {
      tasks.unshift(createTaskGroup(site.name, site.name, site.path, looseFiles, site.updatedAt));
    }

    return tasks;
  }).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function createTaskGroup(site, title, groupPath, items, updatedAt) {
  const files = flattenFiles(items);
  const cover = files.find((file) => file.mediaType === "image") || files.find((file) => file.mediaType === "video") || files[0];

  return {
    site,
    title,
    path: groupPath,
    files,
    cover,
    updatedAt: latestTime(files) || updatedAt,
    size: files.reduce((sum, file) => sum + (file.size || 0), 0),
  };
}

function flattenFiles(items) {
  return items.flatMap((item) => {
    if (item.type === "file") return [item];
    if (item.type === "directory") return flattenFiles(item.children || []);
    return [];
  });
}

function latestTime(files) {
  return files.map((file) => file.updatedAt).sort().at(-1);
}

function renderDownloads(groups) {
  const fileCount = groups.reduce((sum, group) => sum + group.files.length, 0);
  librarySummary.textContent = groups.length
    ? `${groups.length} 个任务，${fileCount} 个文件`
    : "暂无已下载内容";

  if (!groups.length) {
    downloadsList.innerHTML = `<p class="muted empty-list">暂无已下载内容</p>`;
    return;
  }

  downloadsList.innerHTML = groups.map(renderTaskCard).join("");
}

function renderTaskCard(group) {
  return `
    <article class="album-card">
      <div class="album-cover">${renderAlbumCover(group)}</div>
      <div class="album-body">
        <div class="album-heading">
          <span class="site-pill">${escapeHtml(siteLabel(group.site))}</span>
          <h2>${escapeHtml(group.title)}</h2>
          <p>${group.files.length} 个文件 · ${formatBytes(group.size)} · ${new Date(group.updatedAt).toLocaleString()}</p>
        </div>
        <div class="album-actions">
          <a class="nav-link" href="${group.cover?.mediaUrl || "#"}" target="_blank" rel="noreferrer">打开封面</a>
          <button class="danger-button" type="button" data-delete-path="${escapeAttr(group.path)}" data-delete-name="${escapeAttr(group.title)}">删除相册</button>
        </div>
        <details class="album-details">
          <summary>查看相册内容</summary>
          <div class="album-grid">${group.files.map(renderAlbumItem).join("")}</div>
        </details>
      </div>
    </article>
  `;
}

function renderAlbumCover(group) {
  const images = group.files.filter((file) => file.mediaType === "image").slice(0, 4);
  if (images.length) {
    return images.map((file) => `
      <a href="${file.mediaUrl}" data-view-image="${escapeAttr(file.path)}">
        <img src="${file.mediaUrl}" alt="">
      </a>
    `).join("");
  }

  const file = group.cover;
  if (!file) return `<div class="cover-placeholder">EMPTY</div>`;
  if (file.mediaType === "video") {
    return `<video controls src="${file.mediaUrl}"></video>`;
  }
  if (file.mediaType === "audio") {
    return `<div class="cover-placeholder">AUDIO</div><audio controls src="${file.mediaUrl}"></audio>`;
  }
  return `<a class="cover-placeholder" href="${file.mediaUrl}" target="_blank" rel="noreferrer">FILE</a>`;
  return `<a class="cover-placeholder" href="${file.mediaUrl}" target="_blank" rel="noreferrer">FILE</a>`;
}

function renderAlbumItem(file) {
  const previewLink = file.mediaType === "image"
    ? `<a href="${file.mediaUrl}" data-view-image="${escapeAttr(file.path)}">${renderAlbumPreview(file)}</a>`
    : `<a href="${file.mediaUrl}" target="_blank" rel="noreferrer">${renderAlbumPreview(file)}</a>`;

  return `
    <figure class="album-item">
      ${previewLink}
      <figcaption>
        <span>${escapeHtml(file.name)}</span>
        <small>${formatBytes(file.size)}</small>
        <button class="danger-link" type="button" data-delete-path="${escapeAttr(file.path)}" data-delete-name="${escapeAttr(file.name)}">删除</button>
      </figcaption>
    </figure>
  `;
}

function renderAlbumPreview(file) {
  if (file.mediaType === "image") return `<img src="${file.mediaUrl}" alt="">`;
  if (file.mediaType === "video") return `<video src="${file.mediaUrl}" muted></video>`;
  if (file.mediaType === "audio") return `<div class="album-placeholder">AUDIO</div>`;
  return `<div class="album-placeholder">FILE</div>`;
}

async function handleLibraryClick(event) {
  const imageLink = event.target.closest("[data-view-image]");
  if (imageLink) {
    event.preventDefault();
    showLightbox(imageLink.dataset.viewImage);
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
    alert(data.error || "删除失败");
    button.disabled = false;
    button.textContent = button.classList.contains("danger-button") ? "删除相册" : "删除";
    return;
  }

  await loadDownloads();
}

function showLightbox(path) {
  currentImages = currentGroups.flatMap((group) => group.files.filter((file) => file.mediaType === "image"));
  currentImageIndex = Math.max(0, currentImages.findIndex((file) => file.path === path));
  renderLightbox();
  lightbox.hidden = false;
}

function renderLightbox() {
  const image = currentImages[currentImageIndex];
  if (!image) return;

  lightboxImage.src = image.mediaUrl;
  lightboxCaption.textContent = `${image.name} · ${currentImageIndex + 1} / ${currentImages.length}`;
}

function moveLightbox(delta) {
  if (!currentImages.length) return;
  currentImageIndex = (currentImageIndex + delta + currentImages.length) % currentImages.length;
  renderLightbox();
}

function hideLightbox() {
  lightbox.hidden = true;
  lightboxImage.removeAttribute("src");
}

function siteLabel(site) {
  return {
    bilibili: "Bilibili",
    youtube: "YouTube",
    pixiv: "Pixiv",
  }[site] || site;
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

loadDownloads();
