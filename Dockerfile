# This NGINX image exposes only 8080; the standard image also inherits port 80.
FROM nginxinc/nginx-unprivileged:1.27-alpine@sha256:65e3e85dbaed8ba248841d9d58a899b6197106c23cb0ff1a132b7bfe0547e4c0
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY index.html styles.css auth.css app.js constructor.js /usr/share/nginx/html/
COPY icons /usr/share/nginx/html/icons
COPY avatars /usr/share/nginx/html/avatars
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -T 2 -O /dev/null http://127.0.0.1:8080/healthz || exit 1
