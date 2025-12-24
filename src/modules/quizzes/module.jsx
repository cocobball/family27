import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  KIDS,
  getQuizzesData,
  saveQuizzesData,
  parseQuizXml,
  assignQuizToKids,
  resetQuizForKid,
  isQuizAvailableForKid,
  isParentUnlocked,
  unlockParent,
  lockParent,
  startAttempt,
  submitAttempt,
} from "./helpers.js";

const S = {
  card: {
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.25)",
    borderRadius: 12,
    padding: 12,
  },
  btn: (active) => ({
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.18)",
    background: active ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.10)",
    color: "white",
    cursor: "pointer",
  }),
  btnDanger: {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,120,120,0.35)",
    background: "rgba(255,80,80,0.12)",
    color: "white",
    cursor: "pointer",
  },
  input: {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.10)",
    color: "white",
    outline: "none",
  },
  label: { fontSize: 12, opacity: 0.85, marginBottom: 6 },
};

function mmss(seconds) {
  const s = Math.max(0, seconds);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function QuizzesModule({ ctx }) {
  const [, rerender] = useState(0);
  const [tab, setTab] = useState("kid"); // "kid" | "parent"

  // Kid mode state
  const [kidId, setKidId] = useState("harvey");

  // Taking quiz state
  const [taking, setTaking] = useState(null);
  // taking: { attemptId, quiz, gradingQuestions, answers, timeLeft, result }

  const timerRef = useRef(null);

  const data = useMemo(() => getQuizzesData(ctx), [ctx, rerender]);

  // clear timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ------- Parent actions (locked) -------
  const parentUnlocked = isParentUnlocked(data);

  function requireParent() {
    if (parentUnlocked) return true;
    const pwd = prompt("Parent password required:");
    if (!pwd) return false;
    const ok = unlockParent(ctx, pwd, 10);
    if (!ok) {
      alert("Incorrect password");
      return false;
    }
    rerender((x) => x + 1);
    return true;
  }

  // ------- Import XML -------
  async function onImportXmlFile(file) {
    const text = await file.text();
    const parsed = parseQuizXml(text);
    if (!parsed.ok) {
      alert(`Import failed: ${parsed.error}`);
      return;
    }

    const d = getQuizzesData(ctx);
    // Upsert by id
    const existingIdx = d.bank.findIndex(q => q.id === parsed.quiz.id);
    if (existingIdx >= 0) d.bank[existingIdx] = parsed.quiz;
    else d.bank.unshift(parsed.quiz);

    saveQuizzesData(ctx, d);
    rerender((x) => x + 1);
  }

  // ------- Assign -------
  function onAssign(quizId, selectedKids) {
    if (!requireParent()) return;
    assignQuizToKids(ctx, quizId, selectedKids);
    rerender((x) => x + 1);
  }

  // ------- Reset/Unlock quiz for kid -------
  function onReset(quizId, kidIdToReset) {
    if (!requireParent()) return;
    resetQuizForKid(ctx, quizId, kidIdToReset);
    rerender((x) => x + 1);
  }

  // ------- Kid start attempt -------
  function onStartQuiz(quizId) {
    const res = startAttempt(ctx, quizId, kidId);
    if (!res.ok) {
      alert(res.error);
      return;
    }

    const quiz = res.publicQuiz;
    const timeLeft = quiz.timeLimitSeconds != null ? Number(quiz.timeLimitSeconds) : null;

    const state = {
      attemptId: res.attemptId,
      quiz,
      gradingQuestions: res.gradingQuestions,
      answers: {},
      timeLeft,
      result: null,
    };
    setTaking(state);

    // Start timer if timed
    if (timerRef.current) clearInterval(timerRef.current);
    if (timeLeft != null) {
      timerRef.current = setInterval(() => {
        setTaking((prev) => {
          if (!prev || prev.result) return prev;
          const next = { ...prev, timeLeft: (prev.timeLeft || 0) - 1 };
          if (next.timeLeft <= 0) {
            // auto-submit
            clearInterval(timerRef.current);
            timerRef.current = null;
            const submitted = submitAttempt(ctx, {
              attemptId: prev.attemptId,
              answers: prev.answers,
              gradingQuestions: prev.gradingQuestions,
            });
            return { ...next, timeLeft: 0, result: submitted.ok ? submitted : { ok: false, error: submitted.error } };
          }
          return next;
        });
      }, 1000);
    }
  }

  // ------- Kid submit -------
  function onSubmitQuiz() {
    if (!taking || taking.result) return;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const submitted = submitAttempt(ctx, {
      attemptId: taking.attemptId,
      answers: taking.answers,
      gradingQuestions: taking.gradingQuestions,
    });

    setTaking((prev) => ({ ...prev, result: submitted }));
    rerender((x) => x + 1);
  }

  // ------- Render helpers -------
  const bank = data.bank || [];
  const assignments = data.assignments || [];
  const attempts = data.attempts || [];

  const assignedForKid = assignments
    .filter(a => a.kidId === kidId)
    .map(a => ({
      ...a,
      quiz: bank.find(q => q.id === a.quizId),
    }))
    .filter(x => x.quiz);

  return (
    <div style={{ padding: 16, color: "white" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Quizzes</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={S.btn(tab === "kid")} onClick={() => setTab("kid")}>Kid</button>
          <button style={S.btn(tab === "parent")} onClick={() => setTab("parent")}>Parent</button>
        </div>
      </div>

      {tab === "kid" && (
        <div style={{ marginTop: 12 }}>
          {!taking ? (
            <>
              <div style={{ ...S.card, marginBottom: 12 }}>
                <div style={S.label}>Who is taking the quiz?</div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button style={S.btn(kidId === "harvey")} onClick={() => setKidId("harvey")}>Harvey</button>
                  <button style={S.btn(kidId === "brady")} onClick={() => setKidId("brady")}>Brady</button>
                </div>
              </div>

              <h3 style={{ margin: "0 0 10px 0" }}>Assigned quizzes</h3>
              {assignedForKid.length === 0 ? (
                <div style={{ opacity: 0.85 }}>No quizzes assigned yet.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {assignedForKid.map((a) => {
                    const available = isQuizAvailableForKid(ctx, a.quizId, kidId);
                    const q = a.quiz;

                    return (
                      <div key={a.id} style={S.card}>
                        <div style={{ fontWeight: 900, fontSize: 16 }}>{q.title}</div>
                        <div style={{ opacity: 0.9, marginTop: 4 }}>{q.description}</div>

                        <div style={{ marginTop: 8, fontSize: 13, opacity: 0.9 }}>
                          Pass: {q.passPercent}% • Reward: {q.reward.amount} {q.reward.currency}
                          {q.timeLimitSeconds != null ? ` • Time: ${q.timeLimitSeconds}s` : " • Untimed"}
                        </div>

                        <div style={{ marginTop: 10 }}>
                          <button
                            style={S.btn(false)}
                            disabled={!available}
                            onClick={() => onStartQuiz(a.quizId)}
                          >
                            {available ? "Start quiz" : "Completed (Ask parent to unlock)"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={S.card}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 900, fontSize: 18 }}>{taking.quiz.title}</div>
                    <div style={{ opacity: 0.9, marginTop: 4 }}>{taking.quiz.description}</div>
                  </div>
                  {taking.timeLeft != null && (
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 12, opacity: 0.85 }}>Time left</div>
                      <div style={{ fontWeight: 900, fontSize: 18 }}>{mmss(taking.timeLeft)}</div>
                    </div>
                  )}
                </div>
              </div>

              {taking.result ? (
                <div style={S.card}>
                  {taking.result.ok ? (
                    <>
                      <div style={{ fontWeight: 900, fontSize: 18 }}>
                        {taking.result.passed ? "✅ Passed!" : "❌ Failed"}
                      </div>
                      <div style={{ marginTop: 6 }}>
                        Score: <b>{taking.result.scorePercent}%</b>
                      </div>
                      <div style={{ marginTop: 6 }}>
                        {taking.result.passed
                          ? `Reward: ${taking.quiz.reward.amount} ${taking.quiz.reward.currency} (added to Rewards)`
                          : "No reward awarded."}
                      </div>

                      <button
                        style={{ ...S.btn(false), marginTop: 12 }}
                        onClick={() => setTaking(null)}
                      >
                        Back to list
                      </button>
                    </>
                  ) : (
                    <>
                      <div style={{ fontWeight: 900, fontSize: 18 }}>Error</div>
                      <div style={{ marginTop: 6, opacity: 0.9 }}>{taking.result.error}</div>
                      <button style={{ ...S.btn(false), marginTop: 12 }} onClick={() => setTaking(null)}>
                        Back
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <>
                  {taking.quiz.questions.map((q, idx) => (
                    <div key={q.id} style={S.card}>
                      <div style={{ fontWeight: 800 }}>{idx + 1}. {q.prompt}</div>
                      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                        {q.choices.map((c, ci) => {
                          const selected = taking.answers[q.id] === ci;
                          return (
                            <button
                              key={ci}
                              style={S.btn(selected)}
                              onClick={() => {
                                setTaking((prev) => ({
                                  ...prev,
                                  answers: { ...prev.answers, [q.id]: ci },
                                }));
                              }}
                            >
                              {c}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  <div style={S.card}>
                    <button style={S.btn(false)} onClick={onSubmitQuiz}>
                      Submit
                    </button>
                    <button
                      style={{ ...S.btnDanger, marginLeft: 10 }}
                      onClick={() => {
                        if (timerRef.current) clearInterval(timerRef.current);
                        timerRef.current = null;
                        setTaking(null);
                      }}
                    >
                      Exit
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "parent" && (
        <div style={{ marginTop: 12 }}>
          <div style={{ ...S.card, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <div style={{ fontWeight: 900 }}>Parent dashboard</div>
              <div style={{ opacity: 0.85 }}>
                Status: {parentUnlocked ? "Unlocked" : "Locked"}
              </div>
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
              {!parentUnlocked ? (
                <button
                  style={S.btn(false)}
                  onClick={() => {
                    const pwd = prompt("Parent password required:");
                    if (!pwd) return;
                    const ok = unlockParent(ctx, pwd, 10);
                    if (!ok) alert("Incorrect password");
                    rerender((x) => x + 1);
                  }}
                >
                  Unlock
                </button>
              ) : (
                <button
                  style={S.btn(false)}
                  onClick={() => {
                    lockParent(ctx);
                    rerender((x) => x + 1);
                  }}
                >
                  Lock now
                </button>
              )}

              <label style={{ ...S.btn(false), display: "inline-block" }}>
                Import XML
                <input
                  type="file"
                  accept=".xml,text/xml"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (!requireParent()) return;
                    const file = e.target.files?.[0];
                    if (file) onImportXmlFile(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          </div>

          {!parentUnlocked ? (
            <div style={{ opacity: 0.85 }}>Unlock to manage quizzes.</div>
          ) : (
            <>
              <h3 style={{ margin: "0 0 10px 0" }}>Quiz Bank</h3>
              {bank.length === 0 ? (
                <div style={{ opacity: 0.85 }}>No quizzes imported yet.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {bank.map((q) => (
                    <div key={q.id} style={S.card}>
                      <div style={{ fontWeight: 900, fontSize: 16 }}>{q.title}</div>
                      <div style={{ opacity: 0.9, marginTop: 4 }}>{q.description}</div>

                      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.9 }}>
                        Pass: {q.passPercent}% • Reward: {q.reward.amount} {q.reward.currency}
                        {q.timeLimitSeconds != null ? ` • Time: ${q.timeLimitSeconds}s` : " • Untimed"}
                        • Questions: {q.questions.length}
                      </div>

                      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button style={S.btn(false)} onClick={() => onAssign(q.id, ["harvey"])}>
                          Assign → Harvey
                        </button>
                        <button style={S.btn(false)} onClick={() => onAssign(q.id, ["brady"])}>
                          Assign → Brady
                        </button>
                        <button style={S.btn(false)} onClick={() => onAssign(q.id, ["harvey", "brady"])}>
                          Assign → Both
                        </button>
                      </div>

                      <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                        <div style={{ fontWeight: 800, opacity: 0.9 }}>Unlock/Reset for kid</div>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <button style={S.btn(false)} onClick={() => onReset(q.id, "harvey")}>
                            Reset Harvey
                          </button>
                          <button style={S.btn(false)} onClick={() => onReset(q.id, "brady")}>
                            Reset Brady
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <h3 style={{ margin: "16px 0 10px 0" }}>Attempts (history)</h3>
              {attempts.length === 0 ? (
                <div style={{ opacity: 0.85 }}>No attempts yet.</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {attempts
                    .slice()
                    .sort((a, b) => (b.submittedAt || b.startedAt).localeCompare(a.submittedAt || a.startedAt))
                    .slice(0, 50)
                    .map((a) => {
                      const quiz = bank.find(q => q.id === a.quizId);
                      return (
                        <div key={a.id} style={S.card}>
                          <div style={{ fontSize: 12, opacity: 0.8 }}>
                            {new Date(a.startedAt).toLocaleString()} • {a.kidId} • {quiz ? quiz.title : a.quizId}
                          </div>
                          <div style={{ marginTop: 4 }}>
                            Result:{" "}
                            {a.submittedAt
                              ? (a.passed ? "✅ Pass" : "❌ Fail")
                              : "In progress"}{" "}
                            {a.scorePercent != null ? `• ${a.scorePercent}%` : ""}{" "}
                            {a.awarded ? "• Rewarded" : ""}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
