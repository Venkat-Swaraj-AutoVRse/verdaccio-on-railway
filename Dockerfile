# --- Stage 1: Build the plugin ---
FROM node:18 AS builder

WORKDIR /plugin
COPY verdaccio-auth-vrse ./verdaccio-auth-vrse

WORKDIR /plugin/verdaccio-auth-vrse
RUN npm install && npm run build && npm prune --production

# --- Stage 2: Setup Verdaccio ---
FROM verdaccio/verdaccio:latest

# Copy config
COPY config.yaml /verdaccio/conf/config.yaml

# Copy plugin (built + node_modules)
COPY --from=builder /plugin/verdaccio-auth-vrse /verdaccio/plugins/verdaccio-auth-vrse

# Default port
EXPOSE 4873
