FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends util-linux ca-certificates && rm -rf /var/lib/apt/lists/*
ARG NEWS_VERSION=development
ARG NEWS_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/nowscott/EverydayTechNews" org.opencontainers.image.version=$NEWS_VERSION org.opencontainers.image.revision=$NEWS_REVISION
WORKDIR /app
COPY packages/ordinary-news/package*.json packages/ordinary-news/
RUN npm ci --prefix packages/ordinary-news --omit=dev --ignore-scripts --no-audit --no-fund
COPY packages/ordinary-news/src packages/ordinary-news/src
COPY packages/news-common packages/news-common
COPY config/news-filter.json config/news-filter.json
COPY deploy/ordinary/verify-state.ts /app/verify-state.ts
USER node
ENTRYPOINT ["node", "packages/ordinary-news/src/main.ts"]
CMD ["report", "--data", "/data"]
