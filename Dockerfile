FROM node:22-alpine AS builder
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --only=production

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY server/ ./
COPY game/ ../game/
ENV NODE_ENV=production
EXPOSE 3008
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3008/health', (r) => {if(r.statusCode !== 200) throw new Error(r.statusCode)})"
CMD ["node", "index.js"]
