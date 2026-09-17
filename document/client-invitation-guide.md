# Client guide: invitations by public user id

Audience: the RoomScan mobile client team. This guide describes how to consume
the invitation surface after invitations became addressable by public user id.

[API conventions](api-conventions.md) remains the source of truth for the HTTP
contract; `/api-doc.json` is its machine-readable form. This guide only explains
how a client uses that contract and what must change on the client side.

## Why this changed

The app only signs in with Apple, and Apple's Hide My Email hands the account a
`@privaterelay.appleid.com` address instead of the user's real one. An Owner
inviting `tham@gmail.com` produced an invitation the signed-in account could
never match, so opening the link returned `403 INVITATION_NOT_FOR_USER` —
surfaced in the app as "Access Denied – You do not have permission to access
this item".

The address an Owner types has no relationship to the account the recipient
signs in with, so the server no longer compares them. Instead an invitation can
be addressed to a **public user id**, which binds it to a real account.

## The public user id

Every user has a `publicUserId`: ten characters over the alphabet
`23456789ABCDEFGHJKMNPQRSTVWXYZ`. It omits `0`, `1`, `I`, `L`, `O`, and `U` so
it survives being read aloud or retyped. Example: `GP5HS2WKBE`.

- Stored and returned uppercase.
- Accepted in either case on input; the server normalizes it.
- Never changes for a user.
- Safe to display, copy, and share — it is an address, not a secret.

## Two ways to address an invitation

|                                       | `recipientPublicUserId` | `recipientEmail`                    |
| ------------------------------------- | ----------------------- | ----------------------------------- |
| Binds to an account                   | Yes                     | No                                  |
| Who can accept                        | Only that user          | Any signed-in user holding the link |
| Works if recipient has no account yet | No                      | Yes                                 |
| Appears in recipient's in-app list    | Yes                     | No                                  |
| Survives Hide My Email                | Yes                     | Yes                                 |

Prefer `recipientPublicUserId` in the UI. Keep `recipientEmail` as the option
for inviting somebody who has not installed the app yet.

An email-addressed invitation is **bearer-style**: whoever holds the raw token
and is signed in may accept it, exactly as generic share links already behave.
Do not build UI that promises an email invitation is restricted to one person.

## Flow 1 — show the user their own id

`GET /api/v1/users/me`

```json
{
  "publicUserId": "GP5HS2WKBE",
  "email": "user@example.com",
  "displayName": null
}
```

`publicUserId` is always present. `PATCH /api/v1/users/me` and
`POST /api/v1/auth/apple` also return it (the latter inside `user`).

Put it on the profile screen with a copy action. A user cannot be invited by id
until they can read their own id.

## Flow 2 — invite somebody

`POST /api/v1/projects/:projectId/invitations` (requires an `Idempotency-Key`
header) or `POST /api/v1/scans/:scanId/invitations` (no idempotency header).

Send **exactly one** recipient field:

```json
{ "recipientPublicUserId": "GP5HS2WKBE", "expiresInSeconds": 604800 }
```

```json
{ "recipientEmail": "recipient@example.com" }
```

Sending both, or neither, is `400 VALIDATION_ERROR`. `expiresInSeconds` is
optional (60 … 2592000).

Response `201`:

```json
{
  "invitationId": "b1a2c3d4-e5f6-4890-abcd-ef1234567890",
  "invitationUrl": "https://invite.roomscan.dev/invitations/<token>?scope=project",
  "recipientEmail": null,
  "recipientPublicUserId": "GP5HS2WKBE",
  "expiresAt": "2026-08-05T10:00:00.000Z",
  "status": "PENDING",
  "sentAt": "2026-07-29T10:00:00.000Z"
}
```

Exactly one of `recipientEmail` and `recipientPublicUserId` is non-null, matching
how the invitation was addressed. **Both fields are nullable — decode them as
optional/nullable or the client will crash on an id-addressed invitation.**

Errors worth handling distinctly:

| Code                                           | HTTP | Show the user                                          |
| ---------------------------------------------- | ---- | ------------------------------------------------------ |
| `RECIPIENT_USER_NOT_FOUND`                     | 404  | "No user with that ID" — likely a typo                 |
| `CANNOT_INVITE_SELF`                           | 409  | "That's your own ID"                                   |
| `INVITATION_ALREADY_SENT`                      | 409  | A pending invitation already exists for this recipient |
| `PROJECT_NOT_SHAREABLE` / `SCAN_NOT_SHAREABLE` | 409  | Nothing is uploaded yet                                |
| `NOT_OWNER`                                    | 403  | Only the Owner can share                               |

