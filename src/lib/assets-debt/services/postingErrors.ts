/**
 * Errors shared by the server and browser halves of applying a posting
 * (RD-084 P1.6; SC-018). Client-safe: no app-DB imports.
 */

/** Thrown whenever something tries to apply a posting the user has not approved. */
export class PostingNotApproved extends Error {
  constructor(message = "This posting has not been approved by the user, so it cannot be applied.") {
    super(message);
    this.name = "PostingNotApproved";
  }
}
