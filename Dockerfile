# Wildlings: game server + web client in one image.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build -w web

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DB_PATH=/app/server/data/wildlings.db STATIC_DIR=/app/web/dist
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w server -w shared --include-workspace-root=false
COPY shared shared
COPY server/src server/src
COPY server/migrations server/migrations
COPY --from=build /app/web/dist web/dist
VOLUME /app/server/data
EXPOSE 8787
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/main.ts"]
