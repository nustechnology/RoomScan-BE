# RoomScan documentation

This file is the mandatory documentation entrypoint for every contributor and
AI agent. Read it before analyzing, implementing, reviewing, or fixing anything
in this repository. Then read the documents mapped to the task before changing
files.

The documents describe the current state of the checked-out branch. They are
not a roadmap unless a section is explicitly labelled as planned work.

## Required reading order

1. Read this index completely.
2. Read [Documentation governance](documentation-governance.md) for the
   non-negotiable branch synchronization rules.
3. Read the task-specific documents in the map below.
4. Read the root [README](../README.md) when setup, commands, environment,
   Docker, or public endpoints are relevant.
5. Read the implementation and tests only after the documentation establishes
   the intended contract.

If documentation and executable behavior disagree, treat the mismatch as part
of the task. Determine the intended behavior from requirements and repository
evidence, then update code, tests, OpenAPI, and documentation together on the
same branch.

## Documentation map

| Document                                                | What it defines                                                                                                             | Read and update when                                                                                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [Architecture](architecture.md)                         | Runtime composition, request flow, module ownership, dependency boundaries, and lifecycle                                   | Changing modules, middleware, infrastructure, persistence, dependency injection, startup, shutdown, or cross-cutting design |
| [API conventions](api-conventions.md)                   | HTTP paths, validation, schemas, error envelopes, request IDs, health semantics, and OpenAPI                                | Adding or changing routes, request/response fields, status codes, middleware, validation, errors, or Swagger                |
| [Development workflow](development.md)                  | Docs-first task loop, local setup, quality gates, Docker verification, Prisma migrations, dependencies, and generated files | Changing scripts, tooling, tests, CI, hooks, environment variables, Docker, Prisma workflow, or developer operations        |
| [Documentation governance](documentation-governance.md) | Mandatory documentation ownership, same-branch synchronization, quality rules, and completion gate                          | Every task that changes repository files                                                                                    |
| [Root README](../README.md)                             | Operator-facing quick start, commands, endpoints, and troubleshooting                                                       | Changing anything a new developer needs to install, run, test, debug, or operate the service                                |

## Source-of-truth boundaries

- `document/` is the canonical human-readable contract for architecture, API
  conventions, development workflow, and documentation policy.
- `/api-doc.json` is the machine-readable public HTTP contract and must be
  generated from the same Zod schemas used at runtime.
- Source code, tests, migrations, and executable configuration prove current
  behavior. A conflict with documentation is a defect to resolve, not a reason
  to ignore the documentation.
- `AGENTS.md` and `AGENT.md` define mandatory agent behavior and must stay
  consistent with this index and the governance document.

## Branch documentation gate

Every task that changes repository files must complete documentation
synchronization on the same branch before handoff, commit, pull request, or
merge. Update every affected document after the implementation reaches its
final state; never defer documentation to a later branch.

When the final diff changes no documented fact, the handoff must still include
a documentation-impact statement naming the documents reviewed and explaining
why no content change was needed. See
[Documentation governance](documentation-governance.md) for the full gate.
