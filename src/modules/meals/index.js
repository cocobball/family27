import { UtensilsCrossed } from "lucide-react";
import Module from "./module.jsx";
import Settings from "./settings.jsx";
import { defaultData } from "./helpers.js";

export const moduleDef = {
  id: "meals",
  title: "Family Meals",
  icon: UtensilsCrossed,
  Component: Module,
  SettingsComponent: Settings,
  defaultData,
  dependencies: [],
};
