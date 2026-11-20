FROM node:24-alpine

ENV NODE_ENV=production
ENV ADMIN_PORT=3000
WORKDIR /app

COPY packages/core ./packages/core
COPY apps/admin ./apps/admin

RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  && mkdir -p /data \
  && chown node:node /data
USER node

EXPOSE 3000
CMD ["node", "apps/admin/src/server.js"]
