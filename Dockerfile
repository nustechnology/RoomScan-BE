# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.18.0

FROM node:${NODE_VERSION}-bookworm-slim AS base

ENV COREPACK_HOME=/corepack

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global corepack@0.35.0 \
  && corepack enable

WORKDIR /app

FROM base AS dependencies

ENV HUSKY=0

COPY package.json yarn.lock .yarnrc.yml ./
COPY .husky/install.mjs .husky/install.mjs

RUN yarn install --immutable

FROM dependencies AS build

ENV DATABASE_URL=postgresql://roomscan:roomscan@localhost:5432/roomscan?schema=public

COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN yarn build

FROM dependencies AS migration

COPY prisma ./prisma
COPY prisma.config.ts ./

ENTRYPOINT ["yarn", "prisma:migrate:deploy"]

FROM base AS production-dependencies

ENV HUSKY=0

COPY package.json yarn.lock .yarnrc.yml ./
COPY .husky/install.mjs .husky/install.mjs

RUN yarn workspaces focus --production

FROM base AS runtime

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/v1/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "dist/server.js"]
