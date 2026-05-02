import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { galleryDlConfigPath } from "../oauthStore.js";
import { safeSegment } from "../pathUtils.js";

const execFileAsync = promisify(execFile);

export const pixivProvider = {
  id: "pixiv",
  name: "Pixiv",
  description: "下载 Pixiv 当前页面匹配到的作品图片，适合插画、漫画、用户页等 gallery-dl 支持的页面。",

  matches(url) {
    return /(^|\.)pixiv\.net$/i.test(url.hostname);
  },

  describe(rawUrl) {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      url: rawUrl,
      formats: [
        { id: "images", label: "下载当前页面图片", detail: "使用 gallery-dl 保存该页面可解析的所有图片" },
      ],
      defaultFormat: "images",
      requirements: ["gallery-dl"],
      auth: {
        type: "pixiv-oauth",
        label: "Pixiv 授权",
        description: "首次下载 Pixiv 需要登录授权。授权成功后，gallery-dl 会保存 refresh token，后续下载会自动复用。",
      },
    };
  },

  async createDownloadPlan({ jobId, url, outputDir }) {
    const siteDir = path.join(outputDir, "pixiv");
    const metadata = await readPixivMetadata(url).catch(() => null);
    const shortJobId = jobId.split("-")[0];
    const taskName = safeSegment(
      [
        metadata?.title || metadata?.id || "pixiv-task",
        shortJobId,
      ].filter(Boolean).join(" "),
      `pixiv-task ${shortJobId}`,
    );
    const taskDir = path.join(siteDir, taskName);

    return {
      command: "gallery-dl",
      args: [
        "--config",
        galleryDlConfigPath(),
        "--directory",
        taskDir,
        "--filename",
        "{filename}.{extension}",
        url,
      ],
      cwd: taskDir,
      expectedOutput: taskDir,
    };
  },
};

async function readPixivMetadata(url) {
  const { stdout } = await execFileAsync("gallery-dl", [
    "--config",
    galleryDlConfigPath(),
    "--dump-json",
    url,
  ], {
    maxBuffer: 5 * 1024 * 1024,
  });
  const entries = JSON.parse(stdout);
  const directoryEntry = entries.find((entry) => entry[0] === 2 && entry[1]);
  return directoryEntry?.[1] || null;
}
