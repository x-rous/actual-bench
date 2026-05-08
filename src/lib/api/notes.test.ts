import {
  getAllNotes,
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

  describe("getAllNotes", () => {
    it("returns a map of all note rows keyed by id", async () => {
      const categoryMonthId = "af375fd4-d759-46b3-bffe-74a856151d57-2026-02";
      mockRunQuery.mockResolvedValueOnce({
        data: [
          { id: categoryMonthId, note: "Rent was late this month" },
          { id: "cat-1", note: "Groceries category note" },
          { id: "account-acc-1", note: "Checking account note" },
          { id: "budget-2026-04", note: "April budget note" },
        ],
      });

      const result = await getAllNotes(connection);

      expect(result.get(categoryMonthId)).toBe("Rent was late this month");
      expect(result.get("cat-1")).toBe("Groceries category note");
      expect(result.get("account-acc-1")).toBe("Checking account note");
      expect(result.get("budget-2026-04")).toBe("April budget note");
      expect(result.size).toBe(4);
      expect(mockRunQuery).toHaveBeenCalledWith(connection, {
        ActualQLquery: { table: "notes", select: "*" },
      });
    });

    it("skips rows with an empty note string", async () => {
      mockRunQuery.mockResolvedValueOnce({
        data: [
          { id: "cat-1", note: "Has a note" },
          { id: "cat-2", note: "" },
        ],
      });

      const result = await getAllNotes(connection);

      expect(result.has("cat-1")).toBe(true);
      expect(result.has("cat-2")).toBe(false);
    });

    it("returns an empty map when there are no notes", async () => {
      mockRunQuery.mockResolvedValueOnce({ data: [] });

      const result = await getAllNotes(connection);

      expect(result.size).toBe(0);
    });
  });
});
