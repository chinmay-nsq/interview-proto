import { getFollowUpDecision } from "./followUpBrain.js";
import { publishTurn } from "./mqtt.js";
import { getInterview, getJobDescription, setInterview } from "../store/redisStore.js";
import type { FollowUpDecision, TurnMessage } from "../types/index.js";

const PLACEHOLDER_RE = /\{\{?NEXT_QUESTION_PLACEHOLDER\}?\}/;

/**
 * Splits a CLOSE_AND_TRANSITION/SKIP_SKILL response into the spoken reaction
 * (transition prose, no question text) and the full transcript line with the
 * real next question spliced in place of {{NEXT_QUESTION_PLACEHOLDER}}.
 */
function splicePlaceholder(text: string, nextQuestion: string): { reactionOnly: string; full: string } {
  if (PLACEHOLDER_RE.test(text)) {
    return {
      reactionOnly: text.replace(PLACEHOLDER_RE, "").trim(),
      full: text.replace(PLACEHOLDER_RE, nextQuestion),
    };
  }
  return { reactionOnly: text.trim(), full: `${text}\n${nextQuestion}` };
}

export async function handleAnswerMessage(interviewId: string, answerText: string): Promise<void> {
  const session = await getInterview(interviewId);
  if (!session || session.status === "completed") {
    console.warn(`[interviewTurnHandler] dropping answer for unknown/completed interview ${interviewId}`);
    return;
  }

  const jd = await getJobDescription(session.jdId);
  if (!jd) {
    console.error(`[interviewTurnHandler] job description missing for interview ${interviewId}`);
    return;
  }

  const currentQuestion = session.coreQuestions[session.currentQuestionIndex];
  const nextTempQuestion = session.coreQuestions[session.currentQuestionIndex + 1] ?? null;

  session.transcript.push({ role: "candidate", text: answerText });

  let decision: FollowUpDecision;
  try {
    decision = await getFollowUpDecision({
      currentQuestion,
      answer: answerText,
      consecutiveGptCount: session.consecutiveGptCount,
      maxConsecutiveGpt: session.maxConsecutiveGpt,
      offTopicStreak: session.offTopicStreak,
      clarificationStreak: session.clarificationStreak,
      nextTempQuestion,
      originalContentQuestion: session.originalContentQuestion ?? currentQuestion,
    });
  } catch (err) {
    console.error(`[interviewTurnHandler] follow-up brain failed for ${interviewId}`, err);
    await setInterview(session);
    publishTurn(interviewId, {
      reaction: "Sorry, I had trouble processing that — could you say that again?",
      nextQuestion: currentQuestion,
      status: session.status,
    });
    return;
  }

  let action = decision.action;
  // No skill/subtopic/familiarity-check state is tracked in this prototype, so these
  // two actions (which require that state) are never valid here — guard mirrors
  // ConvAI-BackEnd/models/follow_up_handler.py lines 98-113.
  if (action === "SKILL_FAMILIARITY_CHECK" || action === "SKIP_SKILL") {
    action = "CLOSE_AND_TRANSITION";
    decision = {
      ...decision,
      question: "Let's move on to the next question. {{NEXT_QUESTION_PLACEHOLDER}}",
      questionClean: "Let's move on to the next question.",
    };
  }

  session.offTopicStreak = decision.answerType === "off_topic" ? session.offTopicStreak + 1 : 0;
  session.clarificationStreak = decision.answerType === "clarification_request" ? session.clarificationStreak + 1 : 0;

  if (action === "CONTINUE_FOLLOW_UP") {
    if (decision.answerType !== "clarification_request") {
      session.consecutiveGptCount += 1;
      session.originalContentQuestion = undefined;
    }
    session.transcript.push({ role: "interviewer", text: decision.questionClean, isFollowUp: true });
    await setInterview(session);
    publishTurn(interviewId, { reaction: "", nextQuestion: decision.questionClean, status: session.status });
    return;
  }

  // CLOSE_AND_TRANSITION or DIRECT_NEXT — both advance to the next core question.
  if (nextTempQuestion === null) {
    session.status = "completed";
    const closing =
      action === "CLOSE_AND_TRANSITION"
        ? splicePlaceholder(decision.question, "").reactionOnly
        : decision.questionClean;
    const closingText = closing || "That wraps up our interview. Well done!";
    session.transcript.push({ role: "interviewer", text: closingText });
    await setInterview(session);
    const turn: TurnMessage = { reaction: closingText, nextQuestion: undefined, status: "completed" };
    publishTurn(interviewId, turn);
    return;
  }

  const isTransition = action === "CLOSE_AND_TRANSITION";
  const spliced = isTransition ? splicePlaceholder(decision.question, nextTempQuestion) : null;
  const reaction = spliced?.reactionOnly ?? "";
  const transcriptText = spliced?.full ?? nextTempQuestion;

  session.currentQuestionIndex += 1;
  session.consecutiveGptCount = 0;
  session.offTopicStreak = 0;
  session.clarificationStreak = 0;
  session.originalContentQuestion = nextTempQuestion;
  session.transcript.push({ role: "interviewer", text: transcriptText });
  await setInterview(session);

  publishTurn(interviewId, { reaction, nextQuestion: nextTempQuestion, status: session.status });
}
