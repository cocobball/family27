import { Images } from "lucide-react";
import Module from "./module.jsx";
import { defaultData } from "./helpers.js";

export const moduleDef = {
  id: "photos",
  title: "Photos",
  icon: Images,
  Component: Module,
  defaultData,
  dependencies: [],
};
