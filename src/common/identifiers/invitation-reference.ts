/**
 * Preview, accept and decline address an invitation by a *reference*: either the
 * raw link token or, for an invitation the caller found in their own inbox, the
 * invitation id.
 *
 * The route schema and the service must classify a reference identically — if
 * they disagree, a reference the route accepts can be routed to the wrong lookup
 * and a valid link answers `404`. Both therefore share these definitions rather
 * than restating the shapes.
 */

/** A raw invitation token: 32 random bytes rendered as base64url. */
export const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const INVITATION_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isInvitationToken(reference: string): boolean {
  return INVITATION_TOKEN_PATTERN.test(reference);
}

export function isInvitationId(reference: string): boolean {
  return INVITATION_ID_PATTERN.test(reference);
}

/** The two forms never overlap, so a reference is classifiable on its own. */
export function isInvitationReference(reference: string): boolean {
  return isInvitationToken(reference) || isInvitationId(reference);
}
