import type {
  CartesiaTokenResponse,
  DeepgramTokenResponse,
  InterviewSession,
  JobDescription,
  StartInterviewResponse,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? `Request to ${path} failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  getJDs: () => request<JobDescription[]>("/api/jds"),

  createJD: (jd: Omit<JobDescription, "id">) =>
    request<JobDescription>("/api/jds", {
      method: "POST",
      body: JSON.stringify(jd),
    }),

  startInterview: (jdId: string) =>
    request<StartInterviewResponse>("/api/interviews", {
      method: "POST",
      body: JSON.stringify({ jdId }),
    }),

  getInterview: (interviewId: string) =>
    request<InterviewSession>(`/api/interviews/${interviewId}`),

  getDeepgramToken: () => request<DeepgramTokenResponse>("/api/tokens/deepgram"),

  getCartesiaToken: () => request<CartesiaTokenResponse>("/api/tokens/cartesia"),
};
