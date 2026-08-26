# ---------- build ----------
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile=false
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @inventory/shared build \
 && pnpm --filter @inventory/api prisma:generate \
 && pnpm --filter @inventory/api build

# ---------- runtime ----------
FROM node:20-alpine AS runtime
# pg_dump for the backup module; tini for correct signal handling
RUN apk add --no-cache postgresql16-client tini
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /app/backups /app/uploads
EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/api/dist/main.js"]
