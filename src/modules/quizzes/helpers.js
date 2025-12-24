function uuid() {
  return (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// ✅ Keep same kid ids as Rewards
export const KIDS = [
  { id: "harvey", name: "Harvey" },
  { id: "brady", name: "Brady" },
];

// 🔐 Parent password for quizzes admin dashboard
// (Change here)
const DEFAULT_PARENT_PASSWORD = "1234";

export function defaultQuizzesData() {
  return {
    version: 1,
    bank: [],        // imported quizzes
    assignments: [], // { id, quizId, kidId, assignedAt, status: "assigned"|"completed" }
    attempts: [],    // attempt history
    parent: { unlockedUntil: 0 },
  };
}

export function getQuizzesData(ctx) {
  const existing = ctx.store.get();
  const data = (!existing || existing.version !== 1) ? defaultQuizzesData() : existing;
  data.bank ||= [];
  data.assignments ||= [];
  data.attempts ||= [];
  data.parent ||= { unlockedUntil: 0 };
  return data;
}

export function saveQuizzesData(ctx, data) {
  ctx.store.set(data);
}

function now() {
  return Date.now();
}

export function isParentUnlocked(data) {
  return (data.parent?.unlockedUntil || 0) > now();
}

export function unlockParent(ctx, password, minutes = 10) {
  const data = getQuizzesData(ctx);
  if (String(password || "") !== DEFAULT_PARENT_PASSWORD) return false;
  data.parent.unlockedUntil = now() + minutes * 60 * 1000;
  saveQuizzesData(ctx, data);
  return true;
}

export function lockParent(ctx) {
  const data = getQuizzesData(ctx);
  data.parent.unlockedUntil = 0;
  saveQuizzesData(ctx, data);
}

// -------- XML IMPORT --------

function textOf(el, selector) {
  const node = el.querySelector(selector);
  return node ? node.textContent.trim() : "";
}

function boolOf(el, selector, fallback = false) {
  const t = textOf(el, selector);
  if (!t) return fallback;
  return String(t).toLowerCase() === "true";
}

function intOf(el, selector, fallback = null) {
  const t = textOf(el, selector);
  if (!t) return fallback;
  const n = Number(t);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

/**
 * Parses the XML quiz format you posted.
 * Returns { ok:true, quiz } or { ok:false, error }
 */
export function parseQuizXml(xmlString) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "text/xml");

    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      return { ok: false, error: "Invalid XML (parser error)." };
    }

    const quizEl = doc.querySelector("quiz");
    if (!quizEl) return { ok: false, error: "Missing <quiz> root element." };

    const metaEl = quizEl.querySelector("meta");
    if (!metaEl) return { ok: false, error: "Missing <meta>." };

    const title = textOf(metaEl, "title");
    if (!title) return { ok: false, error: "Missing <title> in <meta>." };

    const description = textOf(metaEl, "description") || "";
    const passPercent = intOf(metaEl, "passPercent", 80);
    if (passPercent == null) return { ok: false, error: "Missing/invalid <passPercent>." };

    const timeLimitSeconds = intOf(metaEl, "timeLimitSeconds", null);

    const rewardEl = metaEl.querySelector("reward");
    if (!rewardEl) return { ok: false, error: "Missing <reward> in <meta>." };

    const rewardType = rewardEl.getAttribute("type");
    if (rewardType !== "minutes" && rewardType !== "points") {
      return { ok: false, error: 'Reward type must be "minutes" or "points".' };
    }
    const rewardValue = Math.max(0, Math.floor(Number(rewardEl.textContent || "0")));
    if (rewardValue <= 0) return { ok: false, error: "Reward value must be > 0." };

    const shuffleQuestions = boolOf(metaEl, "shuffleQuestions", false);
    const shuffleAnswers = boolOf(metaEl, "shuffleAnswers", false);

    const questionsEl = quizEl.querySelector("questions");
    if (!questionsEl) return { ok: false, error: "Missing <questions>." };

    const questionNodes = Array.from(questionsEl.querySelectorAll("question"));
    if (questionNodes.length === 0) return { ok: false, error: "No <question> elements found." };

    const questions = questionNodes.map((qEl, idx) => {
      const qid = qEl.getAttribute("id") || `q${idx + 1}`;
      const prompt = textOf(qEl, "prompt");
      if (!prompt) throw new Error(`Question ${qid} missing <prompt>.`);

      const choices = Array.from(qEl.querySelectorAll("choices > choice")).map((c) =>
        (c.textContent || "").trim()
      );
      if (choices.length < 2) throw new Error(`Question ${qid} needs at least 2 choices.`);

      const ansEl = qEl.querySelector("answer");
      if (!ansEl) throw new Error(`Question ${qid} missing <answer correctIndex="..."/>`);

      const correctIndexAttr = ansEl.getAttribute("correctIndex");
      const correctIndex = Number(correctIndexAttr);
      if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= choices.length) {
        throw new Error(`Question ${qid} invalid correctIndex.`);
      }

      const explanation = textOf(qEl, "explanation") || "";

      return { id: qid, prompt, choices, correctIndex, explanation };
    });

    const idFromXml = quizEl.getAttribute("id");
    const quiz = {
      id: idFromXml || uuid(),
      title,
      description,
      passPercent,
      timeLimitSeconds, // null => untimed
      reward: { currency: rewardType, amount: rewardValue },
      shuffleQuestions,
      shuffleAnswers,
      createdAt: new Date().toISOString(),
      questions,
    };

    return { ok: true, quiz };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// -------- ASSIGNMENTS / ATTEMPTS --------

