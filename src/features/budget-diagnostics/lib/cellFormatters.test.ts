import {
  binaryHexPreview,
  formatCellDisplay,
  rawCellTitle,
  stringifyRowForClipboard,
} from "./cellFormatters";

describe("cellFormatters", () => {
  it("formats valid and invalid date integers with raw titles", () => {
    expect(formatCellDisplay("date", 20260421)).toEqual({
      text: "2026-04-21",
      title: "20260421",
      kind: "date",
    });
    expect(formatCellDisplay("date", 0)).toEqual({
      text: "—",
      title: "0",
      kind: "date",
    });
    expect(formatCellDisplay("posted_date", 20260230)).toEqual({
      text: "—",
      title: "20260230",
      kind: "date",
    });
  });

  it("formats budget month integers where the column is month-like", () => {
    expect(formatCellDisplay("month", 202604)).toEqual({
      text: "Apr 2026",
      title: "202604",
      kind: "month",
    });
  });

  it("formats boolean-ish integer columns compactly", () => {
    expect(formatCellDisplay("is_parent", 1)).toEqual({
      text: "Yes",
      title: "1",
      kind: "boolean",
    });
    expect(formatCellDisplay("tombstone", 0)).toEqual({
      text: "No",
      title: "0",
      kind: "boolean",
    });
  });

  it("keeps money-like integers raw and numeric", () => {
    expect(formatCellDisplay("amount", -12345)).toEqual({
      text: "-12345",
      title: "-12345",
      kind: "number",
    });
  });

  it("renders binary values with a size label and hex title", () => {
    const value = new Uint8Array([0, 1, 15, 16, 255]);

    expect(formatCellDisplay("value", value)).toEqual({
      text: "<binary, 5 bytes>",
      title: "hex: 00 01 0f 10 ff",
      kind: "binary",
    });
    expect(rawCellTitle(value)).toBe("hex: 00 01 0f 10 ff");
    expect(binaryHexPreview(value, 3)).toBe("00 01 0f");
  });

  it("serializes binary fields as base64 for row JSON copy", () => {
    expect(
      stringifyRowForClipboard({
        id: "row-1",
        value: new Uint8Array([65, 66, 67]),
      })
    ).toBe('{\n  "id": "row-1",\n  "value": {\n    "$base64": "QUJD"\n  }\n}');
  });
});
