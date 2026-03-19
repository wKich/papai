FROM oven/bun:1-alpine@sha256:32f1fcccb1523960b254c4f80973bee1a910d60be000a45c20c9129a1efcffee AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base AS final
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY schemas ./schemas
COPY package.json tsconfig.json CHANGELOG.md ./

ENV NODE_ENV=production

USER bun
CMD ["bun", "run", "src/index.ts"]
