FROM mcr.microsoft.com/playwright:v1.65.0-noble
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ffmpeg libnss3-tools ca-certificates fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /runner
COPY package*.json ./
RUN npm ci --omit=dev
COPY worker.mjs start-class.mjs entrypoint.sh ./
RUN chmod 755 entrypoint.sh
ENV NODE_EXTRA_CA_CERTS=/certs/think-meet-root.crt
ENTRYPOINT ["/runner/entrypoint.sh"]
CMD ["node", "/runner/worker.mjs"]
