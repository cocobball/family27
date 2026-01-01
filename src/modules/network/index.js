import { Wifi } from "lucide-react";
import Module from "./module.jsx";
import { defaultNetworkData } from "./helpers.js";

export const moduleDef = {
  id: "network",
  title: "family network",
  icon: Wifi,
  Component: Module,
  defaultData: defaultNetworkData,
  dependencies: ["rewards"], // parent lock
};

export default moduleDef;
