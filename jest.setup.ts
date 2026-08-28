import '@testing-library/jest-dom'
import { configure } from '@testing-library/dom'

// Testing Library's default 1s budget for `findBy*`/`waitFor` is a wall-clock
// budget, and this suite runs several workers doing real SQLite and scrypt work
// side by side. Under that load a query that resolves in 50ms of work can still
// miss a 1s deadline, which shows up as a test that fails in the full run and
// passes on its own — the least useful kind of failure. Five seconds is still
// far below Jest's own timeout, so a genuinely stuck assertion still fails.
configure({ asyncUtilTimeout: 5000 });

// structuredClone is available in Node 17+ but may be missing in some jsdom
// versions. Polyfill it so store tests that use it can run in all environments.
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val));
}