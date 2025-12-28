import { ClipboardList } from "lucide-react";
import ChoresModule from "./module.jsx";
import { defaultChoresData } from "./helpers.js";

export const moduleDef = {
  id: "chores",
  title: "family chorse",
  icon: ClipboardList,
  Component: ChoresModule,
  defaultData: defaultChoresData,
};
