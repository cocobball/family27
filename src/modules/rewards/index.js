import { Gift } from "lucide-react";
import RewardsModule from "./module.jsx";
import { defaultRewardsData, creditRewards } from "./helpers.js";

function attachRewardsListeners(ctx) {
  // Idempotent guard (prevents double-attaching during HMR/dev)
  if (ctx.__rewardsCreditListenerAttached) return;
  ctx.__rewardsCreditListenerAttached = true;

  ctx.eventBus.on("REWARDS/CREDIT", (payload) => {
    const res = creditRewards(ctx, payload);
    if (!res.ok) {
      console.warn("[REWARDS] credit failed:", res.error, payload);
    }
  });
}

export const moduleDef = {
  id: "rewards",
  title: "Rewards",
  icon: Gift,
  Component: RewardsModule,
  defaultData: defaultRewardsData,
  dependencies: [],

  // ✅ Your dashboard framework may call one of these hooks.
  // We provide several common names so it works without you having to change the core app.
  onInit(ctx) {
    attachRewardsListeners(ctx);
  },
  init(ctx) {
    attachRewardsListeners(ctx);
  },
  bootstrap(ctx) {
    attachRewardsListeners(ctx);
  },
};
