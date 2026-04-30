import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { appendJobOutput, getJob, updateJob } from "./jobStore.js";

const downloadsDir = path.resolve("downloads");

export function startDownload(job, provider, request) {
  queueMicrotask(() => {
    const plan = provider.createDownloadPlan({
      url: request.url,
      format: request.format,
      outputDir: downloadsDir,
    });

    mkdirSync(plan.cwd || downloadsDir, { recursive: true });
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
        updateJob(job.id, {
          status: "failed",
          error: `${plan.command} exited with code ${code}.`,
        });
      }
    });
  });
}

function quoteArg(arg) {
  return /\s/.test(arg) ? JSON.stringify(arg) : arg;
}

function buildToolError(command, error) {
  if (error.code === "ENOENT") {
    return `未找到 ${command}。请先安装它，例如：pipx install ${command} 或 brew install ${command}`;
  }

  return error.message;
}
