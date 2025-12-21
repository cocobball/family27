import React from "react";

export default function TemplateModule({ ctx }) {
  return (
    <div className="space-y-3">
      <div className="text-lg font-semibold">Template Module</div>
      <div className="text-sm opacity-80">
        Copy this folder to create new modules: src/modules/&lt;yourId&gt;/
      </div>
    </div>
  );
}
