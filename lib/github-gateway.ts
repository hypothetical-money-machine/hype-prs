"use client";

import type {
  ConnectionStatus,
  GitHubBridge,
  InboxPayload,
  PullRequestDiff,
  SubmitReviewInput,
} from "./types";

export function gateway(): GitHubBridge {
  return webGateway;
}

export function beginWebConnection(): void {
  if (typeof window !== "undefined") {
    window.location.assign("/api/github/auth/start");
  }
}

const webGateway: GitHubBridge = {
  async connectionStatus(): Promise<ConnectionStatus> {
    return requestJson<ConnectionStatus>("/api/github/status");
  },

  async disconnect(): Promise<void> {
    await requestJson("/api/github/disconnect", { method: "POST" });
  },

  async getInbox(): Promise<InboxPayload> {
    return requestJson<InboxPayload>("/api/github/inbox");
  },

  async getPullDiff(input, signal): Promise<PullRequestDiff> {
    const search = new URLSearchParams({
      number: String(input.number),
      owner: input.owner,
      repository: input.repository,
    });
    return requestJson<PullRequestDiff>(`/api/github/diff?${search}`, {
      signal,
    });
  },

  async openExternal(url: string): Promise<void> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
      throw new Error("Only GitHub links can be opened.");
    }
    window.open(parsed.toString(), "_blank", "noopener,noreferrer");
  },

  async submitReview(input: SubmitReviewInput) {
    return requestJson<{ submittedAt: string }>("/api/github/review", {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  },
};

async function requestJson<T = void>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...init?.headers,
    },
  });

  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ?? `Request failed (${response.status}).`,
    );
  }
  return payload as T;
}
