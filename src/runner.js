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
      plan = await provider.createDownloadPlan({
        jobId: job.id,
        url: request.url,
        format: request.format,
        outputDir: downloadsDir,
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
    return `未找到 ${command}。请先安装它，例如：pipx install ${command} 或 brew install ${command}`;
  }

  return error.message;
}
