import { env } from "../config/env.js";

export interface CartesiaAccessTokenResponse {
  token: string;
}

const CARTESIA_VERSION = "2025-11-04";

export async function mintCartesiaToken(expiresInSeconds = 60): Promise<CartesiaAccessTokenResponse> {
  const response = await fetch("https://api.cartesia.ai/access-token", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.cartesiaApiKey}`,
      "Cartesia-Version": CARTESIA_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grants: { tts: true },
      expires_in: expiresInSeconds,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Cartesia access-token request failed (${response.status}): ${errText}`);
  }

  return (await response.json()) as CartesiaAccessTokenResponse;
}
