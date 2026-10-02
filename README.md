# LeraFront — prepared admin frontend

Deployment uses two new Timeweb Dockerfile applications and the existing tg-mcp PostgreSQL database. LeraBack's Docker image already selects its separate `lera` schema: only `DATABASE_URL` and the first-launch `SALON_ADMIN_PASSWORD` are required there. The frontend receives only `BACKEND_URL`. Exact app settings and database preparation are in the [Timeweb guide](https://github.com/rtalyutin/LeraBack/blob/main/TIMEWEB.md).

This is the existing synthetic salon admin UI, packaged as a separate Timeweb App Platform application. Build the included `Dockerfile`; set `BACKEND_URL` to the HTTPS origin of LeraBack **without a trailing slash**, for example `https://backend.example`. The Nginx template proxies `/api/*` to that service. Browser requests therefore keep one public origin for the `__Host-` session cookie and CSRF token. The backend domain also serves VK `/vk/callback` directly.

## Admin constructor

An existing account can access several salons; there is no registration screen. Select the current salon in the header. Only salons returned by the authenticated session are offered. The previous selection is restored per username only if it is still accessible; otherwise the first available salon is selected. Switching clears catalog data, selected resource IDs and unfinished forms before loading the new salon. All salon requests send `X-Salon-Id`; login, session, logout and the salon list do not. Aborted or late responses from an earlier salon cannot update the current workspace.

After login, use **Конструктор салона**:

1. Add services and their duration in whole minutes (1–1440).
2. Add masters; select the services each provides.
3. Add rooms; select the services each supports.
4. Set weekly hours for each master and room. Add multiple intervals for breaks or mark a weekday as closed. End time 24:00 is supported; overnight shifts are not.
5. Use **Свои справочники и поля** to add a custom directory, define its fields and create/edit records. Fields support text, integer, number, yes/no, date and links to records of a selected directory in the current salon. Existing core fields are shown read-only here; additional fields on core records are editable. Core catalog changes continue through the original catalog forms and booking-confirmation flow.

In **Мастера**, the inline **Мастер из другого вашего салона** form can attach an existing master from another accessible salon and assign services in the current salon. Names are labels; the request sends the source salon and master IDs, and the backend verifies both memberships. This does not merge client bookings across salons.

The frontend expects the salon-aware session contract (`salons: [{id, name, role}]`) and `/api/constructor` metadata (`types` with typed `parameters`, and `entities` with typed `values`). It submits metadata writes to `/api/constructor/types`, `/api/constructor/parameters[/id]` and `/api/constructor/entities[/id]`. Core entities can only submit additional values through the generic editor. Archived records are omitted from editors and reference choices. Parameter edits explicitly clear `reference_type_id` when switching to a scalar field. Metadata codes have at most 64 lowercase Latin letters/digits/underscores, starting with a letter; labels have at most 200 characters. `/api/shared-masters` provides candidates for `POST /api/masters/attach`. Integer values and IDs use JavaScript safe integers; full PostgreSQL int64 precision is not covered by this JSON-number frontend.

The constructor starts empty on a new database. Existing records remain editable. Master cards use initials as placeholder avatars for any number of masters. Deactivation and removal of service eligibility require confirmation when they affect future bookings. Renaming preserves existing booking snapshots. Changes to service duration use the same confirmation flow.

The calendar follows configured hours rather than a fixed 09:00–18:00 window. Manual booking and blocks use the salon's timezone, even when the browser uses another timezone. The frontend filters masters by the selected service; the backend makes the final availability and overlap checks. If a catalog or hours are incomplete, the booking engine returns no matching slots.

Actual VK carousel photos still require uploaded photo IDs configured on the backend. Production split deployment has not been accepted. Run `node --check app.js` for a syntax check; local browser/API checks do not prove a Timeweb rollout.

Salon-aware frontend verification (2026-10-02): `node --check app.js` and `node test_frontend_contract.cjs` passed. The 20 contract checks execute the actual frontend functions with a stub DOM/fetch: salon/CSRF headers, stale action/response rejection, snapshot ordering, switch reset, valid session-only selection, typed values, core field exclusion, clearing obsolete reference targets, archived record exclusion and escaped/type-limited references. Routes and payloads were also compared read-only with the implemented `admin_http.py`, `constructor_store.py` and `salon_service.py`. This is not a browser-render or live-backend test. Local Playwright has no installed Chromium executable; the cloud browser rejected the local URL with `net::ERR_BLOCKED_BY_CLIENT`, so the new UI has not received a browser visual check in this environment.

Local verification (2026-09-30): Chrome passed 16 checks through the actual admin API and PostgreSQL 16.15, including creating a salon from an empty catalog, two working intervals per day, a 90-minute booking, cancellation confirmation/dismissal, a Los Angeles browser timezone with Moscow appointment time, and a 390px mobile viewport. The screenshots were inspected; no browser JavaScript errors occurred. The local test used a proxy instead of the production Nginx container. Independent verification covered the backend and calendar functions; its cloud browser could not access localhost.

Deploy together with the constructor version of LeraBack. Its Docker startup now initializes the schema and the first administrator automatically; existing databases, credentials and sessions are retained. Configure frontend `BACKEND_URL` as the backend HTTPS origin without a trailing slash and use `/healthz` for the frontend process check. Backend uses `/livez` for its process check and `/healthz` for database readiness. See the [Timeweb setup guide](https://github.com/rtalyutin/LeraBack/blob/main/TIMEWEB.md). Catalog setup is then done in the interface.
