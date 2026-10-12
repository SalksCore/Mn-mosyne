FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    WEB_PORT=8787

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install --no-save tsx@4 && npm cache clean --force

COPY tsconfig.json ./
COPY src ./src
COPY web ./web
COPY assets ./assets

VOLUME ["/app/data"]
EXPOSE 8787
CMD ["npx", "tsx", "src/index.ts"]
