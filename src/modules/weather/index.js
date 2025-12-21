import { CloudSun } from "lucide-react";
import Module from "./module.jsx";
import { defaultData } from "./helpers.js";

export const moduleDef = {
  id: "weather",
  title: "Weather",
  icon: CloudSun,
  Component: Module,
  defaultData,
  dependencies: [],
};
