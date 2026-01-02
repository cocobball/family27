import { Gift } from "lucide-react";
import RewardsModule from "./module.jsx";
import { defaultRewardsData, creditRewards, debitRewards, unlockParent } from "./helpers.js";

function attachRewardsListeners(ctx) {
  // Idempotent guard (prevents double-attaching during HMR/dev)
  if (ctx.__rewardsListenersAttached) return;
  ctx.__rewardsListenersAttached = true;

  ctx.eventBus.on("REWARDS/CREDIT", (payload) => {
    const res = creditRewards(ctx, payload);
    if (!res.ok) {
      console.warn("[REWARDS] credit failed:", res.error, payload);
    }
  });

  ctx.eventBus.on("REWARDS/DEBIT", (payload) => {
    const res = debitRewards(ctx, payload);
    if (!res.ok) {
      console.warn("[REWARDS] debit failed:", res.error, payload);
    }
  });

  ctx.eventBus.on("REWARDS/UNLOCK_PARENT", (payload) => {
    const { password, minutes } = payload;
    const ok = unlockParent(ctx, password, minutes);
    if (payload.reply) {
      payload.reply(ok);
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