Rate limit: 20 invitation creations per 15 minutes per IP by default
(`RATE_LIMIT_INVITATION_CREATE_*`).

### Input validation to do client-side

Trim, uppercase, and check against `^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{10}$`
before sending, so a typo shows inline instead of costing a round trip. Reject
`0`, `1`, `I`, `L`, `O`, `U` with a hint that the id never contains them.

## Flow 3 — the invitation inbox

`GET /api/v1/invitations` lists the pending invitations addressed to the
signed-in user by public user id, newest first. It is paginated like every other
list endpoint: `?page=1&limit=20` (`limit` max 100), and the response carries the
standard `pagination` envelope.

```json
{
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 },
  "items": [
    {
      "invitationId": "b1a2c3d4-e5f6-4890-abcd-ef1234567890",
      "scope": "project",
      "project": {
        "id": "…",
        "name": "District 2 Apartment",
        "description": null,
        "thumbnail": null,
        "owner": { "id": "…", "email": "owner@example.com", "displayName": null },
        "scanCount": 4
      },
      "scan": null,
      "status": "PENDING",
      "invitedBy": { "id": "…", "email": "owner@example.com", "displayName": null },
      "sentAt": "2026-07-29T10:00:00.000Z",
      "expiresAt": "2026-08-05T10:00:00.000Z"
    }
  ]
}
```

Email-addressed invitations are **not** listed — they are not bound to an
account, so their link is the only way to reach them.

**An item may arrive with `status: "EXPIRED"`.** Rows are selected on the stored
status `PENDING`, but each item's `status` is recomputed from `expiresAt` when
the response is built, so an invitation that lapsed before the cleanup job swept
it still appears. Render it as expired instead of assuming every item in this
list is actionable.

This screen is what makes an invitation reachable when the email never arrives,
which is common: a user invited by id may have no address on file at all, in
which case the server skips the send entirely and still creates the invitation.
Treat the inbox as the primary channel and email as a convenience.

`scope` is `project` or `scan`; exactly one of `project` / `scan` is non-null.

## Flow 4 — open, accept, decline

Three endpoints take a **reference**:

- `GET /api/v1/invitations/:reference` — preview
- `POST /api/v1/invitations/:reference/accept`
- `POST /api/v1/invitations/:reference/decline`

A reference is either:

1. the raw link token — 43 base64url characters, from the invitation email, a
   share link, or a universal link; or
2. an `invitationId` (UUID) taken from `GET /api/v1/invitations`.

The two forms cannot be confused, so one code path serves both entry points:
universal link and inbox tap. Anything else is `400 VALIDATION_ERROR`.

The path parameter was renamed from `token` to `reference` because it no longer
holds only a token. **The URL is unchanged** — a path parameter name never
travels on the wire — so hand-written networking code needs no change. If you
generate a client from `/api-doc.json`, the generated parameter is renamed
(`previewInvitation(token:)` → `previewInvitation(reference:)`): a compile-time
rename, no runtime behaviour change. The validation error for a malformed value
also reports `path: ["reference"]` instead of `["token"]`, which only matters if
you map `error.details[].path` onto form fields.

An `invitationId` only resolves for the user the invitation is bound to. Do not
try to open somebody else's `invitationId` from the Owner's share list — it
returns `404 INVITATION_NOT_FOUND` by design.

All three endpoints require a Bearer token. Sign the user in first, then
resolve the reference.

Preview `200` (project scope):

```json
{
  "type": "invitation",
  "scope": "project",
  "project": {
    "id": "…",
    "name": "District 2 Apartment",
    "description": null,
    "thumbnail": null,
    "owner": { "id": "…", "email": "owner@example.com", "displayName": null },
    "scanCount": 4
  },
  "scan": null,
  "status": "PENDING",
  "recipientEmail": "recipient@example.com",
  "recipientPublicUserId": null,
  "sentAt": "2026-07-29T10:00:00.000Z",
  "expiresAt": "2026-08-05T10:00:00.000Z",
  "hasAccess": false
}
```

