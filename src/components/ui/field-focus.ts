/**
 * How a field shows it is the active one, shared by every text box, dropdown
 * trigger and picker: the border turns a soft blue with a faint, narrow halo,
 * the way most web apps (and the browser's own controls) mark focus. A field
 * in error keeps its red, focused or not.
 */
export const FIELD_FOCUS =
  "focus-visible:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-500/15 dark:focus-visible:border-blue-400/70 dark:focus-visible:ring-blue-400/20 aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/20"

/** The same, while a dropdown's list is open, so it is clear which field the list belongs to. */
export const FIELD_OPEN =
  "data-[popup-open]:border-blue-300 data-[popup-open]:ring-2 data-[popup-open]:ring-blue-500/15 aria-expanded:border-blue-300 aria-expanded:ring-2 aria-expanded:ring-blue-500/15 dark:data-[popup-open]:border-blue-400/70 dark:aria-expanded:border-blue-400/70"
