/**
 * Source-pinning tests for the Actual payee semantics RD-078 depends on.
 *
 * RD-078 §28 (Milestone 0) requires the native behavior to be verified before
 * any write path is designed, and §31 says "if any answer is unknown, do not
 * guess." The verification was done against the pinned `@actual-app/core` and
 * `@actual-app/api` sources; these tests pin the *structural* findings so an
 * upstream bump that invalidates them fails here instead of silently changing
 * what cleanup promises the user.
 *
 * Scope note: this repo has no live-Actual integration harness (jsdom + mocks
 * only), so the *behavioral* findings — merge tombstones sources, transactions
 * follow through `payee_mapping`, rules are not rewritten, Bench's orphan
 * predicate matches Actual's — are verified by hand against the dev server and
 * recorded in `agents/knowledge.md`. What can be asserted mechanically is
 * asserted here.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reads a source file straight out of the installed package.
 *
 * `require.resolve` is not usable here — Jest's resolver honours the package's
 * `exports` map, which does not publish these internal paths.
 */
function readPackageSource(pkg: string, relativePath: string): string {
  const path = join(process.cwd(), "node_modules", pkg, relativePath);
  if (!existsSync(path)) {
    throw new Error(
      `Cannot pin Actual payee semantics: ${pkg}/${relativePath} is missing. ` +
        `The upstream layout changed — re-run RD-078's Milestone 0 verification ` +
        `(see agents/pr-specs/PR-041) before trusting the cleanup capability report.`
    );
  }
  return readFileSync(path, "utf8");
}

/**
 * Slices between two markers, failing loudly when either is missing.
 *
 * These tests exist to pin upstream behaviour, and every assertion in the sliced
 * region is a `not.toContain`. A renamed marker makes `indexOf` return -1, the
 * slice comes back empty or wrong, and the negative assertions all pass for the
 * wrong reason — the exact failure mode pinning tests are supposed to prevent.
 */
function sliceBetween(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  const end = source.indexOf(to);
  if (start === -1) throw new Error(`Upstream marker not found: ${from}`);
  if (end === -1) throw new Error(`Upstream marker not found: ${to}`);
  if (end <= start) {
    throw new Error(`Upstream markers out of order: ${from} / ${to}`);
  }
  return source.slice(start, end);
}

