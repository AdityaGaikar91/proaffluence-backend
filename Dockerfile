# ProAffluence API — includes LibreOffice + qpdf + metric-compatible fonts
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && corepack prepare pnpm@11.1.1 --activate \
  && pnpm install --frozen-lockfile=false
COPY . .
RUN npx prisma generate && pnpm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# LibreOffice (headless), qpdf (AES-256 PDF), Liberation fonts (Carlito/Caladea substitutes)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-calc \
    libreoffice-core \
    qpdf \
    fonts-liberation \
    fonts-liberation2 \
    ca-certificates \
    openssl \
  && rm -rf /var/lib/apt/lists/* \
  && soffice --version \
  && qpdf --version

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/docs ./docs
RUN mkdir -p /app/storage/pdfs /app/storage/workbooks

EXPOSE 8002
CMD ["node", "dist/src/main.js"]
