# Built and checked once per release; customer jobs only pull and start it.
# CI supplies a git-archive context, never the developer's working directory.
FROM node:22.23.2-bookworm-slim
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    ca-certificates curl xz-utils python3 python3-venv python3-pil \
    poppler-utils libheif-examples \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv --system-site-packages /opt/press-python \
    && /opt/press-python/bin/pip install --no-cache-dir pymupdf==1.26.5
ENV PATH="/opt/press-python/bin:${PATH}" PLAYWRIGHT_BROWSERS_PATH=/opt/press-browsers BOOK_ENGINE=typst
RUN curl --fail --location --silent --show-error \
      https://github.com/typst/typst/releases/download/v0.15.1/typst-x86_64-unknown-linux-musl.tar.xz \
      -o /tmp/typst.tar.xz \
    && tar -xJf /tmp/typst.tar.xz -C /tmp \
    && mv /tmp/typst-x86_64-unknown-linux-musl/typst /usr/local/bin/typst \
    && rm -rf /tmp/typst*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npx playwright install --with-deps chromium \
    && npm cache clean --force && rm -rf /var/lib/apt/lists/*
COPY . .
RUN node scripts/test-typst-fixtures.mjs && python3 scripts/test-print-images.py
CMD ["node", "scripts/press.mjs"]
