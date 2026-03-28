import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Schedules — Actual Bench",
};

export default function SchedulesPage() {
  return (
    <div className="flex flex-1 flex-col p-6">
      <h1 className="text-xl font-semibold mb-1">Schedules</h1>
      <p className="text-sm text-muted-foreground mb-3">
        Schedule management is not yet implemented.
      </p>
      <p className="text-sm text-muted-foreground">
        Interested in contributing?{" "}
        <a
          href="https://github.com/x-rous/actual-admin-panel/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline-offset-4 hover:underline"
        >
          Open an issue or pull request on GitHub.
        </a>
      </p>
    </div>
  );
}
