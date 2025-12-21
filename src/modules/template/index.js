import { Puzzle } from "lucide-react";
import TemplateModule from "./module.jsx";
import { defaultTemplateData } from "./helpers.js";

// NOTE: This folder is NOT auto-loaded by moduleLoader (it skips /template/).
export const moduleDef = {
  id: "template_DO_NOT_LOAD",
  title: "Template",
  icon: Puzzle,
  Component: TemplateModule,
  defaultData: defaultTemplateData,
};
