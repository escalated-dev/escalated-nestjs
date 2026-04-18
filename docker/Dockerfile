# syntax=docker/dockerfile:1.7

# ---------- 1. Build the Escalated NestJS package + produce a tarball ----------
FROM node:22-alpine AS package

WORKDIR /package
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund --no-progress || (echo "--- skipping optional lock ---" && npm install --no-audit --no-fund --no-progress --package-lock=false)
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build
RUN npm pack && mv escalated-dev-escalated-nestjs-*.tgz /package.tgz

# ---------- 2. Host app build ----------
FROM node:22-alpine AS host

WORKDIR /host
COPY docker/host-app/package.json docker/host-app/tsconfig.json docker/host-app/tsconfig.build.json ./
COPY --from=package /package.tgz /package.tgz

# Replace the file:/package reference with the built tarball, then install normally.
RUN sed -i 's|"@escalated-dev/escalated-nestjs": "file:/package"|"@escalated-dev/escalated-nestjs": "file:/package.tgz"|' package.json \
    && npm install --no-audit --no-fund --no-progress

COPY docker/host-app/src ./src
RUN npm run build

# ---------- 3. Runtime ----------
FROM node:22-alpine AS runtime

RUN apk add --no-cache postgresql-client

WORKDIR /host
COPY --from=host /host/node_modules ./node_modules
COPY --from=host /host/dist ./dist
COPY --from=host /host/package.json ./package.json

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV APP_ENV=demo

EXPOSE 8000

ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "dist/main.js"]
