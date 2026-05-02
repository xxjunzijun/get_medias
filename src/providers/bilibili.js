import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { safeSegment } from "../pathUtils.js";

const execFileAsync = promisify(execFile);

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

  async createDownloadPlan({ jobId, url, format, outputDir }) {
    const siteDir = path.join(outputDir, "bilibili");
    const metadata = await readYtDlpMetadata(url).catch(() => null);
    const shortJobId = jobId.split("-")[0];
    const taskTitle = metadata?.title && metadata?.id
      ? `${metadata.title} [${metadata.id}]`
      : metadata?.title || metadata?.id || "bilibili-task";
    const taskDir = path.join(siteDir, safeSegment(`${taskTitle} ${shortJobId}`, `bilibili-task ${shortJobId}`));
    const outputTemplate = path.join(taskDir, "%(title).180B [%(id)s].%(ext)s");
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
      cwd: taskDir,
      expectedOutput: taskDir,
      metadata: {
        title: metadata?.title || "",
        sourceId: metadata?.id || "",
      },
    };
  },
};

async function readYtDlpMetadata(url) {
  const { stdout } = await execFileAsync("yt-dlp", [
    "--dump-single-json",
    "--no-playlist",
    "--skip-download",
    url,
  ], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}
