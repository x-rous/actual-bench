/**
 * @jest-environment node
 */

describe("test environment", () => {
  it("does not inherit the developer's app database path", () => {
    // Set in the dev container (and possibly a shell) for `next dev`; jest.env.cjs clears it.
    expect(process.env.ACTUAL_BENCH_DB_PATH).toBeUndefined();
  });
});
