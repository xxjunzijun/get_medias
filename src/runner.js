import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { appendJobOutput, getJob, updateJob } from "./jobStore.js";

const downloadsDir = path.resolve("downloads");
const metadataFilename = ".get-medias.json";

export function startDownload(job, provider, request) {
  queueMicrotask(async () => {
    let plan;
    try {
      const targetDir = request.targetPath
        ? resolveTargetDir(request.targetPath)
        : null;
      plan = await provider.createDownloadPlan({
        jobId: job.id,
        url: request.url,
        format: request.format,
        outputDir: downloadsDir,
        targetDir,
      });
    } catch (error) {
      updateJob(job.id, {
        status: "failed",
        error: error.message,
      });
      return;
    }

    mkdirSync(plan.cwd || downloadsDir, { recursive: true });
    writeTaskMetadata(plan, job, provider, request);
    updateJob(job.id, {
      status: "running",
      command: `${plan.command} ${plan.args.map(quoteArg).join(" ")}`,
      expectedOutput: plan.expectedOutput || "",
    });

    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd || process.cwd(),
      env: process.env,
    });

    child.stdout.on("data", (chunk) => appendJobOutput(job.id, chunk.toString()));
    child.stderr.on("data", (chunk) => appendJobOutput(job.id, chunk.toString()));
    child.on("error", (error) => {
      updateJob(job.id, {
        status: "failed",
        error: buildToolError(plan.command, error),
      });
    });
    child.on("close", (code) => {
      const latestJob = getJob(job.id);
      if (latestJob?.error) return;

      if (code === 0) {
        updateJob(job.id, { status: "completed" });
      } else {
        const outputTail = latestJob?.output ? `\n\n${latestJob.output.slice(-2000)}` : "";
        updateJob(job.id, {
          status: "failed",
          error: `${plan.command} exited with code ${code}.${outputTail}`,
        });
      }
    });
  });
}

function resolveTargetDir(targetPath) {
  const candidate = path.resolve(downloadsDir, String(targetPath));
  const relative = path.relative(downloadsDir, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid download target.");
  }
  return candidate;
}

function writeTaskMetadata(plan, job, provider, request) {
  const metadataPath = path.join(plan.cwd || downloadsDir, metadataFilename);
  const metadata = {
    jobId: job.id,
    provider: {
      id: provider.id,
      name: provider.name,
    },
    sourceUrl: request.url,
    format: request.format || "",
    title: plan.metadata?.title || "",
    sourceId: plan.metadata?.sourceId || "",
    createdAt: job.createdAt,
  };

  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
}

function quoteArg(arg) {
  return /\s/.test(arg) ? JSON.stringify(arg) : arg;
}

function buildToolError(command, error) {
  if (error.code === "ENOENT") {
    const configHint = command.includes("/")
      ? "请确认这个路径存在且有执行权限。"
      : "如果工具已安装在 ~/.local/bin，可在 systemd 里配置 GALLERY_DL_BIN 或 YT_DLP_BIN 为绝对路径。";
    return `未找到 ${command}。${configHint}`;
  }

  return error.message;
}
