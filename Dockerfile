FROM nginx:1.27-alpine
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY index.html styles.css app.js /usr/share/nginx/html/
COPY avatars /usr/share/nginx/html/avatars
EXPOSE 8080
