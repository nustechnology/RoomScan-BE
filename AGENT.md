# RoomScan AI agent entrypoint

All agents must follow the canonical instructions in [AGENTS.md](AGENTS.md).

At minimum: use Node 24/Yarn 4, preserve the injected Express app architecture,
reuse Zod schemas for validation and OpenAPI, never edit generated Prisma
Client, and run `yarn validate`, `yarn test:coverage`, and `yarn build` before
handoff.

Shared skills are stored in `.agents/skills`. For code review, code quality, or
merge-readiness work, read and follow
[code-review-and-quality](.agents/skills/code-review-and-quality/SKILL.md);
review is read-only unless fixes are explicitly requested.
