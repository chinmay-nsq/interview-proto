import { Router } from "express";
import { mintDeepgramToken } from "../services/deepgramToken.js";
import { mintCartesiaToken } from "../services/cartesiaToken.js";

export const tokensRouter = Router();

tokensRouter.get("/deepgram", async (_req, res) => {
  try {
    const token = await mintDeepgramToken();
    res.json(token);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

tokensRouter.get("/cartesia", async (_req, res) => {
  try {
    const token = await mintCartesiaToken(60);
    res.json(token);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});
