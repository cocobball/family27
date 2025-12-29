import { GraduationCap } from "lucide-react";
import QuizzesModule from "./module.jsx";
import { defaultQuizzesData } from "./helpers.js";

export const moduleDef = {
  id: "quizzes",
  title: "Quizzes",
  icon: GraduationCap,
  Component: QuizzesModule,
  defaultData: defaultQuizzesData,
  dependencies: ["rewards"], // keep existing dependency
};
