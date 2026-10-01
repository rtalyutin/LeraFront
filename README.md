# LeraFront — prepared admin frontend

This is the existing synthetic salon admin UI, packaged as a separate Timeweb App Platform application. Build the included `Dockerfile`; set `BACKEND_URL` to the HTTPS origin of LeraBack **without a trailing slash**, for example `https://backend.example`. The Nginx template proxies `/api/*` to that service. Browser requests therefore keep one public origin for the `__Host-` session cookie and CSRF token. The backend domain also serves VK `/vk/callback` directly.

## Admin constructor

After login, use **Конструктор салона**:

1. Add services and their duration in whole minutes (1–1440).
2. Add masters; select the services each provides.
3. Add rooms; select the services each supports.
4. Set weekly hours for each master and room. Add multiple intervals for breaks or mark a weekday as closed. End time 24:00 is supported; overnight shifts are not.

The constructor starts empty on a new database. Existing records remain editable. Master cards use initials as placeholder avatars for any number of masters. Deactivation and removal of service eligibility require confirmation when they affect future bookings. Renaming preserves existing booking snapshots. Changes to service duration use the same confirmation flow.

The calendar follows configured hours rather than a fixed 09:00–18:00 window. Manual booking and blocks use the salon's timezone, even when the browser uses another timezone. The frontend filters masters by the selected service; the backend makes the final availability and overlap checks. If a catalog or hours are incomplete, the booking engine returns no matching slots.

Actual VK carousel photos still require uploaded photo IDs configured on the backend. Production split deployment has not been accepted. Run `node --check app.js` for a syntax check; local browser/API checks do not prove a Timeweb rollout.

Local verification (2026-09-30): Chrome passed 16 checks through the actual admin API and PostgreSQL 16.15, including creating a salon from an empty catalog, two working intervals per day, a 90-minute booking, cancellation confirmation/dismissal, a Los Angeles browser timezone with Moscow appointment time, and a 390px mobile viewport. The screenshots were inspected; no browser JavaScript errors occurred. The local test used a proxy instead of the production Nginx container. Independent verification covered the backend and calendar functions; its cloud browser could not access localhost.

Deploy together with the constructor version of LeraBack. Its Docker startup now initializes the schema and the first administrator automatically; existing databases, credentials and sessions are retained. Configure frontend `BACKEND_URL` as the backend HTTPS origin without a trailing slash and use `/healthz` for the frontend process check. Backend uses `/livez` for its process check and `/healthz` for database readiness. See the [Timeweb setup guide](https://github.com/rtalyutin/LeraBack/blob/main/TIMEWEB.md). Catalog setup is then done in the interface.
