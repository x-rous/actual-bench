"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { selectActiveInstance, useConnectionStore, isHttpApiConnection } from "@/store/connection";
import { exportSnapshot } from "../lib/exportSnapshot";
import {
  getSqliteWorkerClient,
  isSqliteWorkerLoadedFor,
  markSqliteWorkerLoaded,
  resetSqliteWorkerClient,
} from "../lib/sqliteWorkerClient";
import {
  connectionSignature,
  useDiagnosticsCacheStore,
} from "../store/diagnosticsCache";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "Unable to open the budget snapshot.";
}

/**
 * Loads — or reuses — the Budget Diagnostics snapshot for the active connection.
 *
 * Shared by the diagnostics workbench and the standalone Data Browser so both
 * hit the same cache + sqlite worker: the first visit downloads and opens the
 * budget export, and later visits reuse it instantly until an explicit Reload,
 * a connection change, or disconnect. The snapshot itself lives in the
 * module-level cache store (so it survives navigation); this hook owns the load
 * lifecycle and the integrity-check / reload actions.
 */
export function useDiagnosticsSnapshot() {
  const connection = useConnectionStore(selectActiveInstance);
  const httpConnection = isHttpApiConnection(connection) ? connection : null;
  const [reloadToken, setReloadToken] = useState(0);
  const snapshot = useDiagnosticsCacheStore((s) => s.snapshot);
  const setSnapshot = useDiagnosticsCacheStore((s) => s.setSnapshot);
  const loadedAt = useDiagnosticsCacheStore((s) => s.loadedAt);
  const integrityRunGeneration = useRef(0);

  const retry = useCallback(() => {
    // Force a fresh export: drop the cached snapshot and the loaded worker DB,
    // then bump the token to re-run the load effect.
    resetSqliteWorkerClient();
    useDiagnosticsCacheStore.getState().reset();
    setReloadToken((value) => value + 1);
  }, []);

  const runIntegrityCheck = useCallback(() => {
    async function run() {
      const generation = ++integrityRunGeneration.current;
      const isCurrentRun = () => integrityRunGeneration.current === generation;

      setSnapshot((current) => ({
        ...current,
        integrityStatus: "loading",
        integrityError: null,
      }));

      try {
        const payload = await getSqliteWorkerClient().call(
          { kind: "runIntegrityCheck" },
          {
            timeoutMs: null,
            onProgress: (stage) => {
              if (isCurrentRun()) {
                setSnapshot((current) => ({ ...current, progressStage: stage }));
              }
            },
          }
        );
        if (!isCurrentRun()) return;
        setSnapshot((current) => {
          const existing = current.diagnostics?.findings ?? [];
          const withoutIntegrity = existing.filter(
            (finding) => finding.code !== "SQLITE_INTEGRITY_CHECK"
          );
          return {
            ...current,
            integrityStatus: "idle",
            integrityError: null,
            progressStage: "ready",
            diagnostics: {
              findings: [...withoutIntegrity, ...payload.findings],
            },
          };
        });
      } catch (error) {
        if (!isCurrentRun()) return;
        setSnapshot((current) => ({
          ...current,
          integrityStatus: "error",
          integrityError: getErrorMessage(error),
          progressStage: "ready",
        }));
      }
    }

    void run();
  }, [setSnapshot]);

  useEffect(() => {
    if (!httpConnection) {
      integrityRunGeneration.current += 1;
      resetSqliteWorkerClient();
      useDiagnosticsCacheStore.getState().reset();
      return;
    }

    // Cache hit: the worker still holds this connection's DB and we already have
    // a ready snapshot — reuse it instead of re-downloading. Reload, connection
    // change, and disconnect all clear the cache, so a stale snapshot can't stick.
    const cache = useDiagnosticsCacheStore.getState();
    if (
      cache.signature === connectionSignature(httpConnection) &&
      cache.snapshot.status === "ready" &&
      cache.snapshot.diagnosticsStatus !== "loading" &&
      isSqliteWorkerLoadedFor(httpConnection.id)
    ) {
      return;
    }

    let cancelled = false;
    const activeConnection = httpConnection;

    // Stamp the cache as reusable. Called only once diagnostics has reached a
    // terminal state (ready or error) — never mid-load — so an interrupted load
    // can't be short-circuited on return and leave the tab stuck loading.
    const commitCache = () =>
      useDiagnosticsCacheStore
        .getState()
        .commitLoaded(activeConnection.id, connectionSignature(activeConnection));

    async function openSnapshot() {
      integrityRunGeneration.current += 1;
      resetSqliteWorkerClient();
      setSnapshot({
        status: "loading",
        diagnosticsStatus: "idle",
        integrityStatus: "idle",
        progressStage: "exporting",
        errorMessage: null,
        diagnosticsError: null,
        integrityError: null,
        overview: null,
        diagnostics: null,
        download: null,
      });

      try {
        const exported = await exportSnapshot(activeConnection, (stage) => {
          if (!cancelled) {
            setSnapshot((current) => ({ ...current, progressStage: stage }));
          }
        });
        if (cancelled) return;
        // Worker now holds this connection's DB — record it so a later visit
        // (or the standalone Data Browser) can reuse it without re-exporting.
        markSqliteWorkerLoaded(activeConnection.id);
        const overview = await getSqliteWorkerClient().call(
          { kind: "overview" },
          {
            onProgress: (stage) => {
              if (!cancelled) {
                setSnapshot((current) => ({ ...current, progressStage: stage }));
              }
            },
          }
        );

        if (cancelled) return;

        setSnapshot({
          status: "ready",
          diagnosticsStatus: "loading",
          integrityStatus: "idle",
          progressStage: "ready",
          errorMessage: null,
          diagnosticsError: null,
          integrityError: null,
          overview,
          diagnostics: null,
          download: exported.download,
        });

        try {
          const diagnostics = await getSqliteWorkerClient().call(
            { kind: "runDiagnostics" },
            {
              onProgress: (stage) => {
                if (!cancelled) {
                  setSnapshot((current) => ({ ...current, progressStage: stage }));
                }
              },
            }
          );

          if (cancelled) return;

          setSnapshot((current) => ({
            ...current,
            diagnosticsStatus: "ready",
            diagnosticsError: null,
            progressStage: "ready",
            diagnostics,
          }));
          commitCache();
        } catch (error) {
          if (cancelled) return;
          setSnapshot((current) => ({
            ...current,
            diagnosticsStatus: "error",
            diagnosticsError: getErrorMessage(error),
            progressStage: "ready",
          }));
          // Diagnostics failed but the snapshot is still usable (overview + DB
          // loaded), so mark it reusable — the error surfaces on the Diagnostics
          // tab and Reload re-runs everything.
          commitCache();
        }
      } catch (error) {
        if (cancelled) return;
        setSnapshot({
          status: "error",
          diagnosticsStatus: "idle",
          integrityStatus: "idle",
          progressStage: null,
          errorMessage: getErrorMessage(error),
          diagnosticsError: null,
          integrityError: null,
          overview: null,
          diagnostics: null,
          download: null,
        });
      }
    }

    void openSnapshot();

    return () => {
      cancelled = true;
      integrityRunGeneration.current += 1;
      // Intentionally do NOT reset the worker here — keep the loaded DB alive so
      // returning to this page (or opening the Data Browser) reuses it without a
      // re-download. The worker is reset on explicit Reload, connection change,
      // or disconnect instead.
    };
  }, [
    httpConnection,
    httpConnection?.apiKey,
    httpConnection?.baseUrl,
    httpConnection?.budgetSyncId,
    httpConnection?.encryptionPassword,
    httpConnection?.id,
    reloadToken,
    setSnapshot,
  ]);

  return { connection: httpConnection, snapshot, loadedAt, retry, runIntegrityCheck } as const;
}