`type` is `invitation` or `share-link`; a share link has no recipient fields and
reports `ACTIVE`, `EXPIRED`, or `REVOKED`. `hasAccess` tells you whether this
user already has access, so the screen can say "Open" instead of "Accept".

Error handling on this flow:

| Code                                                  | HTTP | Meaning                                                                                                                       |
| ----------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| `INVITATION_NOT_FOR_USER`                             | 403  | Bound to a different account. Only happens for id-addressed invitations now — tell the user to sign in as the invited account |
| `INVITATION_NOT_FOUND`                                | 404  | Unknown reference, or an id not addressed to this user                                                                        |
| `SHARE_NO_LONGER_AVAILABLE`                           | 404  | Revoked, or the project/scan was deleted                                                                                      |
| `INVITATION_EXPIRED`                                  | 409  | Ask the Owner to resend                                                                                                       |
| `INVITATION_ALREADY_ACCEPTED` / `INVITATION_DECLINED` | 409  | Terminal                                                                                                                      |
| `ACCESS_ALREADY_EXISTS`                               | 409  | Already a Viewer — navigate straight to the resource                                                                          |
| `CANNOT_ACCEPT_OWN_INVITATION`                        | 409  | The Owner opened their own link                                                                                               |

Rate limit: 30 accepts per 5 minutes per IP by default
(`RATE_LIMIT_INVITATION_ACCEPT_*`). Preview and decline are not subject to that
policy.

## Flow 5 — the Owner's share list

`GET /api/v1/projects/:projectId/shares` and `GET /api/v1/scans/:scanId/shares`
gained recipient fields on each pending invitation:

```json
{
  "invitationId": "…",
  "recipientEmail": null,
  "recipientPublicUserId": "GP5HS2WKBE",
  "recipientDisplayName": "Tham Tran",
  "status": "PENDING",
  "sentAt": "…",
  "expiresAt": "…"
}
```

`recipientEmail` is now nullable. Render the recipient as
`recipientDisplayName` → `recipientEmail` → `recipientPublicUserId`, whichever
is first non-null, so an id-addressed invitation never renders as blank.

## What breaks if the client ships unchanged

| Surface                             | Change                                                                      | Consequence                                                  |
| ----------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Create / resend invitation response | `recipientEmail` nullable, `recipientPublicUserId` added                    | Strict non-null decoding crashes on id-addressed invitations |
| Preview response                    | `recipientEmail` always present but nullable, `recipientPublicUserId` added | Same                                                         |
| Share list                          | `recipientEmail` nullable, two fields added                                 | Blank recipient rows                                         |
| `/users/me`, `/auth/apple`          | `publicUserId` added                                                        | Additive, safe                                               |
| Invitation body                     | `recipientEmail` now optional                                               | Existing email-only bodies keep working                      |
| `GET /api/v1/invitations`           | New route                                                                   | Previously `404`, now `401` when unauthenticated             |

Existing universal links and existing email-invitation flows keep working. The
only hard requirement is tolerating nullable recipient fields.

## Rollout checklist

1. Decode `recipientEmail` and `recipientPublicUserId` as nullable everywhere.
2. Show `publicUserId` on the profile screen with a copy action.
3. Add "Invite by User ID" as the primary invite path; keep email as secondary.
4. Validate the id client-side before sending.
5. Build the invitation inbox from `GET /api/v1/invitations`.
6. Point universal-link handling and the inbox at the same reference-based
   preview/accept path.
7. Update the share list to fall back across the three recipient fields.
8. Handle `RECIPIENT_USER_NOT_FOUND` and `CANNOT_INVITE_SELF`.

## Verifying locally

`yarn seed:local` provisions two accounts with fixed public user ids:

| Account                              | `publicUserId` |
| ------------------------------------ | -------------- |
| Owner (`local-test@roomscan.dev`)    | `RSTESTACC2`   |
| Viewer (`local-viewer@roomscan.dev`) | `RSTESTVWR2`   |

Sign in with the `roomscan-local-test-user` sentinel (development only, with
`LOCAL_TEST_AUTH_ENABLED=true`), invite `RSTESTVWR2`, then sign in as the viewer
and confirm the invitation appears in `GET /api/v1/invitations` and accepts.
