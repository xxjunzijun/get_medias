import path from "node:path";

export const bilibiliProvider = {
  id: "bilibili",
  name: "Bilibili",
  description: "支持 B 站视频下载，可选择 MP4 视频或 MP3 音频。",

  matches(url) {
    return /(^|\.)bilibili\.com$/i.test(url.hostname) || /(^|\.)b23\.tv$/i.test(url.hostname);
  },

  describe(rawUrl) {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      url: rawUrl,
      formats: [
        { id: "mp4", label: "下载视频 MP4", detail: "使用 yt-dlp 合并最佳视频和音频" },
        { id: "mp3", label: "仅下载音频 MP3", detail: "使用 yt-dlp 提取音频并转换为 MP3" },
      ],
      defaultFormat: "mp4",
      requirements: ["yt-dlp", "ffmpeg"],
    };
  },

  createDownloadPlan({ url, format, outputDir }) {
    const siteDir = path.join(outputDir, "bilibili");
    const outputTemplate = path.join(siteDir, "%(title).180B [%(id)s].%(ext)s");
    const args = [
      "--newline",
      "--no-playlist",
      "-o",
      outputTemplate,
    ];

    if (format === "mp3") {
      args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
    } else {
      args.push("-f", "bv*+ba/b", "--merge-output-format", "mp4");
    }

    args.push(url);
    return {
      command: "yt-dlp",
      args,
      cwd: siteDir,
      expectedOutput: siteDir,
    };
  },
};
