FROM node:26-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@11.1.3
