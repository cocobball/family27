import { ClipboardList } from "lucide-react";
import ChoresModule from "./module.jsx";
import { defaultChoresData } from "./helpers.js";

export const moduleDef = {
  id: "chores",
  title: "Chores",
  icon: ClipboardList,
  Component: ChoresModule,
  defaultData: defaultChoresData,
  // no declared dependencies
};