describe("Actual native payee semantics (pinned)", () => {
  describe("the public payee model", () => {
    const apiModels = readPackageSource(
      "@actual-app/core",
      "src/server/api-models.ts"
    );

    it("exposes only id, name and transfer_acct — so favorite/learn_categories cannot be written", () => {
      // `updatePayee` takes Partial<APIPayeeEntity>. If this widens upstream,
      // `writePayeeBehaviorFields` in lib/capabilities.ts can become true and
      // RD-078 §10.3's "proposed final behavior" editor becomes buildable.
      expect(apiModels).toContain(
        "export type APIPayeeEntity = Pick<PayeeEntity, 'id' | 'name' | 'transfer_acct'>"
      );
    });

    it("drops `category` when converting a payee to its external shape", () => {
      // Bench's `Payee.categoryId` and `ApiPayee.category` are vestigial (F-095):
      // actual-http-api still declares `category` in its schema, but upstream
      // never populates it.
      const toExternal = sliceBetween(
        apiModels,
        "export const payeeModel",
        "export type APITagEntity"
      );
      expect(toExternal).toContain("id: payee.id");
      expect(toExternal).toContain("name: payee.name");
      expect(toExternal).toContain("transfer_acct: payee.transfer_acct");
      expect(toExternal).not.toContain("category:");
    });
  });

  describe("the internal payee entity", () => {
    const payeeModel = readPackageSource(
      "@actual-app/core",
      "src/types/models/payee.ts"
    );

    it("carries favorite, learn_categories and tombstone but no category", () => {
      expect(payeeModel).toContain("favorite?: boolean");
      expect(payeeModel).toContain("learn_categories?: boolean");
      expect(payeeModel).toContain("tombstone?: boolean");
      expect(payeeModel).not.toContain("category");
    });
  });

  describe("the AQL payees schema", () => {
    const schema = readPackageSource(
      "@actual-app/core",
      "src/server/aql/schema/index.ts"
    );
    const payeesTable = sliceBetween(schema, "  payees: {", "  accounts: {");

    it("exposes the fields cleanup reads over ActualQL", () => {
      // This is what makes `getPayeeCleanupMetadata` work in BOTH transports.
      // If a field disappears here, the metadata read must be revisited before
      // detection can rely on it.
      expect(payeesTable).toContain("favorite: f('boolean')");
      expect(payeesTable).toContain("learn_categories: f('boolean')");
      expect(payeesTable).toContain("tombstone: f('boolean')");
      expect(payeesTable).toContain("transfer_acct: f('id'");
    });

    it("does not expose a category field", () => {
      expect(payeesTable).not.toContain("category");
    });
  });

  describe("native merge", () => {
    const db = readPackageSource("@actual-app/core", "src/server/db/index.ts");
    const mergePayees = sliceBetween(
      db,
      "export async function mergePayees",
      "export function getPayees()"
    );

    it("no-ops when the target is a transfer payee", () => {
      // Why the eligibility boundary must reject transfer payees *before*
      // planning: a merge into a transfer payee reports success and does
      // nothing at all.
      expect(mergePayees).toContain("if (payees[target].transfer_acct != null)");
      expect(mergePayees).toContain("return;");
    });

    it("silently drops transfer payees from the source list", () => {
      expect(mergePayees).toContain(
        "ids = ids.filter(id => payees[id].transfer_acct == null)"
      );
    });

    it("works by repointing payee_mapping and tombstoning the sources", () => {
      // Transactions are NOT rewritten — they resolve through payee_mapping —
      // which is why RD-078 §1.5 forbids reimplementing merge as
      // reassign/rename/delete.
      expect(mergePayees).toContain("payee_mapping");
      expect(mergePayees).toContain("delete_('payees', id)");
    });

    it("does not touch the rules table", () => {
      // Rule conditions keep the old payee id and resolve through the mapping,
      // so cleanup must not claim a merge repoints rules.
      expect(mergePayees).not.toContain("'rules'");
    });

    it("does not reassign payee locations", () => {
      // Basis for `readPayeeLocations: false` and the documented limitation.
      expect(mergePayees).not.toContain("payee_locations");
    });
  });

  describe("transactions resolve payees through payee_mapping", () => {
    const schema = readPackageSource(
      "@actual-app/core",
      "src/server/aql/schema/index.ts"
    );

    it("maps the transaction payee to pm.targetId", () => {
      expect(schema).toContain("payee: 'pm.targetId'");
      expect(schema).toContain("LEFT JOIN payee_mapping pm ON pm.id = _.description");
    });
  });

  describe("the native orphan predicate", () => {
    const db = readPackageSource("@actual-app/core", "src/server/db/index.ts");
    const query = sliceBetween(
      db,
      "const orphanedPayeesQuery",
      "export function syncGetOrphanedPayees"
    );

    it("excludes tombstoned and transfer payees", () => {
      expect(query).toContain("p.tombstone = 0");
      expect(query).toContain("p.transfer_acct IS NULL");
    });

    it("requires no alive transaction via the payee mapping", () => {
      expect(query).toContain("LEFT JOIN payee_mapping pm ON pm.id = p.id");
      expect(query).toContain("v_transactions_internal_alive t ON t.payee = pm.targetId");
      expect(query).toContain("t.id IS NULL");
    });

    it("only checks rule CONDITIONS on the payee field", () => {
      // Bench's reimplementation also counts rule *actions* and the
      // `imported_payee` field, making it strictly more conservative. That
      // divergence is deliberate for a deletion workflow and is surfaced in the
      // UI copy (see explainMissingCapability('nativeOrphanHandler')).
      expect(query).toContain("json_extract(cond.value, '$.field') = 'description'");
      expect(query).not.toContain("r.actions");
    });
  });

  describe("payee rule counts", () => {
    const payeesApp = readPackageSource(
      "@actual-app/core",
      "src/server/payees/app.ts"
    );

    it("excludes rules belonging to completed schedules", () => {
      // Basis for 041c splitting regular / active-schedule / completed-schedule
      // rules instead of one flat count.
      expect(payeesApp).toContain("getCompletedScheduleRuleIds");
      expect(payeesApp).toContain("completedScheduleRules.has(rule.id)");
    });

    it("keeps orphan and location handlers internal to `send` (no public API)", () => {
      // Basis for `nativeOrphanHandler: false` in HTTP mode and
      // `readPayeeLocations: false` everywhere.
      expect(payeesApp).toContain("'payees-get-orphaned'");
      expect(payeesApp).toContain("'payee-locations-get'");
    });
  });
});
