const jobs = new Map();

export function createJob(provider, request) {
  const now = new Date().toISOString();
  const job = {
    id: crypto.randomUUID(),
    provider,
    request,
    status: "queued",
    output: "",
    error: "",
    command: "",
    createdAt: now,
    updatedAt: now,
  };

  jobs.set(job.id, job);
  return job;
}

export function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;

  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  return job;
}

export function appendJobOutput(id, chunk) {
  const job = jobs.get(id);
  if (!job) return null;

  job.output = `${job.output}${chunk}`.slice(-20000);
  job.updatedAt = new Date().toISOString();
  return job;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

export function listJobs() {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
