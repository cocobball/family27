function uuid() {
  return globalThis.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// ✅ Keep same kid ids as Rewards
export const KIDS = [
  { id: "harvey", name: "Harvey" },
  { id: "brady", name: "Brady" },
];

// 🔐 Parent password for quizzes admin dashboard (change here)
const DEFAULT_PARENT_PASSWORD = "1234";

// Currency display helpers
export function currencyLabel(currency) {
  if (currency === "minutes") return "min";
  if (currency === "points") return "$";
  return currency;
}
export function rewardSummary(quiz) {
  const r = normalizeReward(quiz?.reward);
  if (r.kind === "choice") {
    const parts = [];
    if (r.minutesAmount > 0) parts.push(`${r.minutesAmount} min`);
    if (r.pointsAmount > 0) parts.push(`$${r.pointsAmount}`);
    return `Choice: ${parts.join(" or ") || "—"}`;
  }
  if (r.kind === "minutes") return `${r.minutesAmount || 0} min`;
  if (r.kind === "points") return `$${r.pointsAmount || 0}`;
  return "—";
}

// Reward model
// - kind: "minutes" | "points" | "choice"
// - minutesAmount, pointsAmount
export function normalizeReward(reward) {
  if (!reward || typeof reward !== "object") {
    return { kind: "minutes", minutesAmount: 0, pointsAmount: 0 };
  }

  // NEW shape
  if (reward.kind) {
    const kind = reward.kind;
    const minutesAmount = Math.max(0, Math.floor(Number(reward.minutesAmount || 0)));
    const pointsAmount = Math.max(0, Math.floor(Number(reward.pointsAmount || 0)));
    return { kind, minutesAmount, pointsAmount };
  }

  // OLD shape: { currency:"minutes"|"points", amount:int }
  if (reward.currency && reward.amount != null) {
    const amt = Math.max(0, Math.floor(Number(reward.amount || 0)));
    if (reward.currency === "minutes") return { kind: "minutes", minutesAmount: amt, pointsAmount: 0 };
    return { kind: "points", minutesAmount: 0, pointsAmount: amt };
  }

  return { kind: "minutes", minutesAmount: 0, pointsAmount: 0 };
}

export function makeReward(kind, minutesAmount, pointsAmount) {
  return {
    kind,
    minutesAmount: Math.max(0, Math.floor(Number(minutesAmount || 0))),
    pointsAmount: Math.max(0, Math.floor(Number(pointsAmount || 0))),
  };
}

export function defaultQuizzesData() {
  return {
    version: 2,
    bank: [],
    assignments: [],
    attempts: [],
    parent: { unlockedUntil: 0 },
  };
}

function migrateToV2(raw) {
  const base = defaultQuizzesData();
  if (!raw || typeof raw !== "object") return base;

  const data = { ...base, ...raw, version: 2 };
  data.bank ||= [];
  data.assignments ||= [];
  data.attempts ||= [];
  data.parent ||= { unlockedUntil: 0 };

  data.bank = data.bank.map((q) => {
    const nq = { ...q };
    nq.category = nq.category || "";
    nq.createdAt = nq.createdAt || new Date().toISOString();
    nq.updatedAt = nq.updatedAt || nq.createdAt;

    nq.reward = normalizeReward(nq.reward);

    nq.questions = Array.isArray(nq.questions) ? nq.questions : [];
    nq.questions = nq.questions.map((qq, idx) => ({
      id: qq.id || `q${idx + 1}`,
      prompt: qq.prompt || "",
      choices: Array.isArray(qq.choices) ? qq.choices : [],
      correctIndex: Number.isInteger(qq.correctIndex) ? qq.correctIndex : 0,
      explanation: qq.explanation || "",
    }));

    nq.passPercent = Number.isFinite(Number(nq.passPercent)) ? Math.floor(Number(nq.passPercent)) : 80;
    nq.timeLimitSeconds =
      nq.timeLimitSeconds == null || nq.timeLimitSeconds === ""
        ? null
        : Math.max(1, Math.floor(Number(nq.timeLimitSeconds)));

    nq.shuffleQuestions = !!nq.shuffleQuestions;
    nq.shuffleAnswers = !!nq.shuffleAnswers;

    return nq;
  });

  data.attempts = data.attempts.map((a) => {
    const na = { ...a };
    if (!na.rewardGranted) na.rewardGranted = null;
    if (!na.rewardType) na.rewardType = null;
    return na;
  });

  return data;
}

export function getQuizzesData(ctx) {
  const existing = ctx.store.get();
  return migrateToV2(existing);
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

// ---------------- XML IMPORT ----------------

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
 * Reward import rules:
 * <reward type="minutes">20</reward>
 * <reward type="points">40</reward>           (displayed as $)
 * <reward type="dollars">40</reward>          (alias -> points)
 * <reward type="choice" minutes="20" points="5" />
 * <reward type="choice" minutes="20" dollars="5" /> (alias -> points)
 */
function parseReward(metaEl) {
  const rewardEl = metaEl.querySelector("reward");
  if (!rewardEl) return { ok: false, error: "Missing <reward> in <meta>." };

  let type = (rewardEl.getAttribute("type") || "").toLowerCase().trim();
  if (type === "dollars") type = "points";
  if (type === "money") type = "points";

  if (type === "choice") {
    const mAttr = rewardEl.getAttribute("minutes");
    const pAttr = rewardEl.getAttribute("points") ?? rewardEl.getAttribute("dollars");
    const minutesAmount = Math.max(0, Math.floor(Number(mAttr || 0)));
    const pointsAmount = Math.max(0, Math.floor(Number(pAttr || 0)));
    if (minutesAmount <= 0 && pointsAmount <= 0) {
      return { ok: false, error: 'Choice reward needs minutes=".." and/or points="..".' };
    }
    return { ok: true, reward: makeReward("choice", minutesAmount, pointsAmount) };
  }

  if (type !== "minutes" && type !== "points") {
    return { ok: false, error: 'Reward type must be "minutes", "points" (or "dollars"), or "choice".' };
  }

  const rewardValue = Math.max(0, Math.floor(Number(rewardEl.textContent || "0")));
  if (rewardValue <= 0) return { ok: false, error: "Reward value must be > 0." };

  if (type === "minutes") return { ok: true, reward: makeReward("minutes", rewardValue, 0) };
  return { ok: true, reward: makeReward("points", 0, rewardValue) };
}

/**
 * Parse a single <quiz> element (internal).
 * Returns { ok:true, quiz } or { ok:false, error }
 */
function parseQuizElement(quizEl) {
  const metaEl = quizEl.querySelector("meta");
  if (!metaEl) return { ok: false, error: "Missing <meta>." };

  const title = textOf(metaEl, "title");
  if (!title) return { ok: false, error: "Missing <title> in <meta>." };

  const description = textOf(metaEl, "description") || "";
  const category = textOf(metaEl, "category") || "";

  const passPercent = intOf(metaEl, "passPercent", 80);
  if (passPercent == null) return { ok: false, error: "Missing/invalid <passPercent>." };

  const timeLimitSeconds = intOf(metaEl, "timeLimitSeconds", null);

  const rewardParsed = parseReward(metaEl);
  if (!rewardParsed.ok) return rewardParsed;

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

    const choices = Array.from(qEl.querySelectorAll("choices > choice")).map((c) => (c.textContent || "").trim());
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
    category,
    passPercent: Math.max(1, Math.min(100, passPercent)),
    timeLimitSeconds: timeLimitSeconds == null ? null : Math.max(1, Number(timeLimitSeconds)),
    reward: rewardParsed.reward,
    shuffleQuestions,
    shuffleAnswers,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    questions,
  };

  return { ok: true, quiz };
}

/**
 * ✅ BULK + SINGLE XML IMPORT
 *
 * Supported:
 *   <quiz>...</quiz>
 *   <quizzes>
 *     <quiz>...</quiz>
 *     <quiz>...</quiz>
 *   </quizzes>
 *
 * Returns:
 *   { ok:true, quizzes:[...] }  // one or many
 *   { ok:false, error }
 */
export function parseQuizXml(xmlString) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "text/xml");

    const parseError = doc.querySelector("parsererror");
    if (parseError) return { ok: false, error: "Invalid XML (parser error)." };

    const root = doc.documentElement;
    if (!root) return { ok: false, error: "Invalid XML (missing root element)." };

    // Case 1: single quiz root
    if (root.tagName === "quiz") {
      const one = parseQuizElement(root);
      if (!one.ok) return one;
      return { ok: true, quizzes: [one.quiz] };
    }

    // Case 2: bulk quizzes root
    if (root.tagName === "quizzes") {
      const quizNodes = Array.from(root.querySelectorAll(":scope > quiz"));
      if (quizNodes.length === 0) return { ok: false, error: "No <quiz> elements found inside <quizzes>." };

      const quizzes = [];
      for (let i = 0; i < quizNodes.length; i++) {
        const qEl = quizNodes[i];
        const res = parseQuizElement(qEl);
        if (!res.ok) {
          const id = qEl.getAttribute("id") || `#${i + 1}`;
          return { ok: false, error: `Quiz ${id}: ${res.error}` };
        }
        quizzes.push(res.quiz);
      }
      return { ok: true, quizzes };
    }

    return { ok: false, error: 'Root must be <quiz> or <quizzes>.' };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// ---------------- BANK CRUD (RESTORED for ParentDashboard) ----------------

