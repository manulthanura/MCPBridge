# Build with the repository root as context:
#   docker build -f docker/Dockerfile .
# (docker/docker-compose.yml is already configured this way.)
# Context ignores live in Dockerfile.dockerignore next to this file (BuildKit).

# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime stage ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Default to remote-friendly HTTP transport inside containers; audit log on a volume.
ENV MCPBRIDGE_TRANSPORT=http \
    MCPBRIDGE_HTTP_PORT=3920 \
    MCPBRIDGE_AUDIT_LOG=/data/mcpbridge-audit.jsonl
VOLUME /data
EXPOSE 3920

USER node
CMD ["node", "dist/main.js"]
