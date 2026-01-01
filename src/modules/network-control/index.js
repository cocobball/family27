import { Wifi } from "lucide-react";
import Module from "./module.jsx";
import { defaultNetworkControlData } from "./helpers.js";

export const moduleDef = {
  id: "network-control",
  title: "Internet Control",
  icon: Wifi,
  Component: Module,
  defaultData: defaultNetworkControlData,
  dependencies: ["rewards"], // parent lock
};

export default moduleDef;
