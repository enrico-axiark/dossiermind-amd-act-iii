FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv poppler-utils \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system dossiermind && useradd --system --gid dossiermind dossiermind
COPY platform/parsers/requirements.txt /tmp/parser-requirements.txt
RUN python3 -m venv /opt/parser \
    && /opt/parser/bin/pip install --no-cache-dir -r /tmp/parser-requirements.txt \
    && rm /tmp/parser-requirements.txt
WORKDIR /srv/dossiermind/platform
COPY platform/package.json ./
COPY platform/src ./src
COPY platform/parsers ./parsers
COPY platform/openapi ./openapi
COPY platform/brain ./brain
COPY app ../app
RUN mkdir -p /app/data && chown -R dossiermind:dossiermind /app/data
USER dossiermind
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DB_PATH=/app/data/dossiermind.sqlite STORAGE_ROOT=/app/data/objects PYTHON_EXECUTABLE=/opt/parser/bin/python
EXPOSE 8787
VOLUME ["/app/data"]
CMD ["node", "src/server.mjs"]
