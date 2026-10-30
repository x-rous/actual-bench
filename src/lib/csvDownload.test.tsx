import { downloadCsv } from "./csv";

it("can prefix a CSV with a UTF-8 BOM for spreadsheets while keeping Unicode text", async () => {
  const originalCreate = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const originalRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  const create = jest.fn((blob: Blob) => { expect(blob).toBeInstanceOf(Blob); return "blob:test"; });
  const revoke = jest.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
  const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  try {
    downloadCsv("loan.csv", [["Yr 1 · Mo 1", "2–13"]], { includeBom: true });
    const blob = create.mock.calls[0][0] as Blob;
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(Buffer.from(bytes.slice(3)).toString("utf8")).toBe("Yr 1 · Mo 1,2–13");
    expect(revoke).toHaveBeenCalledWith("blob:test");
  } finally {
    click.mockRestore();
    if (originalCreate) Object.defineProperty(URL, "createObjectURL", originalCreate); else Reflect.deleteProperty(URL, "createObjectURL");
    if (originalRevoke) Object.defineProperty(URL, "revokeObjectURL", originalRevoke); else Reflect.deleteProperty(URL, "revokeObjectURL");
  }
});
