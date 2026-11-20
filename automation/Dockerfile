FROM mcr.microsoft.com/playwright/python:v1.50.0-noble

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    DISPLAY=:99

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        fluxbox \
        novnc \
        websockify \
        x11-utils \
        x11vnc \
        xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/predioai

COPY automation/requirements.txt automation/requirements.txt
RUN python -m pip install --no-cache-dir -r automation/requirements.txt

COPY automation automation

RUN chmod +x automation/docker-entrypoint.sh \
    && mkdir -p /downloads \
    && chown -R pwuser:pwuser /opt/predioai /downloads

USER pwuser

EXPOSE 6080 8765

ENTRYPOINT ["/opt/predioai/automation/docker-entrypoint.sh"]
