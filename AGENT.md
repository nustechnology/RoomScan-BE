# RoomScan AI agent entrypoint

All agents must follow the canonical instructions in [AGENTS.md](AGENTS.md).

At minimum: use Node 24/Yarn 4, preserve the injected Express app architecture,
reuse Zod schemas for validation and OpenAPI, never edit generated Prisma
Client, and run `yarn validate`, `yarn test:coverage`, and `yarn build` before
handoff.
