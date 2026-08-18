# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS build
ENV NODE_ENV=development
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/api apps/api
RUN npm run build --workspace=apps/api

FROM base AS runtime
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/apps/api/dist apps/api/dist

WORKDIR /app/apps/api
RUN node -e "for (const pkg of ['express','cors','helmet','morgan','@supabase/supabase-js']) require.resolve(pkg); console.log('Runtime dependencies resolved')"
EXPOSE 8080
CMD ["node", "dist/server.js"]
