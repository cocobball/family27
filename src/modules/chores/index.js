import { ClipboardList } from "lucide-react";
import Module from "./module.jsx";
import { defaultData } from "./helpers.js";

export const moduleDef = {
  id: "chores",
  title: "Chores",
  icon: ClipboardList,
  Component: Module,
  defaultData,
  dependencies: [],
};
