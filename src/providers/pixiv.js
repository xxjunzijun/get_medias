import path from "node:path";

import { safeSegment } from "../pathUtils.js";

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

  createDownloadPlan({ jobId, url, outputDir }) {
    const siteDir = path.join(outputDir, "pixiv");
    const fallbackDir = safeSegment(jobId, "pixiv-task");
    const taskTemplate = "{title|id}";
    return {
      command: "gallery-dl",
      args: [
        "--destination",
        siteDir,
        "--directory",
        taskTemplate,
        "--filename",
        "{filename}.{extension}",
        url,
      ],
      cwd: siteDir,
      expectedOutput: path.join(siteDir, taskTemplate),
    };
  },
};
