import { Sparkles } from "lucide-react";
import Module from "./module.jsx";
import { defaultData } from "./helpers.js";

export const moduleDef = {
  id: "important",
  title: "Important Events",
  icon: Sparkles,
  Component: Module,
  defaultData,
  dependencies: [],
};
