FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium xvfb x11vnc fluxbox python3 ca-certificates dumb-init \
    && rm -rf /var/lib/apt/lists/*
COPY browser/control.py /control.py
COPY browser/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /control.py
EXPOSE 5900 7900
ENTRYPOINT ["dumb-init", "--"]
CMD ["/entrypoint.sh"]
