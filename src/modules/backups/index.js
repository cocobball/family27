// src/modules/backups/index.js
import React from "react";
import { Archive } from "lucide-react";
import BackupsModule from "./module.jsx";

// Backups has no server-backed module_state blob of its own.
// (It reads from /home/masri/backups via the API.)
export function defaultBackupsData() {
  return { version: 1 };
}

export const moduleDef = {
  id: "backups",
  title: "Backups",
  icon: Archive, // optional; lucide-react is fine
  Component: BackupsModule,
  defaultData: defaultBackupsData,
};

export default moduleDef;
