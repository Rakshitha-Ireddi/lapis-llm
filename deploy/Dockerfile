# syntax=docker/dockerfile:1.7
# LapisLLM master image: the Python control plane + the built web console.
# Build from the repository root:
#   docker build -f deploy/Dockerfile -t lapis-llm .

# ---------------------------------------------------------------- web console
FROM node:20-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
COPY shared/ /src/shared/
RUN npx vite build

# ---------------------------------------------------------------- python wheel
FROM python:3.12-slim AS wheel
WORKDIR /src/server
RUN pip install --no-cache-dir build
COPY server/ ./
RUN python -m build --wheel --outdir /dist

# ---------------------------------------------------------------- runtime
FROM python:3.12-slim
LABEL org.opencontainers.image.title="LapisLLM" \
      org.opencontainers.image.description="Pool spare machines behind one OpenAI-compatible endpoint" \
      org.opencontainers.image.licenses="MIT"

RUN useradd --create-home --uid 10001 lapis
COPY --from=wheel /dist/*.whl /tmp/
RUN pip install --no-cache-dir /tmp/*.whl && rm /tmp/*.whl
COPY --from=web /src/web/dist /app/web

ENV LAPIS_DATA_DIR=/data \
    LAPIS_WEB_DIR=/app/web \
    PYTHONUNBUFFERED=1
RUN mkdir -p /data && chown lapis:lapis /data
VOLUME ["/data"]
USER lapis
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz').status==200 else 1)"

ENTRYPOINT ["lapis"]
CMD ["master", "--host", "0.0.0.0", "--port", "8080"]
