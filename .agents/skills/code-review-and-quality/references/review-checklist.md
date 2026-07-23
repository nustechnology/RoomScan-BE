# Code Review Checklist

Use this reference after reading `SKILL.md`. Select checks relevant to the
change; do not turn the checklist into low-value commentary.

## Context and Scope

- Confirm what the change is intended to accomplish and why.
- Confirm the review base and whether staged, unstaged, untracked, or committed
  changes are in scope.
- Read repository instructions and relevant design or product documentation.
- Identify unrelated user changes and leave them out of the verdict.
- Note assumptions that materially affect correctness.

## Tests First

- Confirm behavior-changing code has behavioral tests.
- Confirm a bug fix includes a regression test that fails without the fix.
- Check success, failure, empty, null, boundary, and invalid-input paths.
- Prefer public behavior over implementation-detail assertions.
- Confirm mocks do not bypass the behavior the test claims to exercise.
- Check deterministic cleanup of ports, timers, database state, and global
  process state.

## Correctness

- Match behavior to every explicit acceptance criterion.
- Trace error propagation and response/status mapping.
- Check state transitions, retries, idempotency, and partial failure.
- Check off-by-one, ordering, time zone, encoding, and numeric precision risks.
- Check async control flow for missing `await`, double completion, races, and
  unhandled rejection.
- Check resource lifecycle for early-return leaks.
- Verify default values do not hide invalid or ambiguous state.
- Verify public API, persistence, event, and serialization compatibility.

## Readability and Simplicity

- Use names that express domain meaning rather than `data`, `temp`, or `result`.
- Keep control flow direct; avoid deep nesting and chained ternaries.
- Remove duplication by reusing a canonical helper, not by inventing a second
  near-equivalent abstraction.
- Question pass-through wrappers and abstractions with only one speculative use.
- Check whether repeated conditionals indicate a missing model, state, policy,
  or dispatcher.
- Ensure comments explain non-obvious intent or constraints, not obvious syntax.
- Identify unreachable branches, obsolete compatibility shims, unused exports,
  and “removed” comments.

## Architecture

- Preserve existing ownership and dependency direction.
- Keep orchestration separate from business rules.
- Keep feature-specific logic in the module that owns the concept.
- Keep infrastructure behind narrow interfaces when repository architecture
  requires dependency injection.
- Avoid circular dependencies and shared modules that become dumping grounds.
- Make type boundaries explicit; question gratuitous `any`, casts, broad
  `unknown`, optional fields, and silent fallback.
- Verify a refactor removes concepts rather than moving the same complexity.
- Treat a file near 1,000 total lines as an inspection signal, not an automatic
  failure. Recommend decomposition when the change materially worsens focus.

### Useful Structural Remedies

- Replace repeated branching with a typed model or explicit dispatcher.
- Collapse duplicate branches into one clearer path.
- Separate orchestration from business logic.
- Move feature policy out of a shared utility and into its owning module.
- Reuse the canonical helper.
- Make an invariant explicit at the type or validation boundary.
- Delete a pass-through wrapper.
- Extract focused helpers or modules from a large mixed-responsibility file.

Prefer the remedy that removes moving parts over one that spreads them across
more files.

## Security

- Keep secrets and connection strings out of source, logs, fixtures, and errors.
- Validate external input at the boundary before business logic.
- Parameterize database access and shell/process execution.
- Enforce authentication and authorization at every protected operation.
- Avoid path traversal, unsafe redirects, insecure deserialization, SSRF, XSS,
  CSRF, command injection, and SQL injection.
- Bound upload size, request size, query range, pagination, retry count, and
  expensive operations.
- Avoid exposing stack traces or implementation details in production.
- Treat API responses, logs, environment values, files, and configuration as
  untrusted external data when appropriate.
- Verify sensitive comparisons, tokens, cookies, CORS, and transport settings.
- Check dependency provenance and known advisories when network access and
  approved tools are available.

## Performance and Reliability

- Avoid N+1 database or API access.
- Bound loops, result sets, concurrency, queues, caches, retries, and recursion.
- Add pagination for list endpoints.
- Avoid blocking filesystem, crypto, compression, or CPU work on hot paths.
- Check algorithmic complexity at expected production scale.
- Check connection, timer, listener, stream, and memory cleanup.
- Avoid unnecessary serialization, parsing, copies, and repeated allocations.
- Confirm timeouts, cancellation, backpressure, and partial-failure behavior.
- Require measurement before proposing complex optimization.

## Dependencies

- Confirm the existing stack or standard library cannot reasonably solve the
  need.
- Inspect maintenance activity, license, provenance, package size, and platform
  support.
- Read release notes and migration guidance, especially for major versions.
- Prefer one dependency upgrade per change or a small related group.
- Review the complete lockfile diff and transitive graph.
- Confirm the lockfile was generated by the package manager, never hand-edited.
- Run tests that exercise the dependency's behavior before and after an upgrade.

## Change Size and History

Use change size as a reviewability signal:

- About 100 changed lines is usually easy to review.
- About 300 changed lines can be reasonable for one coherent change.
- About 1,000 changed lines usually warrants splitting unless mostly generated,
  mechanical, or deletion-only.

Separate broad refactoring from behavior changes when practical. A good change
description uses an imperative first line and explains what changed, why, key
tradeoffs, and verification evidence.

## RoomScan-Specific Checks

- Preserve the Express application factory/runtime bootstrap split.
- Keep public routes under `/api/v1` and Swagger at `/api-doc`.
- Validate external input with Zod and reuse schemas for OpenAPI registration.
- Preserve the standard error envelope and request ID.
- Avoid logging secrets, SQL, connection strings, or production stack traces.
- Use the Prisma PostgreSQL driver adapter and review schema migrations.
- Never hand-edit generated Prisma Client code.
- Use Yarn only and keep `yarn.lock` atomic with dependency changes.
- Apply the commands and exceptions in the root `AGENTS.md`.

## Review Output Template

```markdown
## Findings

### [Required] Short defect title

- Location: `path/to/file.ts:42`
- Trigger: Concrete input or execution path.
- Impact: Observable failure or violated invariant.
- Remediation: Smallest safe correction.

## Open questions and assumptions

- Only questions that change the verdict.

## Verification

- Passed: `command`
- Not run: `command` — reason

## Verdict

Request changes — concise rationale.
```

When there are no findings, replace the findings section with “No actionable
findings” and still document verification gaps and residual risk.

## Final Gate

- Resolve every `Critical` finding.
- Resolve or explicitly justify every `Required` finding.
- Confirm relevant tests and build checks pass.
- Document checks that were not run.
- Confirm the change description and verification story can stand alone.
- Choose `Approve` only when no merge-blocking finding remains.
