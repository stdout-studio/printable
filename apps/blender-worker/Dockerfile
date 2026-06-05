# Headless Blender worker for Kerf. Heavy (~1 GB) because it ships a real
# Blender binary — the agent drives it as a `blender --background` subprocess
# (see src/blender_process.py, which reads BLENDER_BIN).
#
#   docker build -t kerf-blender-worker ./apps/blender-worker
#   (docker compose builds it for you)
#
# NOTE: built/validated in the deploy environment — there is no Docker on the
# dev box this was authored on, so treat the Blender version pin as the thing
# most likely to need a bump.

FROM python:3.12-slim

# Runtime libs Blender needs even headless, plus tools to fetch + unpack it.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl xz-utils ca-certificates \
      libgl1 libglu1-mesa libxi6 libxxf86vm1 libxfixes3 libxrender1 libxkbcommon0 \
      libsm6 libice6 libxext6 \
    && rm -rf /var/lib/apt/lists/*

# Pinned headless Blender (4.2 LTS) → /opt/blender, symlinked onto PATH.
ARG BLENDER_SERIES=4.2
ARG BLENDER_VERSION=4.2.3
RUN curl -fsSL "https://download.blender.org/release/Blender${BLENDER_SERIES}/blender-${BLENDER_VERSION}-linux-x64.tar.xz" -o /tmp/blender.tar.xz \
    && mkdir -p /opt/blender \
    && tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 \
    && rm /tmp/blender.tar.xz \
    && ln -s /opt/blender/blender /usr/local/bin/blender
ENV BLENDER_BIN=/usr/local/bin/blender

# uv for the FastAPI-side Python deps (the Blender side uses Blender's own
# bundled Python via the subprocess, so bpy is NOT a pip dependency here).
RUN pip install --no-cache-dir uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY src ./src
COPY scripts ./scripts

ENV PRINTABLE_WORKER_TMP=/tmp/printable-worker \
    WORKER_PUBLIC_HOST=0.0.0.0 \
    WORKER_PUBLIC_PORT=8080
EXPOSE 8080
CMD ["uv", "run", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8080"]
