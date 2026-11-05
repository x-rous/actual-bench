/**
 * `try { work } catch { onError } finally { onDone }`, as a function.
 *
 * An async handler inside a component uses it for the clean-up that has to happen whether the work succeeds, fails or returns
 * early. The React Compiler cannot lower a `finally` (or a `throw` written inside a `try`) in the code it compiles, and when it meets
 * one it skips the whole component, which also turns every manual memoization in it into a lint error. Written here, outside any
 * component, the handler reads the same and the component can be compiled.
 *
 * It behaves exactly like the statement: `onError` runs for anything `work` throws (and may be async, or throw itself),
 * `onDone` always runs afterwards, and without `onError` the error goes on to the caller once `onDone` has run.
 */
export async function attempt(
  work: () => Promise<void>,
  handlers: { onError?: (error: unknown) => void | Promise<void>; onDone?: () => void } = {}
): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (!handlers.onError) throw error;
    await handlers.onError(error);
  } finally {
    handlers.onDone?.();
  }
}
