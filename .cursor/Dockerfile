FROM node:26-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl build-essential python3 \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@11.1.3 --activate
