import {
  getAccountNote,
  getCategoryLikeNote,
  getNotesIndex,
  parseNotesIndexIds,
  toAccountNoteId,
  toBudgetNoteId,
} from "./notes";
import type { ConnectionInstance } from "@/store/connection";

jest.mock("./client", () => ({
  apiRequest: jest.fn(),
}));

jest.mock("./query", () => ({
  runQuery: jest.fn(),
}));

import { apiRequest } from "./client";
import { runQuery } from "./query";

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;
const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const connection: ConnectionInstance = {
  id: "conn-1",
  label: "Test",
  baseUrl: "http://localhost:5006",
  apiKey: "test-key",
  budgetSyncId: "budget-1",
};

describe("notes api helpers", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    mockRunQuery.mockReset();
  });

  it("parses account, raw entity, and budget note ids", () => {
    expect(
      parseNotesIndexIds([
        "account-a1",
        "cat-1",
        "group-1",
        "budget-2026-04",
        "account-a1",
      ])
    ).toEqual({
      accountIdsWithNotes: ["a1"],
      rawEntityIdsWithNotes: ["cat-1", "group-1"],
      budgetMonthsWithNotes: ["2026-04"],
    });
  });

  it("builds account and budget note ids", () => {
    expect(toAccountNoteId("acc-1")).toBe("account-acc-1");
    expect(toBudgetNoteId("2026-04")).toBe("budget-2026-04");
  });

  it("loads and parses the notes index via ActualQL", async () => {
    mockRunQuery.mockResolvedValueOnce({
      data: [
        { id: "account-acc-1" },
        { id: "cat-1" },
        { id: "group-1" },
        { id: "budget-2026-04" },
      ],
    });

    await expect(getNotesIndex(connection)).resolves.toEqual({
      accountIdsWithNotes: ["acc-1"],
      rawEntityIdsWithNotes: ["cat-1", "group-1"],
      budgetMonthsWithNotes: ["2026-04"],
    });

    expect(mockRunQuery).toHaveBeenCalledWith(connection, {
      ActualQLquery: {
        table: "notes",
        select: "id",
      },
    });
  });

  it("loads an account note from the account endpoint", async () => {
    mockApiRequest.mockResolvedValueOnce({ data: { note: "Account note" } });

    await expect(getAccountNote(connection, "acc-1")).resolves.toBe("Account note");
    expect(mockApiRequest).toHaveBeenCalledWith(
      connection,
      "/notes/account/acc-1"
    );
  });

  it("loads a category-like note from the category endpoint", async () => {
    mockApiRequest.mockResolvedValueOnce({ note: "Category note" });

    await expect(getCategoryLikeNote(connection, "cat-1")).resolves.toBe("Category note");
    expect(mockApiRequest).toHaveBeenCalledWith(
      connection,
      "/notes/category/cat-1"
    );
  });

  it("handles note payloads returned as plain strings", async () => {
    mockApiRequest.mockResolvedValueOnce("Plain note");
    await expect(getCategoryLikeNote(connection, "group-1")).resolves.toBe("Plain note");
  });

  it("returns an empty string for malformed note payloads", async () => {
    mockApiRequest.mockResolvedValueOnce({ data: { value: 123 } });
    await expect(getAccountNote(connection, "acc-1")).resolves.toBe("");
  });
});
