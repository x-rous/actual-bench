import { uniqueCopyName } from "./scheduleNames";

it("names a duplicated schedule so Actual accepts it", () => {
  expect(uniqueCopyName("Rent", ["Rent"])).toBe("Rent (copy)");
  expect(uniqueCopyName("Rent", ["Rent", "rent (COPY)"])).toBe("Rent (copy 2)");
  expect(uniqueCopyName(" Rent ", ["Rent", "Rent (copy)", "Rent (copy 2)"])).toBe("Rent (copy 3)");
});
