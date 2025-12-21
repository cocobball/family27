import { CalendarDays } from "lucide-react";
import CalendarModule from "./module.jsx";
import { defaultCalendarData } from "./helpers.js";

export const moduleDef = {
  id: "calendar",
  title: "Calendar",
  icon: CalendarDays,
  Component: CalendarModule,
  defaultData: defaultCalendarData,
  dependencies: [],
};
