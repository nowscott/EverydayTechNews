FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends util-linux ca-certificates && rm -rf /var/lib/apt/lists/*
ARG NEWS_VERSION=development
ARG NEWS_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/nowscott/EverydayTechNews" \
      org.opencontainers.image.version=$NEWS_VERSION \
      org.opencontainers.image.revision=$NEWS_REVISION
WORKDIR /app
COPY packages/news-engine/package*.json packages/news-engine/
RUN npm ci --prefix packages/news-engine --omit=dev --ignore-scripts --no-audit --no-fund
COPY packages/news-engine/src packages/news-engine/src
COPY packages/news-common packages/news-common
COPY experiments/premium/*.json experiments/premium/
COPY config/news-filter.json config/news-filter.json
COPY deploy/nas/entrypoint.sh /app/entrypoint.sh
COPY deploy/nas/verify-state.ts /app/verify-state.ts
RUN chmod a+rx /app /app/packages /app/packages/news-engine /app/experiments /app/experiments/premium /app/config \
    && chmod -R a+rX /app/packages/news-engine/src /app/experiments/premium /app/config \
    && chmod a+r /app/packages/news-engine/package*.json /app/entrypoint.sh
USER node
ENTRYPOINT ["sh", "/app/entrypoint.sh"]
CMD ["status"]
