# Documentation governance

RoomScan documentation is versioned with the code it describes. The
documentation in a branch must describe that branch's final behavior, not only
the state of `main` and not a hoped-for future state.

This policy applies to humans and every AI agent working in the repository.

## Mandatory docs-first workflow

Before analyzing, implementing, reviewing, or fixing a bug:

1. Read [the documentation index](README.md) completely.
2. Read this governance document.
3. Use the index to select every document affected by the task.
4. Establish the intended behavior from requirements, current documentation,
   implementation, tests, and executable configuration.
5. Identify documentation impact before editing files.

Do not begin implementation from source code alone. Existing documentation may
contain constraints that are not obvious from one call path or test.

## Same-branch synchronization rule

Every task that changes repository files must perform documentation
synchronization in the same branch:

- Update the relevant files under `document/` whenever behavior, invariants,
  architecture, ownership, API contracts, data structures, environment,
  scripts, dependencies, tests, deployment, CI, or contributor/agent workflow
  changes.
- Update the root `README.md` when setup, run commands, public endpoints,
  environment variables, troubleshooting, or operator-facing behavior changes.
- Update generated OpenAPI registration and runtime Zod schemas together with
  public HTTP changes.
- Update `AGENTS.md`, `AGENT.md`, this document, and the documentation index
  together when agent workflow or documentation policy changes.
- Document bug fixes as the intended invariant or behavior and the regression
  protection, not as a temporary incident narrative.
- Remove or rewrite stale statements when behavior is deleted or renamed.

Documentation must be updated after the implementation reaches its final form
so it reflects the final diff. Documentation work may not be deferred to a
follow-up branch, ticket, or future agent.

## Documentation-impact statement

Every handoff must include a short documentation-impact statement:

```text
Documentation impact:
- Updated: document/api-conventions.md — added the new response contract.
- Reviewed unchanged: document/architecture.md — module boundaries did not change.
```

If the final diff changes no documented fact, content may remain unchanged only
after the relevant documents have been reviewed. The handoff must name those
documents and explain why no content change was required. “No docs needed”
without evidence does not satisfy the gate.

Documentation-only changes satisfy the synchronization requirement when they
leave all cross-references and agent entrypoints consistent.

## Writing standards

- Describe current, observable behavior in present tense.
- Mark proposed or future behavior explicitly; do not mix it with implemented
  behavior.
- Use repository-relative links and commands that run from the repository root.
- Name exact paths, environment variables, routes, scripts, and status codes.
- Keep examples free of real credentials, tokens, personal data, and production
  connection details.
- Explain invariants and rationale that cannot be inferred safely from code.
- Avoid duplicating machine-generated schemas or dependency lists when a stable
  canonical source can be linked instead.
- Update the documentation index whenever a document is added, renamed, moved,
  or removed.

## Conflict handling

When documentation, tests, OpenAPI, configuration, and implementation disagree:

1. Do not silently choose one source and continue.
2. Identify the intended contract from the task requirements and the strongest
   repository evidence.
3. Surface a blocking question when the intended behavior cannot be determined
   safely.
4. Resolve every affected artifact in the same branch once the contract is
   known.

Never “fix” a mismatch by documenting an accidental bug as intended behavior.

## Completion gate

A task is not ready for handoff, commit, pull request, or merge until:

- The documentation index and relevant documents were read.
- The final diff was reviewed for documentation impact.
- Every changed documented fact is reflected under `document/`.
- Root README, OpenAPI, agent instructions, and examples are synchronized when
  applicable.
- Commands, paths, links, schemas, and examples in changed documents were
  verified.
- Stale or contradictory statements were removed.
- The handoff includes the documentation-impact statement.

Failure to satisfy any item blocks completion.
