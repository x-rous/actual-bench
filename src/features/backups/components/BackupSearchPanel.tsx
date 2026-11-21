"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClearedStatus, ClearedHeader } from "@/components/ui/cleared-status";
import { DateInput } from "@/components/ui/date-input";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { BackupSearchInput, BackupSearchKind, BackupSearchResult } from "@/lib/backup/search";
import { searchBackup } from "../lib/backupsApi";
import { formatMinorAmount } from "../lib/presentation";

/**
 * Search inside one budget backup (RD-077).
 *
 * The usual reason to open an old copy is one thing that went missing. This
 * finds it in the copy and shows it as it was then, without restoring. The
 * search runs on the server against the copy's own database, so it is run on
 * a button (or Enter), not on every keystroke: each run opens the copy again.
 */

const KIND_OPTIONS: { value: BackupSearchKind; label: string }[] = [
  { value: "transactions", label: "Transactions" },
  { value: "payees", label: "Payees" },
  { value: "categories", label: "Categories" },
  { value: "accounts", label: "Accounts" },
];

const NOUN: Record<BackupSearchKind, string> = {
  transactions: "transactions",
  payees: "payees",
  categories: "categories",
  accounts: "accounts",
};

type Opened = Extract<BackupSearchResult, { opened: true }>;

