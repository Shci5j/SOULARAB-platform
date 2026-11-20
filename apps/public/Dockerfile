FROM node:24-alpine

ENV NODE_ENV=production
ENV PUBLIC_PORT=4000
WORKDIR /app

COPY packages/core ./packages/core
COPY apps/public ./apps/public

RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 4000
CMD ["node", "apps/public/src/server.js"]
