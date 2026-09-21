import { env } from "../config/env.js";

export interface DeepgramTokenResponse {
  access_token: string;
  expires_in: number;
}

export async function mintDeepgramToken(): Promise<DeepgramTokenResponse> {
  const response = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: {
      // Deepgram uses its own "Token" auth scheme, not "Bearer".
      Authorization: `Token ${env.deepgramApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Deepgram auth/grant request failed (${response.status}): ${errText}`);
  }

  return (await response.json()) as DeepgramTokenResponse;
}
