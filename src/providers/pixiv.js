import path from "node:path";

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
    };
  },

  createDownloadPlan({ url, outputDir }) {
    const siteDir = path.join(outputDir, "pixiv");
    return {
      command: "gallery-dl",
      args: [
        "--directory",
        siteDir,
        url,
      ],
      cwd: siteDir,
      expectedOutput: siteDir,
    };
  },
};
