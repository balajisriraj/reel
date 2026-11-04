import type { Asset, Job, Meta, Project, ProjectCard, Reference } from "./types";

// The API lives on the same origin in production and behind Vite's proxy in development. The render page is told
// where it is with ?api=.
let base = "";
export const setApiBase = (url: string) => (base = url.replace(/\/$/, ""));
export const fileUrl = (projectId: string, path: string) => `${base}/api/projects/${projectId}/files/${path}`;
export const assetUrl = (projectId: string, a: Asset) => fileUrl(projectId, `assets/${a.file}`);

export class ApiError extends Error {}

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers: Record<string, string> = {};
  let body = init?.body;
  if (init?.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${base}${path}`, { ...init, headers, body });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {}
    throw new ApiError(detail);
  }
  return res.json() as Promise<T>;
}

const upload = <T>(path: string, file: Blob, name = "file") => {
  const form = new FormData();
  form.append("file", file, (file as File).name ?? name);
  return call<T>(path, { method: "POST", body: form });
};

export const api = {
  meta: () => call<Meta>("/api/meta"),
  projects: () => call<ProjectCard[]>("/api/projects"),
  create: (sample = false) => call<Project>("/api/projects", { method: "POST", json: { sample } }),
  project: (id: string) => call<Project>(`/api/projects/${id}`),
  patch: (id: string, patch: Partial<Project>) => call<Project>(`/api/projects/${id}`, { method: "PATCH", json: patch }),
  remove: (id: string) => call<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),

  addReference: (id: string, url: string) => call<{ reference: Reference; job: string }>(`/api/projects/${id}/references`, { method: "POST", json: { url } }),
  uploadReference: (id: string, file: File) => upload<{ reference: Reference; job: string }>(`/api/projects/${id}/references/upload`, file),
  removeReference: (id: string, ref: string) => call<Project>(`/api/projects/${id}/references/${ref}`, { method: "DELETE" }),

  uploadAsset: (id: string, file: File) => upload<Asset>(`/api/projects/${id}/assets`, file),
  patchAsset: (id: string, asset: string, patch: { name?: string; note?: string }) => call<Asset>(`/api/projects/${id}/assets/${asset}`, { method: "PATCH", json: patch }),
  removeAsset: (id: string, asset: string) => call<Project>(`/api/projects/${id}/assets/${asset}`, { method: "DELETE" }),
  capture: (id: string, url: string, mobile: boolean) => call<{ job: string }>(`/api/projects/${id}/capture`, { method: "POST", json: { url, mobile } }),
  recordVoice: (id: string, scene: string, take: Blob) => upload<Project>(`/api/projects/${id}/voice/${scene}`, take, "take.webm"),

  write: (id: string, style: { avg_shot: number; energy: number; mood: string[] }) =>
    call<{ project: Project; coverage: Record<string, number> }>(`/api/projects/${id}/script`, { method: "POST", json: { style } }),
  rewrite: (id: string, scene: string, instruction: string) =>
    call<{ narration: string; title: string; sub: string }>(`/api/projects/${id}/scenes/${scene}/rewrite`, { method: "POST", json: { instruction } }),
  suggestMessages: (id: string) => call<{ messages: string[] }>(`/api/projects/${id}/messages/suggest`, { method: "POST" }),

  render: (id: string, quality: "draft" | "final") => call<{ job: string }>(`/api/projects/${id}/render`, { method: "POST", json: { quality } }),
  removeRender: (id: string, render: string) => call<Project>(`/api/projects/${id}/renders/${render}`, { method: "DELETE" }),
  job: (id: string) => call<Job>(`/api/jobs/${id}`),
  jobs: (id: string) => call<Job[]>(`/api/projects/${id}/jobs`),
};

/** Poll a job until it finishes, reporting progress. */
export async function follow(jobId: string, onProgress: (j: Job) => void, every = 700): Promise<Job> {
  for (;;) {
    const j = await api.job(jobId);
    onProgress(j);
    if (j.status !== "running") return j;
    await new Promise((r) => setTimeout(r, every));
  }
}
