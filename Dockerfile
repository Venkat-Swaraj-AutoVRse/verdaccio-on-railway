# --- Stage 1: Build the plugin ---
FROM node:18 AS builder

WORKDIR /plugin
COPY verdaccio-auth-vrse ./verdaccio-auth-vrse

WORKDIR /plugin/verdaccio-auth-vrse
RUN npm install && npm run build && npm prune --production

# --- Stage 2: Setup Verdaccio ---
FROM verdaccio/verdaccio:latest

# Step 1: Switch to root to fix permissions
USER root

# Step 2: Create required storage subdirectory and fix ownership
RUN mkdir -p /verdaccio/storage/data && chown -R 10001:10001 /verdaccio/storage

# Step 3: Copy config and plugin
COPY config.yaml /verdaccio/conf/config.yaml
COPY --from=builder /plugin/verdaccio-auth-vrse /verdaccio/plugins/verdaccio-auth-vrse

# Step 4: Revert to Verdaccio user
USER 10001

EXPOSE 4873
