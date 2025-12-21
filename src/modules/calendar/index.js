// src/modules/calendar/index.js
import { CalendarDays } from "lucide-react";
import CalendarModule from "./module.jsx";
import CalendarSettings from "./settings.jsx";
import { defaultCalendarData } from "./helpers.js";

export const moduleDef = {
  id: "calendar",
  title: "Calendar",
  icon: CalendarDays,
  Component: CalendarModule,
  SettingsComponent: CalendarSettings,
  defaultData: defaultCalendarData,
  dependencies: [],
};
