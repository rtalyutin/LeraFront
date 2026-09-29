# LeraFront — prepared admin frontend

This is the existing synthetic salon admin UI, packaged as a separate Timeweb App Platform application. Build the included `Dockerfile`; set `BACKEND_URL` to the HTTPS origin of LeraBack **without a trailing slash**, for example `https://backend.example`. The Nginx template proxies `/api/*` to that service. Browser requests therefore keep one public origin for the `__Host-` session cookie and CSRF token. The backend domain also serves VK `/vk/callback` directly.

The five numbered SVG master avatars are placeholders; actual VK carousel photos require uploaded photo IDs configured on the backend. No browser or mobile acceptance of this split deployment has been performed. Run `node --check app.js` for a syntax check.
