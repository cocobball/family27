import { StickyNote } from "lucide-react";
import Module from "./module.jsx";
import { defaultData } from "./helpers.js";

export const moduleDef = {
  id: "notes",
  title: "Notes",
  icon: StickyNote,
  Component: Module,
  defaultData,
  dependencies: [],
};
