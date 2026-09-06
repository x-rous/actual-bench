import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DestinationDialog } from "./DestinationDialog";
import * as api from "../lib/backupsApi";
import type { BackupDestination } from "@/lib/app-db/backupRepository";

jest.mock("../lib/backupsApi");
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn(), info: jest.fn() },
}));

const mockedApi = api as jest.Mocked<typeof api>;

/**
 * A destination that does not work must not be saved (RD-077).
 *
 * The order used to be create-then-test, so a folder Bench cannot write to was
 * stored anyway and the failure came back as a warning. That is the worst shape
 * for a backup destination: it looks configured, it counts towards "your copies
 * are in two places", and it does nothing until the night it is needed.
 */
describe("adding a folder as a backup destination", () => {
  const onSaved = jest.fn();

  function renderDialog() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DestinationDialog open onOpenChange={() => {}} onSaved={onSaved} />
      </QueryClientProvider>
    );
  }

  function fillIn(name: string, path: string) {
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: name } });
    fireEvent.change(screen.getByLabelText(/path|folder/i), { target: { value: path } });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.createDestination.mockResolvedValue({ id: "dest-1" } as BackupDestination);
    mockedApi.testDestination.mockResolvedValue({
      ok: true,
      checks: [{ name: "Write", status: "pass", detail: "Wrote and read back." }],
    } as Awaited<ReturnType<typeof api.testDestination>>);
  });

  it("refuses to save a folder it cannot write to, and says why", async () => {
    mockedApi.inspectPath.mockResolvedValue({
      checks: [
        { name: "Path", status: "pass", detail: "/mnt/nas exists." },
        {
          name: "Writable",
          status: "fail",
          detail: "Bench cannot write here. Check the volume's ownership and permissions.",
        },
      ],
      facts: { location: "/mnt/nas" },
    } as Awaited<ReturnType<typeof api.inspectPath>>);

    renderDialog();
    fillIn("NAS volume", "/mnt/nas");
    fireEvent.click(screen.getByRole("button", { name: /add and test/i }));

    // The reason is on screen...
    expect(await screen.findByText(/cannot write here/i)).toBeInTheDocument();
    // ...and nothing was written to the database.
    expect(mockedApi.createDestination).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("saves a folder that passes, and tests it on the way", async () => {
    mockedApi.inspectPath.mockResolvedValue({
      checks: [
        { name: "Path", status: "pass", detail: "Created /mnt/backups." },
        { name: "Writable", status: "pass", detail: "Bench can write here." },
      ],
      facts: { location: "/mnt/backups" },
    } as Awaited<ReturnType<typeof api.inspectPath>>);

    renderDialog();
    fillIn("Backups", "/mnt/backups");
    fireEvent.click(screen.getByRole("button", { name: /add and test/i }));

    await waitFor(() => expect(mockedApi.createDestination).toHaveBeenCalledTimes(1));
    // Still tested after saving: the folder being usable is not the same claim
    // as bytes having made the round trip.
    expect(mockedApi.testDestination).toHaveBeenCalledWith("dest-1");
    expect(onSaved).toHaveBeenCalled();
  });

  it("does not refuse a warning, only a failure", async () => {
    // A folder on the same disk as Bench's own data is a warning, not a
    // refusal: /data/backups is a common and legitimate arrangement that simply
    // is not off-site.
    mockedApi.inspectPath.mockResolvedValue({
      checks: [
        { name: "Path", status: "pass", detail: "/data/backups exists." },
        { name: "Same disk", status: "warn", detail: "This is the disk Bench's data is on." },
      ],
      facts: { location: "/data/backups" },
    } as Awaited<ReturnType<typeof api.inspectPath>>);

    renderDialog();
    fillIn("Local", "/data/backups");
    fireEvent.click(screen.getByRole("button", { name: /add and test/i }));

    await waitFor(() => expect(mockedApi.createDestination).toHaveBeenCalledTimes(1));
  });
});
