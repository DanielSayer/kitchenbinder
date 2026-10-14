FROM node:26.7.0-bookworm-slim@sha256:4db36457f406501e6f608802e5da617e5fbd0e80b75901b6a09de1ae5a667d32 AS build
WORKDIR /app
RUN npm install --global pnpm@11.21.0
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build:release
# Keep the locked workspace installation, including tsx for the source worker.
# The content-addressed download store is unnecessary after installation.
RUN rm -rf /app/.pnpm-store /app/.git

FROM node:26.7.0-bookworm-slim@sha256:4db36457f406501e6f608802e5da617e5fbd0e80b75901b6a09de1ae5a667d32 AS release
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3001
STOPSIGNAL SIGTERM
CMD ["node", "scripts/start-web.mjs"]
