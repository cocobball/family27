import { Wifi } from "lucide-react";
import NetworkModule from "./module.jsx";
import { defaultNetworkData } from "./helpers.js";

export const moduleDef = {
  id: "network",
  title: "Network",
  icon: Wifi,
  Component: NetworkModule,
  defaultData: defaultNetworkData,
  dependencies: [],
};
