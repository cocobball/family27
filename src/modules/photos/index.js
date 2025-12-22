import { Image as ImageIcon } from "lucide-react";
import Module from "./module.jsx";
import Settings from "./settings.jsx";

export const moduleDef = {
  id: "photos",
  title: "Photos",
  icon: ImageIcon,
  Component: Module,
  SettingsComponent: Settings,
};
