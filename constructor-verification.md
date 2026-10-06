# Independent constructor functional verification

Executor: `/root/constructor_verifier`, independent from implementation. Date: 2026-10-06.
Handoff: `FEATURE_HANDOFF/1`; digest `880ed9d2dc0004f39250f4a5c3739840cc1f9c4b37edf78b652dc787f5aa44e4`.

**Functional gate: PASS.** Eight independent backend scenarios and sixteen independent DOM scenarios passed on the final fingerprint in `verification/constructor/revision-final.sha256`, verified unchanged after execution. No unresolved functional defect found in the executed scope.

| Scope | Executed observation | Evidence |
| --- | --- | --- |
| Batch writes | Confirmed bookings retained on conflict; invalid later day causes no write; unselected weekday retained; injected later INSERT failure leaves schedule/bookings/audit unchanged | `verification/constructor/execution-9.log`, 8 backend cases |
| Preview | Saved availability equals booking engine; simultaneous master/room draft intersection equals manually expected slots; all inspected business rows unchanged | `verification/constructor/execution-9.log` |
| Access | HTTP requires session/CSRF; invalid payloads rejected; foreign salon denied; foreign resource draft/save rejected | `verification/constructor/execution-9.log` |
| Schedule editor | Common/individual transitions, mixed times, closing/reopening all days, multi-resource drafts, invalid times, navigation preservation work | `verification/constructor/dom-results.json`, 16 DOM cases |
| Save lifecycle | First of two drafts remains in schedule, controls re-enable, second save opens VK, schedule re-entry remains editable | `verification/constructor/dom-results.json` |
| Stale responses | Late date response and late old-salon response do not replace current preview | `verification/constructor/dom-results.json` |
| Onboarding/catalog | Real HTTP salon create/rename and service/master/room create/rename preserve mappings; incomplete salon gives explicit guidance, no slots, save disabled | `verification/constructor/dom-results.json` |
| Departure guards | Unsaved schedules prevent new-salon/logout; stay preserves draft; explicit discard allows requested header salon switch | `verification/constructor/dom-results.json` |
| Selected design | Static source and DOM retain setup sidebar, schedule editor, read-only availability preview and named service mappings | Approved input SHA recorded in `verification/constructor/revision-final.sha256`; source/DOM inspection |

Two reproduced defects were returned to the author and corrected: master/room tabs stayed disabled after save; setup header retained stale salon name after rename. Both passed the distinguishing scenario on final code. Earlier failures caused by wrong harness expectations (combined option text, edited input value before server readback) were corrected as oracle failures, not product defects.

**Rendering gate: BLOCKED.** No browser, Playwright, CDP, screenshot, viewport rendering, or native control visual verification was performed. Cloud-browser access was blocked by automatic approval review; DOM execution does not establish screenshot fidelity, responsive layout, browser accessibility interaction, or paint performance. Production deployment and live VK integration were not tested or changed.

Environment: Node 24.19.0, JSDOM **30.1.2**, PostgreSQL 18.3 through PGlite 0.5.8 WASM, synthetic data, local HTTP fixture, non-superuser role without BYPASSRLS. PGlite shares one backend across sockets; HTTP transport was serialized in the QA harness. These checks do not prove multi-connection PostgreSQL concurrency or durability. An injected INSERT error produced PGlite's `received 0 results from command 'ROLLBACK'`; raw text was retained and the required atomicity assertion checked actual stored rows. Product code was not changed by this verifier.

The recorded run used transient `run_embedded.py` and `run-qa.py` orchestration inside a disposable PGlite namespace; these wrappers are not product dependencies. The persisted DOM results omit HTTP request headers/bodies. Raw execution log credentials belong only to the destroyed synthetic fixture. `verification/constructor/execution-9.log` records child command exit **0**; the fixture wrapper was stopped with Ctrl-C after successful child completion because it kept the disposable socket server open.

Portable DOM artifact: `test_constructor_dom.cjs` (`npm run test:constructor` after installing dev dependencies). Overrides: `CONSTRUCTOR_FRONTEND_ROOT`, `CONSTRUCTOR_QA_BASE_URL`, `CONSTRUCTOR_QA_RESULT_PATH`. It expects the documented synthetic `ux_admin` fixture on the supplied endpoint. It deliberately uses real HTTP and an abort-insensitive delayed-response double for stale-response cases, without any browser surface. Portability/environment/date adaptations after the successful run received `node --check`; product fingerprints remained unchanged.

Browser acceptance and release remain pending; this report records only the functional scope above.
