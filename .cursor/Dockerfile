FROM node:26-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl build-essential python3 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@11.1.3

RUN mkdir -p /workspace \
    && chown -R node:node /workspace /home/node

USER node
WORKDIR /workspace