export function assignQuizToKids(ctx, quizId, kidIds) {
  const data = getQuizzesData(ctx);
  const nowIso = new Date().toISOString();

  for (const kidId of kidIds) {
    if (!["harvey", "brady"].includes(kidId)) continue;

    // if already assigned, keep one assignment record; just set status assigned
    const existing = data.assignments.find(a => a.quizId === quizId && a.kidId === kidId);
    if (existing) {
      existing.status = "assigned";
      continue;
    }

    data.assignments.push({
      id: uuid(),
      quizId,
      kidId,
      assignedAt: nowIso,
      status: "assigned",
    });
  }

  saveQuizzesData(ctx, data);
}

export function resetQuizForKid(ctx, quizId, kidId) {
  const data = getQuizzesData(ctx);
  const a = data.assignments.find(x => x.quizId === quizId && x.kidId === kidId);
  if (a) a.status = "assigned";
  saveQuizzesData(ctx, data);
}

export function isQuizAvailableForKid(ctx, quizId, kidId) {
  const data = getQuizzesData(ctx);
  const a = data.assignments.find(x => x.quizId === quizId && x.kidId === kidId);
  if (!a) return false;
  return a.status === "assigned"; // once completed -> blocked until parent resets
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Creates an attempt object + returns a "public quiz" without correctIndex.
 * NOTE: This is frontend-only. Correct answers remain in store for grading.
 */
export function startAttempt(ctx, quizId, kidId) {
  const data = getQuizzesData(ctx);

  if (!isQuizAvailableForKid(ctx, quizId, kidId)) {
    return { ok: false, error: "Quiz not available (already taken or not assigned)." };
  }

  const quiz = data.bank.find(q => q.id === quizId);
  if (!quiz) return { ok: false, error: "Quiz not found." };

  const attemptId = uuid();
  const startedAt = new Date().toISOString();

  // build question order + optional answer shuffle mapping
  let questions = quiz.questions.map(q => ({ ...q }));

  if (quiz.shuffleQuestions) {
    questions = shuffleArray(questions);
  }

  // For shuffled answers: store mapping so grading still works.
  // We transform each question choices and correctIndex accordingly.
  if (quiz.shuffleAnswers) {
    questions = questions.map((q) => {
      const indices = q.choices.map((_, i) => i);
      const shuffled = shuffleArray(indices);

      const newChoices = shuffled.map(i => q.choices[i]);
      const newCorrectIndex = shuffled.indexOf(q.correctIndex);

      return {
        ...q,
        choices: newChoices,
        correctIndex: newCorrectIndex,
      };
    });
  }

  // Save attempt shell
  data.attempts.push({
    id: attemptId,
    quizId,
    kidId,
    startedAt,
    submittedAt: null,
    durationSeconds: null,
    scorePercent: null,
    passed: null,
    awarded: false,
    answers: {}, // { [questionId]: selectedIndex }
  });

  saveQuizzesData(ctx, data);

  // Public quiz (no correctIndex)
  const publicQuiz = {
    id: quiz.id,
    title: quiz.title,
    description: quiz.description,
    passPercent: quiz.passPercent,
    timeLimitSeconds: quiz.timeLimitSeconds,
    reward: quiz.reward,
    questions: questions.map(q => ({
      id: q.id,
      prompt: q.prompt,
      choices: q.choices,
      explanation: q.explanation || "",
      // correctIndex intentionally excluded
    })),
  };

  // But we need grading to use the transformed questions with correctIndex.
  // We'll return the transformed question set for internal use too.
  return { ok: true, attemptId, publicQuiz, gradingQuestions: questions };
}

export function submitAttempt(ctx, { attemptId, answers, gradingQuestions }) {
  const data = getQuizzesData(ctx);
  const attempt = data.attempts.find(a => a.id === attemptId);
  if (!attempt) return { ok: false, error: "Attempt not found." };
  if (attempt.submittedAt) return { ok: false, error: "Attempt already submitted." };

  const quiz = data.bank.find(q => q.id === attempt.quizId);
  if (!quiz) return { ok: false, error: "Quiz not found." };

  // Grade using gradingQuestions (which has correctIndex and any shuffles applied)
  const questions = gradingQuestions;
  const total = questions.length;

  let correct = 0;
  for (const q of questions) {
    const selected = answers?.[q.id];
    if (Number.isInteger(selected) && selected === q.correctIndex) correct++;
  }

  const scorePercent = Math.round((correct / total) * 100);
  const passed = scorePercent >= quiz.passPercent;

  attempt.answers = answers || {};
  attempt.submittedAt = new Date().toISOString();
  attempt.durationSeconds = Math.max(
    0,
    Math.floor((new Date(attempt.submittedAt).getTime() - new Date(attempt.startedAt).getTime()) / 1000)
  );
  attempt.scorePercent = scorePercent;
  attempt.passed = passed;

  // Mark assignment completed (take once)
  const assignment = data.assignments.find(a => a.quizId === quiz.id && a.kidId === attempt.kidId);
  if (assignment) assignment.status = "completed";

  saveQuizzesData(ctx, data);

  // Award via Rewards module (idempotent)
  if (passed && !attempt.awarded) {
    ctx.eventBus.emit("REWARDS/CREDIT", {
      kidId: attempt.kidId,
      currency: quiz.reward.currency,
      amount: quiz.reward.amount,
      sourceModule: "quizzes",
      sourceRef: `quizAttempt:${attempt.id}`,
      reason: `Passed quiz: ${quiz.title}`,
      metadata: { quizId: quiz.id, scorePercent },
    });

    // Mark awarded locally (even though Rewards is idempotent)
    const data2 = getQuizzesData(ctx);
    const attempt2 = data2.attempts.find(a => a.id === attempt.id);
    if (attempt2) attempt2.awarded = true;
    saveQuizzesData(ctx, data2);
  }

  return { ok: true, scorePercent, passed, reward: passed ? quiz.reward : null };
}
