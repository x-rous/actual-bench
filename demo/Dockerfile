FROM jhonderson/actual-http-api:latest

USER root

# Build deps for better-sqlite3 + install the Actual sync server from npm.
RUN apk add --no-cache python3 make g++ \
 && npm install -g @actual-app/sync-server@26.6.0

# Pre-synced demo budget (see generate-seed.mjs). Baked in → resets on restart.
COPY seed-data /seed-data

COPY start.sh /start.sh
RUN chmod +x /start.sh

# REST wrapper listens on Hugging Face's port; it talks to the sync server on
# 127.0.0.1:5006. Use the IPv4 literal (not "localhost"): Node's fetch resolves
# "localhost" to IPv6 ::1 first, which the sync server doesn't listen on, causing
# "Authentication failed: network-failure". API_KEY and ACTUAL_SERVER_PASSWORD
# come from Space secrets.
ENV PORT=7860 \
    ACTUAL_SERVER_URL=http://127.0.0.1:5006

EXPOSE 7860
# Override the base image's ENTRYPOINT (./entrypoint.sh) — otherwise our script
# would be passed as an argument to it and never run, leaving the sync server
# unstarted. start.sh boots the sync server, then exec's the base entrypoint.
ENTRYPOINT ["/start.sh"]
