// Importing this module registers every data-type adapter with the unified sync
// engine (each adapter calls registerSyncKindAdapter on import). The
// orchestrators import this for its side effects so dispatch-by-flowType works.
import "./transactionAdapter";
// Master-data (entity) adapters (RD-055).
import "./payeeAdapter";
import "./categoryAdapter";

