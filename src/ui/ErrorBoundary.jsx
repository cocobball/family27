import React from "react";
import { TriangleAlert } from "lucide-react";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-full w-full flex items-center justify-center p-6">
          <div className="glass rounded-3xl p-6 max-w-xl w-full">
            <div className="flex items-center gap-3">
              <TriangleAlert />
              <div className="text-lg font-semibold">Something crashed</div>
            </div>
            <div className="text-sm opacity-80 mt-2 break-words">
              {String(this.state.error?.message ?? this.state.error)}
            </div>
            <div className="text-sm opacity-70 mt-4">
              Open Settings → Diagnostics to view exportable logs.
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
