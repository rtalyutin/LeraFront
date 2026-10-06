# Constructor validation — 2026-10-06

final result: blocked

## Active contract

Implement the user-approved constructor in `rtalyutin/LeraFront` with supporting API changes in `rtalyutin/LeraBack`. Preserve existing salon authentication, catalog editing, metadata, calendar and VK behavior. The schedule preview must use real booking availability; saving hours must preserve confirmed appointments.

Approved source: `image-edit-target-6b28a434cfac01c7.png`, 1486 × 1058, SHA-256 `630e9107819add31ffececa0cb8a86632b3e9689b0fde251f97e0206cc1e2d70`. The reference was opened and inspected. Implemented anchors: light background, lime working days and primary action, step rail, large schedule heading, common/per-day hours, real client preview and VK continuation. Additional screens reuse the existing functional editors.

## Verified

- JavaScript syntax and 85 existing scoped transport, salon, metadata and VK regression checks pass against the changed source.
- Backend author checks: all 15 constructor UX tests passed on disposable PostgreSQL-compatible PGlite 18.3 with a non-superuser role. Full unconfigured suite: 77 tests, 29 passed and 48 skipped because their native database URLs were absent.
- Native acceptance wiring includes a dedicated `CONSTRUCTOR_UX_TEST_DATABASE_URL` and disposable database in LeraBack's existing `compose.test.yml`. Run `docker compose -f compose.test.yml run --build --rm tests` there for native PostgreSQL coverage; this container run was not executed in this environment.

Independent verification: 8 backend scenarios and 16 DOM scenarios passed using JSDOM, actual HTTP and a disposable PGlite database with a non-superuser role. Coverage includes saved/unsaved availability, simultaneous master/room overlays, occupied windows, booking preservation, malformed multi-day atomicity, injected database rollback, cross-salon rejection, grouped/per-day hours, empty/closed days, retained drafts, two-resource saves, stale preview rejection, service/master/room creation and renaming, unequal resource IDs, salon creation/renaming and explicit draft discard before switching.

This check found and then rechecked two defects: resource tabs stayed disabled after saving one draft; the header retained an old salon name after renaming. Both passed on the final source. The PGlite harness serializes HTTP because socket clients share one backend; it is not evidence of native PostgreSQL concurrency. An injected error may be replaced by psycopg's PGlite pipeline rollback text, so rollback was verified through unchanged business rows rather than an exact exception message. A DOM emulator does not verify rendered layout, font metrics, actual viewport overflow or browser console behavior.

## Blocked visual gate

The automatic approval review rejected cloud-browser access to `http://terminal.local:4173/`, explaining that the retry could bypass an earlier browser security rejection. No alternative browser, raw CDP or screenshot workaround was used.

There is no current implementation screenshot. Visual similarity, desktop/tablet/mobile layout, actual horizontal overflow and real-browser interaction/console acceptance remain unverified. CSS defines two-column desktop and single-column narrow-screen layouts, but those rules are not evidence of a successful render. No visual scores or screenshot comparison are claimed.

Required next step: obtain approval to open the synthetic local preview in the cloud browser, inspect and capture desktop and narrow viewports, compare them with the approved source, test primary actions and console, fix material issues, then replace this blocked verdict with the observed result. Keep this change in draft review until the browser gate is resolved. Live VK connection, Timeweb deployment and production smoke testing are separate and have not been performed for this revision.

## Task state

Implementation and automated functional validation are complete. Publication is a paired frontend/backend draft change. Remaining acceptance boundary: real-browser visual and responsive verification, followed by release of both repositories in backend-first order.

## Entry screen validation — 2026-10-06

Result: **PASS for the entry-screen change**. This is a separate frontend task and does not replace the constructor-wide acceptance boundary above.

The approved promo direction is cream paper, black outlines and lime accents, with service/master/time notes leading into an example calendar appointment. The existing login remains functional. Registration is represented only by the disabled `регистрация скоро` button, outside the login form. On mobile, the login form follows the introduction before the illustration.

All 85 existing checks passed. An independent executor also passed 19 DOM/HTTP scenarios and 14 real-browser checks in headless Chromium 153, DPR 1, against synthetic API responses. These covered unsuccessful/successful login, restored sessions, empty accounts, workspace/header visibility, constructor preview and schedule save, CSRF, keyboard interaction, native form validation, disabled registration and logout. No application errors or failed resource requests were observed.

Rendered screenshots were inspected at 320, 390, 768, 1440 and 1920 CSS pixels. Document width matched each viewport; note and appointment text fitted horizontally and vertically; mobile introduction/form/example/features ordering was checked through bounding boxes. Initial text overflow at 320 and 768 pixels was corrected and independently rechecked. Final tested `auth.css` SHA-256: `45d055cd2f02b2d01fd8e258a292dc971db4f7c4f3bc23935d68d7d37e5984d2`.

Validation follows the recorded approved visual direction; the original promo image was not available for pixel comparison. Live backend/VK, a production Docker build and Timeweb rollout were not tested for this frontend change.
