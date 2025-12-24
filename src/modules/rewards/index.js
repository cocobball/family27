import { Gift } from "lucide-react";
import RewardsModule from "./module.jsx";
import { defaultRewardsData } from "./helpers.js";

export const moduleDef = {
  id: "rewards",
  title: "Rewards",
  icon: Gift,
  Component: RewardsModule,
  defaultData: defaultRewardsData,
  dependencies: [], // can add later if needed
};
