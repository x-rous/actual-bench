export type WorkbenchTab = "overview" | "diagnostics" | "data";

/*
 * Data Browser summary placeholder for the later Data Browser milestone.
 *
 * The Overview and Diagnostics summary bars are intentionally not rendered.
 * Diagnostics run state and integrity status live in DiagnosticsSummaryCards.
 *
 * When M6a/M6b add schema object state, the Data Browser can reintroduce a
 * compact toolbar/summary using roughly this shape:
 *
 * type DataBrowserSummary = {
 *   schemaObjectCount: number | null;
 *   featuredViewsReady: boolean;
 *   selectedObject: string | null;
 *   selectedObjectRowCount: number | null;
 * };
 *
 * function buildDataBrowserSummary(summary: DataBrowserSummary) {
 *   return [
 *     { label: "Schema objects", value: summary.schemaObjectCount ?? "Not loaded" },
 *     { label: "Featured views", value: summary.featuredViewsReady ? "Ready" : "Not loaded" },
 *     { label: "Selected object", value: summary.selectedObject ?? "None yet" },
 *     { label: "Rows", value: summary.selectedObjectRowCount ?? "Not loaded" },
 *   ];
 * }
 */
