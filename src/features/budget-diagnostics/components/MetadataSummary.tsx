import type { MetadataJson } from "../types";

const EMPTY_VALUE = "—";

type MetadataField = {
  label: string;
  value: string;
};

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return EMPTY_VALUE;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function buildMetadataFields(metadata: MetadataJson | null): MetadataField[] {
  return [
    { label: "Budget name", value: formatMetadataValue(metadata?.budgetName) },
    { label: "Budget ID", value: formatMetadataValue(metadata?.id) },
    { label: "Cloud file ID", value: formatMetadataValue(metadata?.cloudFileId) },
    { label: "Group ID (sync ID)", value: formatMetadataValue(metadata?.groupId) },
    { label: "User ID", value: formatMetadataValue(metadata?.userId) },
    { label: "Last uploaded date", value: formatMetadataValue(metadata?.lastUploaded) },
    {
      label: "Last synced timestamp",
      value: formatMetadataValue(metadata?.lastSyncedTimestamp),
    },
    { label: "Last schedule run", value: formatMetadataValue(metadata?.lastScheduleRun) },
    { label: "Encryption key ID", value: formatMetadataValue(metadata?.encryptKeyId) },
    { label: "Reset clock state", value: formatMetadataValue(metadata?.resetClock) },
  ];
}

export function MetadataSummary({ metadata }: { metadata: MetadataJson | null }) {
  const fields = buildMetadataFields(metadata);

  return (
    <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
      {fields.map((field) => (
        <div key={field.label} className="min-w-0">
          <dt className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {field.label}
          </dt>
          <dd className="mt-1 truncate text-sm text-foreground" title={field.value}>
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
