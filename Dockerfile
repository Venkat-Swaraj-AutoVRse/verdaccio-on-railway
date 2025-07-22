FROM verdaccio/verdaccio:latest

# Copy the Verdaccio config
COPY config.yaml /verdaccio/conf/config.yaml

# Copy your custom plugin into the plugins directory
COPY verdaccio-auth-vrse /verdaccio/plugins/verdaccio-auth-vrse

# Install any dependencies the plugin needs
WORKDIR /verdaccio/plugins/verdaccio-auth-vrse
RUN npm install --production

EXPOSE 4873
