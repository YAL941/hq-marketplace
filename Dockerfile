FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Set after `npm ci` so devDependencies (tsx, used by db:migrate) stay installed.
ENV NODE_ENV=production

# Local-disk storage writes here; the named volume in docker-compose.yml is
# mounted on the same path and inherits this ownership on first creation.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/healthz >/dev/null 2>&1 || exit 1

CMD ["npm", "run", "start"]
