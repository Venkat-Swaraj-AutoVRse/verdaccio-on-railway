# --- Stage 1: Build the plugin ---
FROM node:18 AS builder

WORKDIR /plugin
COPY verdaccio-auth-vrse ./verdaccio-auth-vrse

WORKDIR /plugin/verdaccio-auth-vrse
RUN npm install && npm run build && npm prune --production

# --- Stage 2: Setup Verdaccio ---
FROM verdaccio/verdaccio:latest

# Ensure /verdaccio/storage/data exists and is writable by verdaccio (UID 10001)
USER root
RUN mkdir -p /verdaccio/storage && chown -R 10001:10001 /verdaccio/storage

# Copy config and plugin
COPY config.yaml /verdaccio/conf/config.yaml
COPY --from=builder /plugin/verdaccio-auth-vrse /verdaccio/plugins/verdaccio-auth-vrse

# Return to default verdaccio user (UID 10001)
USER 10001

EXPOSE 4873
