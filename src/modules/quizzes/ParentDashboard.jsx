import React, { useMemo, useState } from "react";
import {
  KIDS,
  assignQuizToKids,
  deleteQuizFromBank,
  resetQuizForKid,
  rewardSummary,
  normalizeReward,
  makeReward,
  upsertQuizInBank,
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
    width: "100%",
  },
  select: {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.10)",
    color: "white",
    outline: "none",
  },
  label: { fontSize: 12, opacity: 0.85, marginBottom: 6 },
};

function safeIsoToLocal(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function kidName(id) {
  return KIDS.find((k) => k.id === id)?.name || id;
}

export default function ParentDashboard({
  ctx,
  data,
  bank,
  assignments,
  attempts,
  onRerender,
  onImportXmlFile,
  requireParent,
}) {
  const [filterKid, setFilterKid] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all"); // all|assigned|completed
  const [filterCategory, setFilterCategory] = useState("all");
  const [search, setSearch] = useState("");

  const [editQuizId, setEditQuizId] = useState(null);

  const categories = useMemo(() => {
    const set = new Set();
    for (const q of bank) if (q.category) set.add(q.category);
    return ["all", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [bank]);

  const filteredBank = useMemo(() => {
    const s = search.trim().toLowerCase();
    return bank.filter((q) => {
      if (filterCategory !== "all" && (q.category || "") !== filterCategory) return false;
      if (s) {
        const hay = `${q.title} ${q.description} ${q.category || ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      if (filterKid === "all" && filterStatus === "all") return true;

      // if filtering by kid/status, evaluate based on assignments table
      const relevant = assignments.filter((a) => a.quizId === q.id);
      if (filterKid !== "all") {
        if (!relevant.some((a) => a.kidId === filterKid)) return false;
      }
      if (filterStatus !== "all") {
        if (filterKid === "all") {
          // any assignment matches status
          if (!relevant.some((a) => a.status === filterStatus)) return false;
        } else {
          // specific kid assignment matches status
          if (!relevant.some((a) => a.kidId === filterKid && a.status === filterStatus)) return false;
        }
      }
      return true;
    });
  }, [bank, assignments, filterKid, filterStatus, filterCategory, search]);

  const editQuiz = bank.find((q) => q.id === editQuizId) || null;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Import + Filters */}
      <div style={S.card}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
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

          <div style={{ minWidth: 160 }}>
            <div style={S.label}>Filter kid</div>
            <select style={S.select} value={filterKid} onChange={(e) => setFilterKid(e.target.value)}>
              <option value="all">All</option>
              {KIDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ minWidth: 160 }}>
            <div style={S.label}>Status</div>
            <select style={S.select} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="all">All</option>
              <option value="assigned">Assigned</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          <div style={{ minWidth: 180 }}>
            <div style={S.label}>Category</div>
            <select style={S.select} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c === "all" ? "All" : c}
                </option>
              ))}
            </select>
          </div>

          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={S.label}>Search</div>
            <input style={S.input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="title, desc, category..." />
          </div>
        </div>
      </div>

      {/* Bank grid */}
      <div style={S.card}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Quiz Bank</div>
        {filteredBank.length === 0 ? (
          <div style={{ opacity: 0.85 }}>No quizzes match your filters.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {filteredBank.map((q) => {
              const qAssignments = assignments.filter((a) => a.quizId === q.id);
              const assignedKids = qAssignments.map((a) => `${kidName(a.kidId)}: ${a.status}`).join(" • ") || "Not assigned";

              return (
                <div key={q.id} style={{ ...S.card, background: "rgba(255,255,255,0.06)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 900, fontSize: 16 }}>{q.title}</div>
                      <div style={{ opacity: 0.9, marginTop: 4 }}>{q.description}</div>
                      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.9 }}>
                        Category: {q.category || "—"} • Pass: {q.passPercent}% • Reward: {rewardSummary(q)}
                        {q.timeLimitSeconds != null ? ` • Time: ${q.timeLimitSeconds}s` : " • Untimed"} • Qs: {q.questions.length}
                      </div>
                      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                        Assigned: {assignedKids}
                      </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                      <button style={S.btn(false)} onClick={() => setEditQuizId(q.id)}>
                        Edit (full screen)
                      </button>
                      <button
                        style={S.btnDanger}
                        onClick={() => {
                          if (!confirm(`Delete quiz "${q.title}" from bank?`)) return;
                          deleteQuizFromBank(ctx, q.id);
                          onRerender();
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {KIDS.map((k) => (
                      <button
                        key={k.id}
                        style={S.btn(false)}
                        onClick={() => {
                          assignQuizToKids(ctx, q.id, [k.id]);
                          onRerender();
                        }}
                      >
                        Assign → {k.name}
                      </button>
                    ))}
                    <button
                      style={S.btn(false)}
                      onClick={() => {
                        assignQuizToKids(ctx, q.id, KIDS.map((k) => k.id));
                        onRerender();
                      }}
                    >
                      Assign → All
                    </button>
                  </div>

                  <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                    <div style={{ fontWeight: 800, opacity: 0.9 }}>Unlock/Reset for kid</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {KIDS.map((k) => (
                        <button
                          key={k.id}
                          style={S.btn(false)}
                          onClick={() => {
                            resetQuizForKid(ctx, q.id, k.id);
                            onRerender();
                          }}
                        >
                          Reset {k.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Attempts history */}
      <div style={S.card}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Attempts (history)</div>
        {attempts.length === 0 ? (
          <div style={{ opacity: 0.85 }}>No attempts yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {attempts
              .slice()
              .sort((a, b) => (b.submittedAt || b.startedAt).localeCompare(a.submittedAt || a.startedAt))
              .slice(0, 80)
              .map((a) => {
                const quiz = bank.find((q) => q.id === a.quizId);
                const rg = a.rewardGranted
                  ? a.rewardGranted.currency === "minutes"
                    ? `${a.rewardGranted.amount} min`
                    : `$${a.rewardGranted.amount}`
                  : "";
                return (
                  <div key={a.id} style={{ ...S.card, background: "rgba(255,255,255,0.06)" }}>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      {safeIsoToLocal(a.startedAt)} • {kidName(a.kidId)} • {quiz ? quiz.title : a.quizId}
                    </div>
                    <div style={{ marginTop: 4 }}>
                      Result:{" "}
                      {a.submittedAt ? (a.passed ? "✅ Pass" : "❌ Fail") : "In progress"}{" "}
                      {a.scorePercent != null ? `• ${a.scorePercent}%` : ""}{" "}
                      {a.awarded ? `• Rewarded (${rg})` : ""}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Full screen editor */}
      {editQuiz && (
        <QuizEditorOverlay
          quiz={editQuiz}
          onClose={() => setEditQuizId(null)}
          onSave={(updated) => {
            upsertQuizInBank(ctx, updated);
            setEditQuizId(null);
            onRerender();
          }}
        />
      )}
    </div>
  );
}

function QuizEditorOverlay({ quiz, onClose, onSave }) {
  const [draft, setDraft] = useState(() => {
    const r = normalizeReward(quiz.reward);
    return {
      ...quiz,
      reward: r,
      questions: (quiz.questions || []).map((q) => ({
        ...q,
        choices: Array.isArray(q.choices) ? q.choices.slice() : [],
      })),
    };
  });

  function setRewardKind(kind) {
    const r = normalizeReward(draft.reward);
    if (kind === "minutes") setDraft((d) => ({ ...d, reward: makeReward("minutes", r.minutesAmount || 10, 0) }));
    if (kind === "points") setDraft((d) => ({ ...d, reward: makeReward("points", 0, r.pointsAmount || 5) }));
    if (kind === "choice") setDraft((d) => ({ ...d, reward: makeReward("choice", r.minutesAmount || 10, r.pointsAmount || 5) }));
  }

  function validateAndSave() {
    const t = String(draft.title || "").trim();
    if (!t) return alert("Title is required.");
    if (!Array.isArray(draft.questions) || draft.questions.length === 0) return alert("Need at least 1 question.");

    for (const [i, q] of draft.questions.entries()) {
      if (!String(q.prompt || "").trim()) return alert(`Question ${i + 1} prompt is required.`);
      if (!Array.isArray(q.choices) || q.choices.length < 2) return alert(`Question ${i + 1} needs at least 2 choices.`);
      if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.choices.length) {
        return alert(`Question ${i + 1} correctIndex is invalid.`);
      }
    }

    onSave({
      ...draft,
      title: t,
      description: String(draft.description || ""),
      category: String(draft.category || ""),
      passPercent: Math.max(1, Math.min(100, Math.floor(Number(draft.passPercent || 80)))),
      timeLimitSeconds:
        draft.timeLimitSeconds == null || draft.timeLimitSeconds === ""
          ? null
          : Math.max(1, Math.floor(Number(draft.timeLimitSeconds))),
      reward: normalizeReward(draft.reward),
      shuffleQuestions: !!draft.shuffleQuestions,
      shuffleAnswers: !!draft.shuffleAnswers,
    });
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.78)",
        zIndex: 9999,
        padding: 14,
        overflow: "auto",
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 12 }}>
        <div style={{ ...S.card, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 950, fontSize: 18 }}>Edit Quiz</div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>ID: {quiz.id}</div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button style={S.btn(false)} onClick={validateAndSave}>
              Save
            </button>
            <button style={S.btnDanger} onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div style={S.card}>
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <div style={S.label}>Title</div>
              <input style={S.input} value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
            </div>

            <div>
              <div style={S.label}>Description</div>
              <input
                style={S.input}
                value={draft.description || ""}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div>
                <div style={S.label}>Category</div>
                <input
                  style={S.input}
                  value={draft.category || ""}
                  onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
                />
              </div>

              <div>
                <div style={S.label}>Pass %</div>
                <input
                  style={S.input}
                  type="number"
                  value={draft.passPercent}
                  onChange={(e) => setDraft((d) => ({ ...d, passPercent: e.target.value }))}
                />
              </div>

              <div>
                <div style={S.label}>Time limit (seconds, blank=untimed)</div>
                <input
                  style={S.input}
                  type="number"
                  value={draft.timeLimitSeconds ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, timeLimitSeconds: e.target.value }))}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", opacity: 0.9 }}>
                <input
                  type="checkbox"
                  checked={!!draft.shuffleQuestions}
                  onChange={(e) => setDraft((d) => ({ ...d, shuffleQuestions: e.target.checked }))}
                />
                Shuffle questions
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", opacity: 0.9 }}>
                <input
                  type="checkbox"
                  checked={!!draft.shuffleAnswers}
                  onChange={(e) => setDraft((d) => ({ ...d, shuffleAnswers: e.target.checked }))}
                />
                Shuffle answers
              </label>
            </div>
          </div>
        </div>

        {/* Reward editor */}
        <div style={S.card}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Reward</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button style={S.btn(draft.reward.kind === "minutes")} onClick={() => setRewardKind("minutes")}>
              Game Time only
            </button>
            <button style={S.btn(draft.reward.kind === "points")} onClick={() => setRewardKind("points")}>
              Dollars only
            </button>
            <button style={S.btn(draft.reward.kind === "choice")} onClick={() => setRewardKind("choice")}>
              Choice
            </button>
          </div>

          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={S.label}>Minutes (game time)</div>
              <input
                style={S.input}
                type="number"
                value={draft.reward.minutesAmount}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, reward: { ...d.reward, minutesAmount: Math.max(0, Math.floor(Number(e.target.value || 0))) } }))
                }
              />
            </div>
            <div>
              <div style={S.label}>Dollars ($) (stored as points)</div>
              <input
                style={S.input}
                type="number"
                value={draft.reward.pointsAmount}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, reward: { ...d.reward, pointsAmount: Math.max(0, Math.floor(Number(e.target.value || 0))) } }))
                }
              />
            </div>
          </div>

          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
            Current: <b>{rewardSummary({ reward: draft.reward })}</b>
          </div>
        </div>

        {/* Questions editor */}
        <div style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div style={{ fontWeight: 900 }}>Questions</div>
            <button
              style={S.btn(false)}
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  questions: [
                    ...(d.questions || []),
                    {
                      id: `q${(d.questions?.length || 0) + 1}`,
                      prompt: "",
                      choices: ["", ""],
                      correctIndex: 0,
                      explanation: "",
                    },
                  ],
                }))
              }
            >
              + Add question
            </button>
          </div>

          <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
            {(draft.questions || []).map((q, qi) => (
              <div key={q.id || qi} style={{ ...S.card, background: "rgba(255,255,255,0.06)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontWeight: 800 }}>Q{qi + 1}</div>
                  <button
                    style={S.btnDanger}
                    onClick={() => setDraft((d) => ({ ...d, questions: d.questions.filter((_, idx) => idx !== qi) }))}
                  >
                    Remove
                  </button>
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={S.label}>Prompt</div>
                  <input
                    style={S.input}
                    value={q.prompt}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDraft((d) => {
                        const next = d.questions.slice();
                        next[qi] = { ...next[qi], prompt: v };
                        return { ...d, questions: next };
                      });
                    }}
                  />
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  <div style={S.label}>Choices</div>
                  {q.choices.map((c, ci) => (
                    <div key={ci} style={{ display: "grid", gridTemplateColumns: "36px 1fr 90px", gap: 8, alignItems: "center" }}>
                      <div style={{ opacity: 0.9 }}>{String.fromCharCode(65 + ci)}.</div>
                      <input
                        style={S.input}
                        value={c}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDraft((d) => {
                            const next = d.questions.slice();
                            const qq = { ...next[qi], choices: next[qi].choices.slice() };
                            qq.choices[ci] = v;
                            next[qi] = qq;
                            // clamp correct index
                            if (qq.correctIndex >= qq.choices.length) qq.correctIndex = 0;
                            return { ...d, questions: next };
                          });
                        }}
                      />
                      <button
                        style={S.btn(q.correctIndex === ci)}
                        onClick={() => {
                          setDraft((d) => {
                            const next = d.questions.slice();
                            next[qi] = { ...next[qi], correctIndex: ci };
                            return { ...d, questions: next };
                          });
                        }}
                      >
                        Correct
                      </button>
                    </div>
                  ))}

                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      style={S.btn(false)}
                      onClick={() => {
                        setDraft((d) => {
                          const next = d.questions.slice();
                          const qq = { ...next[qi], choices: next[qi].choices.slice() };
                          qq.choices.push("");
                          next[qi] = qq;
                          return { ...d, questions: next };
                        });
                      }}
                    >
                      + Choice
                    </button>
                    {q.choices.length > 2 && (
                      <button
                        style={S.btnDanger}
                        onClick={() => {
                          setDraft((d) => {
                            const next = d.questions.slice();
                            const qq = { ...next[qi], choices: next[qi].choices.slice() };
                            qq.choices.pop();
                            if (qq.correctIndex >= qq.choices.length) qq.correctIndex = 0;
                            next[qi] = qq;
                            return { ...d, questions: next };
                          });
                        }}
                      >
                        - Choice
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={S.label}>Explanation (optional)</div>
                  <input
                    style={S.input}
                    value={q.explanation || ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDraft((d) => {
                        const next = d.questions.slice();
                        next[qi] = { ...next[qi], explanation: v };
                        return { ...d, questions: next };
                      });
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...S.card, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button style={S.btn(false)} onClick={validateAndSave}>
            Save
          </button>
          <button style={S.btnDanger} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
