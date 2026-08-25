# syntax = docker/dockerfile:1

# Application image - extends base image with source code and build
# Used for both production and PR preview deployments

# Pinned by CI to an immutable digest (cohold-base@sha256:...) so an app image is
# always built on the exact base it was tested against. The floating :latest
# default is only for local builds.
# Forks can override with --build-arg BASE_IMAGE=ghcr.io/<owner>/cohold-base:latest
ARG BASE_IMAGE=ghcr.io/alexanderpezarro/cohold-base:latest
FROM ${BASE_IMAGE}

WORKDIR /app

# Copy application source (includes docker-entrypoint.js)
COPY . .

# Build application
RUN npm run build

# Ensure entrypoint is executable
RUN chmod +x /app/docker-entrypoint.js

ENTRYPOINT ["/app/docker-entrypoint.js"]
CMD ["npm", "run", "start"]
