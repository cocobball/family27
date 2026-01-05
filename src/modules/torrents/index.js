import { Download } from "lucide-react";
import Module from "./module.jsx";
import TorrentsSettings from "./settings.jsx";
import { defaultData } from "./helpers.js";

export const moduleDef = {
  id: "torrents",
  title: "Torrents",
  icon: Download,
  Component: Module,
  SettingsComponent: TorrentsSettings,
  defaultData,
  dependencies: [],
};
