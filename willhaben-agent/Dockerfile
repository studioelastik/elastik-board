FROM node:22-alpine

WORKDIR /app

# Dependencies first so a code change doesn't reinstall them.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

COPY src ./src
COPY public ./public

# Searches, the seen-advert memory and the VAPID keys live here — mount a
# volume or every restart re-arms your searches and logs out your devices.
VOLUME /app/data
ENV DATA_DIR=/app/data
ENV PORT=8787
EXPOSE 8787

# Notifications are the whole point, so a wedged process should be restarted.
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8787/api/auth-required || exit 1

CMD ["node", "src/server.js"]
