---
name: code-review-and-quality
description: Performs evidence-backed code review across correctness, readability, architecture, security, and performance. Use when an agent is asked to review code, assess quality or merge readiness, inspect another human or agent's implementation, review a refactor or bug fix, or provide the required review before merging a repository change.
---

# Code Review and Quality

## Objective

Review changes as a quality gate without imposing personal style. Approve a
change when it improves overall code health, satisfies the task, and follows
the repository's conventions. Do not require perfection or a rewrite into the
reviewer's preferred design.

Treat review as read-only unless the user also asks to implement fixes. Never
silently delete suspected dead code.

## Establish the Review Scope

1. Read the repository-level agent instructions and the relevant architecture,
   API, development, or product documentation.
2. Identify the requested comparison: working tree, staged diff, commit, branch,
   pull request, or named files. Do not silently expand the review to unrelated
   user changes.
3. Understand the task or specification before judging the implementation.
   Record material ambiguities as assumptions or questions.
4. Inspect tests before implementation when tests are present; they expose the
   intended behavior and missing cases.
5. Read enough unchanged surrounding code to validate invariants, callers,
   error paths, and established patterns.
6. Use the repository's structural code intelligence for symbols, callers,
   callees, and impact analysis when available. Use literal search for strings,
   configuration values, comments, and generated text.

If the scope cannot be determined safely, ask one concise blocking question
instead of reviewing an arbitrary diff.

## Review Across Five Axes

Apply every axis. Load [the detailed checklist](references/review-checklist.md)
for comprehensive reviews, large refactors, dependency changes, or
security/performance-sensitive work.

### Correctness

Verify that behavior matches the task, including empty, null, boundary, failure,
concurrency, and state-transition cases. Confirm tests would fail for the
regression they claim to prevent. Trace the actual runtime path rather than
inferring behavior from names.

### Readability and Simplicity

Prefer direct control flow, descriptive names, focused files, and abstractions
that remove concepts. Flag cleverness, nested branching, duplicated policy,
silent fallback, dead artifacts, and abstractions that only relocate
complexity.

### Architecture

Check ownership, dependency direction, module boundaries, type boundaries, and
consistency with canonical repository patterns. Treat feature logic in shared
modules, near-duplicate helpers, and scattered conditionals as structural
signals. Propose a specific restructuring when flagging a structural problem.

### Security

Treat all external input as untrusted. Check validation, authorization,
injection, output encoding, secret handling, logs, error responses, file/path
handling, resource limits, and dependency trust. Do not report hypothetical
security issues without showing a reachable mechanism.

### Performance

Look for N+1 access, unbounded queries or loops, missing pagination, accidental
serialization, synchronous hot-path work, leaks, repeated allocations, and
algorithms whose cost changes materially at expected scale. Quantify impact
when evidence permits.

## Require Evidence for Findings

Report a finding only when all of these are available:

- A concrete file and tight line location in the reviewed change.
- The input, state, or execution path that triggers the problem.
- The observable impact or violated invariant.
- A practical remediation direction.

Do not report:

- Pure style preference already handled by formatter or lint rules.
- Speculation without a reachable failure mode.
- Pre-existing problems the change neither introduces nor worsens.
- A request to add comments, tests, or abstractions without explaining the
  behavioral risk they address.

Use structural impact analysis before claiming a public symbol is unused or a
change is isolated.

## Classify Severity

Use one explicit label for every finding:

| Label      | Meaning                                                                                         | Merge action      |
| ---------- | ----------------------------------------------------------------------------------------------- | ----------------- |
| `Critical` | Exploitable security issue, data loss, outage, or core behavior is broken                       | Block merge       |
| `Required` | Reproducible defect, regression, missing required behavior, or material architectural violation | Fix before merge  |
| `Optional` | Valuable improvement that is not required for correctness or safety                             | Author decides    |
| `Nit`      | Minor readability or consistency preference                                                     | Author may ignore |
| `FYI`      | Context only; no action requested                                                               | No action         |

Order findings by severity, then by user impact. A few high-confidence findings
are better than a long list of weak observations.

## Verify Proportionately

Run the validation commands required by the repository instructions when they
are safe and relevant. Prefer the smallest targeted check first, then the full
quality gate when merge readiness is being assessed.

Record:

- Commands or checks that passed.
- Checks that failed and whether failure is caused by the reviewed change.
- Checks not run, with the reason.
- Manual verification or screenshots required but unavailable.

Do not claim a check passed unless it was run or supported by supplied CI
evidence.

## Review Dependencies and Generated Files

For dependency changes, inspect the manifest and lockfile together. Verify the
need, release or migration notes, runtime compatibility, license, maintenance,
transitive changes, and relevant tests. Never treat successful installation as
sufficient verification.

Do not review generated output as handwritten source. Verify its source schema,
generator configuration, deterministic regeneration path, and whether generated
artifacts follow repository commit policy.

## Produce the Review

Use this order:

1. **Findings** — highest severity first. Each finding must contain the label,
   concise title, tight file/line location, trigger, impact, and remediation.
2. **Open questions and assumptions** — include only items that affect the
   verdict.
3. **Verification** — list checks run, results, and meaningful gaps.
4. **Verdict** — `Approve` or `Request changes`, followed by a short rationale.

If no actionable finding exists, say so explicitly. Still report residual
risks, untested paths, or verification gaps; never use an unsupported “LGTM.”

When the host supports inline review comments, attach findings to the tightest
relevant line and keep the final summary self-contained.
