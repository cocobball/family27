
import React, { useEffect, useState } from "react";
import { NETWORK_EVENTS, defaultNetworkData } from "./helpers.js";

export default function NetworkModule({ ctx }) {
  const [, rerender] = useState(0);

  function getData() {
    return ctx.store.get(defaultNetworkData());
  }

  function save(data) {
    ctx.store.set(data);
    rerender(x => x + 1);
  }

  async function pause(ruleId) {
    await fetch("/api/firewalla/pause", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ruleId })
    });
  }

  async function resume(ruleId) {
    await fetch("/api/firewalla/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ruleId })
    });
  }

  useEffect(() => {
    const offStart = ctx.eventBus.on(NETWORK_EVENTS.SESSION_STARTED, async (p) => {
      const data = getData();
      const kid = data.kids[p.kidId];
      const until = new Date(p.endsAt).getTime();
      kid.allowedUntil = Math.max(kid.allowedUntil || 0, until);
      save(data);
      if (kid.ruleId) await pause(kid.ruleId);
    });

    const offEnd = ctx.eventBus.on(NETWORK_EVENTS.SESSION_ENDED, async (p) => {
      const data = getData();
      const kid = data.kids[p.kidId];
      if (Date.now() >= (kid.allowedUntil || 0)) {
        kid.allowedUntil = 0;
        save(data);
        if (kid.ruleId) await resume(kid.ruleId);
      }
    });

    return () => { offStart(); offEnd(); };
  }, []);

  const data = getData();

  return (
    <div style={{ padding: 16, color: "white" }}>
      <h2>Network Control</h2>
      {Object.entries(data.kids).map(([kidId, k]) => (
        <div key={kidId} style={{ marginBottom: 12 }}>
          <b>{kidId}</b>
          <div>
            Rule ID:
            <input
              value={k.ruleId}
              onChange={e => {
                k.ruleId = e.target.value;
                save(data);
              }}
              style={{ width: "100%" }}
            />
          </div>
          <button onClick={() => {
            const until = Date.now() + 60 * 60 * 1000;
            k.allowedUntil = until;
            save(data);
            pause(k.ruleId);
          }}>
            +1 hour
          </button>
          <button onClick={() => {
            k.allowedUntil = 0;
            save(data);
            resume(k.ruleId);
          }}>
            Block now
          </button>
        </div>
      ))}
    </div>
  );
}
