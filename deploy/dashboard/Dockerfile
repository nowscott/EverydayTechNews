ARG NODE_IMAGE=node:24.14.1-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY apps/nas-dashboard/package*.json ./
RUN npm ci --no-audit --no-fund
COPY apps/nas-dashboard/ ./
RUN npm run build

FROM ${NODE_IMAGE}
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
RUN chmod -R a+rX /app
USER 1000:1001
ENV NODE_ENV=production PORT=3080 TZ=Asia/Shanghai
EXPOSE 3080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/main.ts"]