export function BackupSearchPanel({ artifactId, passphrase }: { artifactId: string; passphrase: string }) {
  const [kind, setKind] = useState<BackupSearchKind>("transactions");
  const [text, setText] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState<BackupSearchResult | null>(null);
  // What the shown result was asked with, so paging repeats it exactly and
  // the empty state knows whether filters were in play.
  const [asked, setAsked] = useState<BackupSearchInput | null>(null);

  const search = useMutation({
    mutationFn: (query: BackupSearchInput) => searchBackup(artifactId, query, passphrase || undefined),
    onSuccess: (value, query) => {
      setResult(value);
      setAsked(query);
    },
  });

  const dated = kind === "transactions";
  function run(event?: FormEvent) {
    event?.preventDefault();
    search.mutate({ kind, text: text.trim(), from: dated ? from || null : null, to: dated ? to || null : null, page: 0 });
  }
  function clearFilters() {
    setText("");
    setFrom("");
    setTo("");
    search.mutate({ kind, text: "", from: null, to: null, page: 0 });
  }

  const opened = result?.opened ? result : null;
  const filtered = !!asked && (!!asked.text || !!asked.from || !!asked.to);

  return (
    <div className="space-y-3">
      <form onSubmit={run} className="flex flex-wrap items-end gap-2" aria-label="Search this backup">
        <Select
          className="h-7 w-36"
          value={kind}
          onValueChange={(value) => setKind(value as BackupSearchKind)}
          aria-label="What to search"
          options={KIND_OPTIONS}
        />
        <SearchInput
          size="sm"
          className="w-64"
          value={text}
          onValueChange={setText}
          aria-label="Search text"
          placeholder={dated ? "Payee, category, account, notes or amount" : "Name"}
        />
        {dated && (
          <>
            <label className="flex items-center gap-1 text-muted-foreground">
              From
              <DateInput size="sm" className="w-32" value={from} onValueChange={setFrom} aria-label="From date" />
            </label>
            <label className="flex items-center gap-1 text-muted-foreground">
              To
              <DateInput size="sm" className="w-32" value={to} onValueChange={setTo} aria-label="To date" />
            </label>
          </>
        )}
        <Button type="submit" size="sm" disabled={search.isPending}>
          {search.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Search aria-hidden />}
          Search
        </Button>
      </form>

      {search.isError && (
        <p role="alert" className="text-destructive">
          {search.error.message}
        </p>
      )}

      {!result && !search.isPending && !search.isError && (
        <p className="text-muted-foreground">
          Search this copy&rsquo;s transactions, payees, categories or accounts as they were when it was
          taken. Leave the box empty to list them all. Rows Actual had already deleted are not included.
        </p>
      )}

      {result && !result.opened && <p className="text-amber-800 dark:text-amber-300">{result.message}</p>}

      {opened && (
        <div className={cn("space-y-2", search.isPending && "opacity-60")} aria-busy={search.isPending}>
          {opened.total === 0 ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              {filtered ? (
                <>
                  <span>No results match your filters</span>
                  <Button size="sm" variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                </>
              ) : (
                <span>This copy has no {NOUN[opened.kind]}.</span>
              )}
            </div>
          ) : (
            <>
              <ResultTable result={opened} />
              <Pager
                result={opened}
                pending={search.isPending}
                onPage={(page) => asked && search.mutate({ ...asked, page })}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Pager({ result, pending, onPage }: { result: Opened; pending: boolean; onPage: (page: number) => void }) {
  const first = result.page * result.pageSize + 1;
  const last = Math.min(result.total, first + result.pageSize - 1);
  const pages = Math.ceil(result.total / result.pageSize);
  return (
    <div className="flex items-center justify-between gap-2 text-muted-foreground">
      <span aria-live="polite">
        {first.toLocaleString()}–{last.toLocaleString()} of {result.total.toLocaleString()} {NOUN[result.kind]}
      </span>
      {pages > 1 && (
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={pending || result.page === 0}
            onClick={() => onPage(result.page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || result.page >= pages - 1}
            onClick={() => onPage(result.page + 1)}
            aria-label="Next page"
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}

function Cell({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <td className={cn("truncate px-2 py-1", className)} title={title}>
      {children}
    </td>
  );
}

function Head({ children, className }: { children: ReactNode; className?: string }) {
  return <th className={cn("px-2 py-1.5 text-left font-medium text-muted-foreground", className)}>{children}</th>;
}

const dash = <span className="text-muted-foreground">-</span>;
const amountClass = "text-right tabular-nums whitespace-nowrap";

function ResultTable({ result }: { result: Opened }) {
  return (
    <div className="max-h-[60vh] overflow-auto rounded-md border border-border">
      <table className="w-full table-fixed border-collapse text-xs">
        {result.kind === "transactions" && (
          <>
            <colgroup>
              <col className="w-24" />
              <col className="w-[16%]" />
              <col className="w-[20%]" />
              <col className="w-[18%]" />
              <col className="w-28" />
              <col className="w-8" />
              <col />
            </colgroup>
            <thead className="sticky top-0 bg-background">
              <tr className="border-b border-border">
                <Head>Date</Head>
                <Head>Account</Head>
                <Head>Payee</Head>
                <Head>Category</Head>
                <Head className="text-right">Amount</Head>
                <Head className="text-center">
                  <ClearedHeader />
                </Head>
                <Head>Notes</Head>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60 last:border-0">
                  <Cell className="tabular-nums">{row.date ?? dash}</Cell>
                  <Cell title={row.account ?? undefined}>{row.account ?? dash}</Cell>
                  <Cell title={row.payee ?? undefined}>{row.payee ?? dash}</Cell>
                  <Cell title={row.split ? `${row.category ?? "Uncategorized"} (line of a split transaction)` : row.category ?? undefined}>
                    {row.category ?? <span className="text-muted-foreground">Uncategorized</span>}
                    {row.split && <span className="text-muted-foreground"> · split</span>}
                  </Cell>
                  <Cell className={amountClass}>{formatMinorAmount(row.amountMinor)}</Cell>
                  <Cell className="text-center">
                    <ClearedStatus cleared={row.cleared} />
                  </Cell>
                  <Cell title={row.notes ?? undefined}>{row.notes ?? dash}</Cell>
                </tr>
              ))}
            </tbody>
          </>
        )}

        {result.kind === "payees" && (
          <>
            <thead className="sticky top-0 bg-background">
              <tr className="border-b border-border">
                <Head>Payee</Head>
                <Head className="w-32 text-right">Transactions</Head>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60 last:border-0">
                  <Cell title={row.name}>{row.name}</Cell>
                  <Cell className={amountClass}>{row.transactions.toLocaleString()}</Cell>
                </tr>
              ))}
            </tbody>
          </>
        )}

        {result.kind === "categories" && (
          <>
            <thead className="sticky top-0 bg-background">
              <tr className="border-b border-border">
                <Head>Category</Head>
                <Head>Group</Head>
                <Head className="w-24">Visibility</Head>
                <Head className="w-32 text-right">Transactions</Head>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60 last:border-0">
                  <Cell title={row.name}>{row.name}</Cell>
                  <Cell title={row.group ?? undefined}>{row.group ?? dash}</Cell>
                  <Cell>{row.hidden ? "Hidden" : "Shown"}</Cell>
                  <Cell className={amountClass}>{row.transactions.toLocaleString()}</Cell>
                </tr>
              ))}
            </tbody>
          </>
        )}

        {result.kind === "accounts" && (
          <>
            <thead className="sticky top-0 bg-background">
              <tr className="border-b border-border">
                <Head>Account</Head>
                <Head className="w-28">Budget</Head>
                <Head className="w-20">Status</Head>
                <Head className="w-28 text-right">Transactions</Head>
                <Head className="w-32 text-right">Balance</Head>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60 last:border-0">
                  <Cell title={row.name}>{row.name}</Cell>
                  <Cell>{row.offBudget ? "Off budget" : "On budget"}</Cell>
                  <Cell>{row.closed ? "Closed" : "Open"}</Cell>
                  <Cell className={amountClass}>{row.transactions.toLocaleString()}</Cell>
                  <Cell className={amountClass}>{formatMinorAmount(row.balanceMinor)}</Cell>
                </tr>
              ))}
            </tbody>
          </>
        )}
      </table>
    </div>
  );
}
