# ===== SyncDBJOB — Docker image =====
#  build: docker build -t syncdbjob:1.0.0 .
#  run:   docker run -d --name syncdbjob -p 127.0.0.1:3000:3000 \
#           -v /srv/syncdbjob/storage:/app/storage \
#           --env-file .env syncdbjob:1.0.0
# ==========================================================

# ---- Stage 1: build ----
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

# ---- Stage 2: runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/config ./config

# โฟลเดอร์เก็บไฟล์อัปโหลดและ mapping — ต้อง mount volume ให้คงอยู่
RUN mkdir -p storage/uploads storage/mappings \
    && touch storage/uploads/.gitkeep storage/mappings/.gitkeep \
    && chown -R node:node /app

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/cli.js", "serve", "--host", "0.0.0.0", "--port", "3000"]