export function upsertQuizInBank(ctx, quiz) {
  const data = getQuizzesData(ctx);
  const q = { ...quiz };

  // normalize
  q.category = q.category || "";
  q.reward = normalizeReward(q.reward);
  q.passPercent = Math.max(1, Math.min(100, Math.floor(Number(q.passPercent || 80))));
  q.timeLimitSeconds =
    q.timeLimitSeconds == null || q.timeLimitSeconds === ""
      ? null
      : Math.max(1, Math.floor(Number(q.timeLimitSeconds)));

  q.shuffleQuestions = !!q.shuffleQuestions;
  q.shuffleAnswers = !!q.shuffleAnswers;

  q.questions = Array.isArray(q.questions) ? q.questions : [];
  q.questions = q.questions.map((qq, idx) => ({
    id: qq.id || `q${idx + 1}`,
    prompt: String(qq.prompt || ""),
    choices: Array.isArray(qq.choices) ? qq.choices.map((c) => String(c)) : [],
    correctIndex: Number.isInteger(qq.correctIndex) ? qq.correctIndex : 0,
    explanation: String(qq.explanation || ""),
  }));

  const nowIso = new Date().toISOString();
  q.updatedAt = nowIso;
  if (!q.createdAt) q.createdAt = nowIso;

  const idx = data.bank.findIndex((x) => x.id === q.id);
  if (idx >= 0) data.bank[idx] = q;
  else data.bank.unshift(q);

  saveQuizzesData(ctx, data);
}

