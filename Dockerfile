FROM verdaccio/verdaccio:latest

COPY config.yaml /verdaccio/conf/config.yaml

EXPOSE 4873