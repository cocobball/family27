import React, { useEffect, useMemo, useRef, useState } from "react";
import ParentDashboard from "./ParentDashboard.jsx";
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
  chooseRewardForAttempt,
  getKidEarnedTotals,
  rewardSummary,
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
  const [kidId, setKidId] = useState("harvey");
  const [taking, setTaking] = useState(null);
  const timerRef = useRef(null);

  const data = useMemo(() => getQuizzesData(ctx), [ctx, rerender]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

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

  // ✅ BULK IMPORT (one or many quizzes)
  async function onImportXmlFile(file) {
    const text = await file.text();
    const parsed = parseQuizXml(text);
    if (!parsed.ok) {
      alert(`Import failed: ${parsed.error}`);
      return;
    }

    const quizzes = parsed.quizzes || [];
    if (quizzes.length === 0) {
      alert("Import found 0 quizzes.");
      return;
    }

    const d = getQuizzesData(ctx);
    let added = 0;
    let updated = 0;

    for (const quiz of quizzes) {
      const existingIdx = d.bank.findIndex((q) => q.id === quiz.id);
      if (existingIdx >= 0) {
        d.bank[existingIdx] = quiz;
        updated++;
      } else {
        d.bank.unshift(quiz);
        added++;
      }
    }

    saveQuizzesData(ctx, d);
    rerender((x) => x + 1);

    alert(`Imported ${quizzes.length} quiz(zes). Added: ${added}, Updated: ${updated}`);
  }

  function onAssign(quizId, selectedKids) {
    if (!requireParent()) return;
    assignQuizToKids(ctx, quizId, selectedKids);
    rerender((x) => x + 1);
  }

  function onReset(quizId, kidIdToReset) {
    if (!requireParent()) return;
    resetQuizForKid(ctx, quizId, kidIdToReset);
    rerender((x) => x + 1);
  }

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

    if (timerRef.current) clearInterval(timerRef.current);
    if (timeLeft != null) {
      timerRef.current = setInterval(() => {
        setTaking((prev) => {
          if (!prev || prev.result) return prev;
          const next = { ...prev, timeLeft: (prev.timeLeft || 0) - 1 };
          if (next.timeLeft <= 0) {
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

  const bank = data.bank || [];
  const assignments = data.assignments || [];
  const attempts = data.attempts || [];

  const assignedForKid = assignments
    .filter((a) => a.kidId === kidId)
    .map((a) => ({ ...a, quiz: bank.find((q) => q.id === a.quizId) }))
    .filter((x) => x.quiz);

  const totals = getKidEarnedTotals(data, kidId);

  return (
    <div style={{ padding: 16, color: "white" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Quizzes</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={S.btn(tab === "kid")} onClick={() => setTab("kid")}>
            Kid
          </button>
          <button style={S.btn(tab === "parent")} onClick={() => setTab("parent")}>
            Parent
          </button>
        </div>
      </div>

      {tab === "kid" && (
        <div style={{ marginTop: 12 }}>
          {!taking ? (
            <>
              <div style={{ ...S.card, marginBottom: 12 }}>
                <div style={S.label}>Who is taking the quiz?</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {KIDS.map((k) => (
                    <button key={k.id} style={S.btn(kidId === k.id)} onClick={() => setKidId(k.id)}>
                      {k.name}
                    </button>
                  ))}
                </div>

                <div style={{ marginTop: 10, display: "flex", gap: 14, flexWrap: "wrap", opacity: 0.95 }}>
                  <div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>Game Time earned</div>
                    <div style={{ fontWeight: 900, fontSize: 18 }}>{totals.minutes} min</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>$ earned</div>
                    <div style={{ fontWeight: 900, fontSize: 18 }}>${totals.points}</div>
                  </div>
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
                          {q.category ? `Category: ${q.category} • ` : ""}
                          Pass: {q.passPercent}% • Reward: {rewardSummary(q)}
                          {q.timeLimitSeconds != null ? ` • Time: ${q.timeLimitSeconds}s` : " • Untimed"}
                        </div>

                        <div style={{ marginTop: 10 }}>
                          <button style={S.btn(false)} disabled={!available} onClick={() => onStartQuiz(a.quizId)}>
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
                    {taking.quiz.category ? (
                      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>Category: {taking.quiz.category}</div>
                    ) : null}
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

                      {taking.result.passed && taking.result.needsChoice ? (
                        <>
                          <div style={{ marginTop: 10, opacity: 0.9 }}>Pick your reward:</div>
                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                            {taking.result.choiceOptions?.points > 0 && (
                              <button
                                style={S.btn(false)}
                                onClick={() => {
                                  const r = chooseRewardForAttempt(ctx, taking.attemptId, "points");
                                  if (!r.ok) return alert(r.error);
                                  setTaking((p) => ({ ...p, result: { ...p.result, needsChoice: false } }));
                                  rerender((x) => x + 1);
                                }}
                              >
                                Take ${taking.result.choiceOptions.points}
                              </button>
                            )}
                            {taking.result.choiceOptions?.minutes > 0 && (
                              <button
                                style={S.btn(false)}
                                onClick={() => {
                                  const r = chooseRewardForAttempt(ctx, taking.attemptId, "minutes");
                                  if (!r.ok) return alert(r.error);
                                  setTaking((p) => ({ ...p, result: { ...p.result, needsChoice: false } }));
                                  rerender((x) => x + 1);
                                }}
                              >
                                Take {taking.result.choiceOptions.minutes} min
                              </button>
                            )}
                          </div>
                        </>
                      ) : (
                        <div style={{ marginTop: 6 }}>
                          {taking.result.passed ? "Reward added to Rewards." : "No reward awarded."}
                        </div>
                      )}

                      <button style={{ ...S.btn(false), marginTop: 12 }} onClick={() => setTaking(null)}>
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
                      <div style={{ fontWeight: 800 }}>
                        {idx + 1}. {q.prompt}
                      </div>
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
              <div style={{ opacity: 0.85 }}>Status: {parentUnlocked ? "Unlocked" : "Locked"}</div>
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
            </div>
          </div>

          {!parentUnlocked ? (
            <div style={{ opacity: 0.85 }}>Unlock to manage quizzes.</div>
          ) : (
            <ParentDashboard
              ctx={ctx}
              data={data}
              bank={bank}
              assignments={assignments}
              attempts={attempts}
              onRerender={() => rerender((x) => x + 1)}
              onImportXmlFile={onImportXmlFile}
              requireParent={requireParent}
              onAssign={onAssign}
              onReset={onReset}
            />
          )}
        </div>
      )}
    </div>
  );
}
