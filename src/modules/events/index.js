import { ListChecks } from "lucide-react";
import EventsModule from "./module.jsx";
import { defaultEventsData } from "./helpers.js";

export const moduleDef = {
  id: "events",
  title: "Events",
  icon: ListChecks,
  Component: EventsModule,
  defaultData: defaultEventsData,
  dependencies: ["calendar"],
};
