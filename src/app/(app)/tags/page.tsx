import type { Metadata } from "next";
import { Tag } from "lucide-react";

export const metadata: Metadata = {
  title: "Tags — Actual Bench",
};

export default function TagsPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Tag className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold">Tags are not available</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The Actual HTTP API does not currently expose a Tags endpoint. This
          page will be enabled once the API adds support for tag management.
        </p>
      </div>
    </div>
  );
}
