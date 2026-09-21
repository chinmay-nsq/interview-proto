import { Router } from "express";
import { randomUUID } from "crypto";
import { createJobDescription, getJobDescription, listJobDescriptions } from "../store/redisStore.js";
import { JobDescription } from "../types/index.js";

export const jobDescriptionsRouter = Router();

jobDescriptionsRouter.get("/", async (_req, res) => {
  res.json(await listJobDescriptions());
});

jobDescriptionsRouter.get("/:id", async (req, res) => {
  const jd = await getJobDescription(req.params.id);
  if (!jd) {
    res.status(404).json({ error: "Job description not found" });
    return;
  }
  res.json(jd);
});

jobDescriptionsRouter.post("/", async (req, res) => {
  const { title, company, seniority, description, mustHaveSkills } = req.body ?? {};

  if (
    typeof title !== "string" ||
    typeof company !== "string" ||
    typeof seniority !== "string" ||
    typeof description !== "string" ||
    !Array.isArray(mustHaveSkills) ||
    !mustHaveSkills.every((s) => typeof s === "string")
  ) {
    res.status(400).json({
      error: "title, company, seniority, description must be strings; mustHaveSkills must be a string array",
    });
    return;
  }

  const jd: JobDescription = {
    id: randomUUID(),
    title,
    company,
    seniority,
    description,
    mustHaveSkills,
  };

  await createJobDescription(jd);
  res.status(201).json(jd);
});
