import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { safeSegment } from "../pathUtils.js";
import { youtubeCookiesFile, ytDlpBin, ytDlpJsRuntime } from "../toolBins.js";

const execFileAsync = promisify(execFile);

export const youtubeProvider = {
  id: "youtube",
  name: "YouTube",
  description: "支持 YouTube 视频下载，可保存为 MP4 或提取 MP3。",

  matches(url) {
    return /(^|\.)youtube\.com$/i.test(url.hostname) || /(^|\.)youtu\.be$/i.test(url.hostname);
  },

  describe(rawUrl) {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      url: rawUrl,
      formats: [
        { id: "mp4", label: "下载视频 MP4", detail: "下载最佳画质并合并为 MP4" },
        { id: "mp3", label: "仅下载音频 MP3", detail: "提取音频并转换为 MP3" },
      ],
      defaultFormat: "mp4",
      requirements: ["yt-dlp", "ffmpeg"],
    };
  },

  async createDownloadPlan({ jobId, url, format, outputDir }) {
    const siteDir = path.join(outputDir, "youtube");
    const metadata = await readYtDlpMetadata(url).catch(() => null);
    const shortJobId = jobId.split("-")[0];
    const taskTitle = metadata?.title && metadata?.id
      ? `${metadata.title} [${metadata.id}]`
      : metadata?.title || metadata?.id || "youtube-task";
    const taskDir = path.join(siteDir, safeSegment(`${taskTitle} ${shortJobId}`, `youtube-task ${shortJobId}`));
    const outputTemplate = path.join(taskDir, "%(title).180B [%(id)s].%(ext)s");
    const args = [
      "--newline",
      "--no-playlist",
      ...youtubeAuthArgs(),
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
      command: ytDlpBin(),
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
  const { stdout } = await execFileAsync(ytDlpBin(), [
    "--dump-single-json",
    "--no-playlist",
    ...youtubeAuthArgs(),
    "--skip-download",
    url,
  ], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function youtubeAuthArgs() {
  const args = [];
  const cookiesFile = youtubeCookiesFile();
  const jsRuntime = ytDlpJsRuntime();

  if (cookiesFile) {
    args.push("--cookies", cookiesFile);
  }

  if (jsRuntime) {
    args.push("--js-runtimes", jsRuntime);
  }

  return args;
}
