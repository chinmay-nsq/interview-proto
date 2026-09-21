import OpenAI from "openai";
import { env } from "../config/env.js";
import type { JobDescription } from "../types/index.js";

const client = new OpenAI({ apiKey: env.openaiApiKey });

// Ported verbatim from ConvAI-BackEnd/models/interview_questions_flow.py (lines 42-61).
const QUESTION_GENERATION_SYSTEM_PROMPT = `You are an interviewer generating short, concept-based interview questions.

Generate exactly one question per topic. Each question must be verbally askable and strictly relevant to its subtopic while matching the expected experience level questions must focus on ground-level understanding of the concept.

OUTPUT FORMAT:
Return ONLY a JSON array of arrays (no markdown, no extra text):
[
  ["q for skill1 topic1", "q for skill1 topic2"],
  ["q for skill2 topic1"]
]

STRUCTURE RULES:
- The outer array index must match the corresponding skill index from the input, and each inner array length must exactly match the number of topics for that skill.
`;

function buildUserPrompt(jobRole: string, experienceYears: number, skillLines: string): string {
  return `Job Role: ${jobRole}\nExperience: ${experienceYears} years\n\nSkills and Topics:\n${skillLines}`;
}

// The reference prompt expects `experience_years` as a number; this prototype's
// JobDescription only has a free-text `seniority` label — map it to a rough default.
const EXPERIENCE_YEARS_BY_SENIORITY: Record<string, number> = {
  junior: 1,
  "junior-mid": 2,
  "mid-level": 3,
  mid: 3,
  senior: 6,
  staff: 9,
  principal: 12,
};

function experienceYearsFor(seniority: string): number {
  return EXPERIENCE_YEARS_BY_SENIORITY[seniority.trim().toLowerCase()] ?? 3;
}

/**
 * Generates one question per must-have skill.
 * The reference prompt operates on skill -> topics; this prototype's JobDescription
 * has flat skill names only, so each skill is passed as its own single topic
 * (keeping the prompt text byte-identical to the reference).
 */
export async function generateQuestions(jd: JobDescription): Promise<string[]> {
  const skills = jd.mustHaveSkills;
  if (skills.length === 0) {
    throw new Error("Job description has no must-have skills to generate questions from");
  }

  const skillLines = skills
    .map((skill, i) => `${i + 1}. ${skill} [1 topics]:\n   - Topic 1: ${skill}`)
    .join("\n");

  const userPrompt = buildUserPrompt(jd.title, experienceYearsFor(jd.seniority), skillLines);

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.7,
    messages: [
      { role: "system", content: QUESTION_GENERATION_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = response.choices[0].message.content ?? "";
  const cleaned = raw.trim().replace(/```json/g, "").replace(/```/g, "").trim();

  let result: unknown;
  try {
    result = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Question generation returned invalid JSON: ${(err as Error).message}`);
  }

  if (!Array.isArray(result) || result.length !== skills.length) {
    throw new Error(
      `Question generation returned ${Array.isArray(result) ? result.length : typeof result} arrays, expected ${skills.length}`
    );
  }

  return (result as string[][]).map(
    (topicQuestions, i) => topicQuestions[0] ?? `Tell me about your experience with ${skills[i]}.`
  );
}
