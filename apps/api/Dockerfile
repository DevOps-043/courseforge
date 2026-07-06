# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROME_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

FROM base AS build
ENV NODE_ENV=development
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/api apps/api
COPY apps/web/src/remotion apps/web/src/remotion
COPY apps/web/src/domains/materials/types apps/web/src/domains/materials/types
COPY apps/web/tsconfig.json apps/web/tsconfig.json
RUN npm run build --workspace=apps/api
RUN npm prune --omit=dev

FROM base AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    ffmpeg \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-core \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/src/remotion apps/web/src/remotion
COPY --from=build /app/apps/web/src/domains/materials/types apps/web/src/domains/materials/types
COPY --from=build /app/apps/web/tsconfig.json apps/web/tsconfig.json

WORKDIR /app/apps/api
EXPOSE 8080
CMD ["node", "dist/server.js"]
