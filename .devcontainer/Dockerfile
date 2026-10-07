# Keep the Node version in step with docker/Dockerfile.dev and .github/workflows/ci.yml.
FROM node:24.21.0-bookworm

# Build tools for native modules (better-sqlite3), plus git/ssh and sudo for the
# node user (the image's default non-root user, uid 1000).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 make g++ git openssh-client sudo ca-certificates \
 && echo "node ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/node \
 && chmod 0440 /etc/sudoers.d/node \
 && rm -rf /var/lib/apt/lists/*

USER node