export function deleteQuizFromBank(ctx, quizId) {
  const data = getQuizzesData(ctx);
  data.bank = (data.bank || []).filter((q) => q.id !== quizId);
  data.assignments = (data.assignments || []).filter((a) => a.quizId !== quizId);
  // keep attempts for history
  saveQuizzesData(ctx, data);
}

// ---------------- ASSIGNMENTS / AVAILABILITY ----------------

export function assignQuizToKids(ctx, quizId, kidIds) {
  const data = getQuizzesData(ctx);
  const nowIso = new Date().toISOString();

  for (const kidId of kidIds) {
    if (!KIDS.some((k) => k.id === kidId)) continue;

    const existing = data.assignments.find((a) => a.quizId === quizId && a.kidId === kidId);
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
  const a = data.assignments.find((x) => x.quizId === quizId && x.kidId === kidId);
  if (a) a.status = "assigned";
  saveQuizzesData(ctx, data);
}

export function isQuizAvailableForKid(ctx, quizId, kidId) {
  const data = getQuizzesData(ctx);
  const a = data.assignments.find((x) => x.quizId === quizId && x.kidId === kidId);
  if (!a) return false;
  return a.status === "assigned";
}

// ---------------- ATTEMPTS / GRADING ----------------

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function startAttempt(ctx, quizId, kidId) {
  const data = getQuizzesData(ctx);

  if (!isQuizAvailableForKid(ctx, quizId, kidId)) {
    return { ok: false, error: "Quiz not available (already taken or not assigned)." };
  }

  const quiz = data.bank.find((q) => q.id === quizId);
  if (!quiz) return { ok: false, error: "Quiz not found." };

  const attemptId = uuid();
  const startedAt = new Date().toISOString();

  let questions = quiz.questions.map((q) => ({ ...q }));

  if (quiz.shuffleQuestions) questions = shuffleArray(questions);

  if (quiz.shuffleAnswers) {
    questions = questions.map((q) => {
      const indices = q.choices.map((_, i) => i);
      const shuffled = shuffleArray(indices);

      const newChoices = shuffled.map((i) => q.choices[i]);
      const newCorrectIndex = shuffled.indexOf(q.correctIndex);

      return { ...q, choices: newChoices, correctIndex: newCorrectIndex };
    });
  }

  const reward = normalizeReward(quiz.reward);

  const attempt = {
    id: attemptId,
    quizId,
    kidId,
    startedAt,
    submittedAt: null,
    durationSeconds: null,
    scorePercent: null,
    passed: null,
    awarded: false,
    rewardGranted: null,
    rewardType: null,
    answers: {},
  };

  saveQuizzesData(ctx, { ...data, attempts: [...data.attempts, attempt] });

  const publicQuiz = {
    id: quiz.id,
    title: quiz.title,
    description: quiz.description,
    category: quiz.category || "",
    passPercent: quiz.passPercent,
    timeLimitSeconds: quiz.timeLimitSeconds,
    reward,
    questions: questions.map((q) => ({
      id: q.id,
      prompt: q.prompt,
      choices: q.choices,
      explanation: q.explanation || "",
    })),
  };

  return { ok: true, attemptId, publicQuiz, gradingQuestions: questions };
}

export function submitAttempt(ctx, { attemptId, answers, gradingQuestions }) {
  const data = getQuizzesData(ctx);
  const attempt = data.attempts.find((a) => a.id === attemptId);
  if (!attempt) return { ok: false, error: "Attempt not found." };
  if (attempt.submittedAt) return { ok: false, error: "Attempt already submitted." };

  const quiz = data.bank.find((q) => q.id === attempt.quizId);
  if (!quiz) return { ok: false, error: "Quiz not found." };

  const reward = normalizeReward(quiz.reward);

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

  const assignment = data.assignments.find((a) => a.quizId === quiz.id && a.kidId === attempt.kidId);
  if (assignment) assignment.status = "completed";

  saveQuizzesData(ctx, data);

  if (passed && !attempt.awarded && reward.kind !== "choice") {
    const currency = reward.kind === "minutes" ? "minutes" : "points";
    const amount = reward.kind === "minutes" ? reward.minutesAmount : reward.pointsAmount;
    grantReward(ctx, attempt.id, attempt.kidId, quiz, scorePercent, currency, amount);
  }

  if (passed && reward.kind === "choice") {
    return {
      ok: true,
      scorePercent,
      passed,
      needsChoice: true,
      choiceOptions: {
        minutes: reward.minutesAmount || 0,
        points: reward.pointsAmount || 0,
      },
    };
  }

  return { ok: true, scorePercent, passed, needsChoice: false };
}

function grantReward(ctx, attemptId, kidId, quiz, scorePercent, currency, amount) {
  const data = getQuizzesData(ctx);
  const attempt = data.attempts.find((a) => a.id === attemptId);
  if (!attempt) return { ok: false, error: "Attempt not found." };
  if (attempt.awarded) return { ok: true };

  const amt = Math.max(0, Math.floor(Number(amount || 0)));
  if (amt <= 0) return { ok: false, error: "Invalid reward amount." };

  ctx.eventBus.emit("REWARDS/CREDIT", {
    kidId,
    currency, // minutes | points
    amount: amt,
    sourceModule: "quizzes",
    sourceRef: `quizAttempt:${attemptId}`,
    reason: `Passed quiz: ${quiz.title}`,
    metadata: { quizId: quiz.id, scorePercent },
  });

  attempt.awarded = true;
  attempt.rewardGranted = { currency, amount: amt };
  attempt.rewardType = currency;

  saveQuizzesData(ctx, data);
  return { ok: true };
}

export function chooseRewardForAttempt(ctx, attemptId, currency) {
  const data = getQuizzesData(ctx);
  const attempt = data.attempts.find((a) => a.id === attemptId);
  if (!attempt) return { ok: false, error: "Attempt not found." };
  if (!attempt.submittedAt || !attempt.passed) return { ok: false, error: "Attempt not eligible." };
  if (attempt.awarded) return { ok: true };

  const quiz = data.bank.find((q) => q.id === attempt.quizId);
  if (!quiz) return { ok: false, error: "Quiz not found." };

  const reward = normalizeReward(quiz.reward);
  if (reward.kind !== "choice") return { ok: false, error: "Not a choice-reward quiz." };

  if (currency !== "minutes" && currency !== "points") return { ok: false, error: "Invalid currency choice." };

  const amount = currency === "minutes" ? reward.minutesAmount : reward.pointsAmount;
  return grantReward(ctx, attemptId, attempt.kidId, quiz, attempt.scorePercent || 0, currency, amount);
}

export function getKidEarnedTotals(data, kidId) {
  const attempts = (data.attempts || []).filter((a) => a.kidId === kidId && a.awarded && a.rewardGranted);
  let minutes = 0;
  let points = 0;
  for (const a of attempts) {
    if (a.rewardGranted.currency === "minutes") minutes += a.rewardGranted.amount;
    if (a.rewardGranted.currency === "points") points += a.rewardGranted.amount;
  }
  return { minutes, points };
}
