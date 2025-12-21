import { UtensilsCrossed } from "lucide-react";
import Module from "./module.jsx";
import { defaultData } from "./helpers.js";

export const moduleDef = {
  id: "meals",
  title: "Meals",
  icon: UtensilsCrossed,
  Component: Module,
  defaultData,
  dependencies: [],
};
