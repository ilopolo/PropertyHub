# Supabase — setup, схема и проверки

## Минимално приложение към сигнал — локален child пакет

Зависимост: PR #5, `feature/owner-signals`/`4a6b10f`. Child `feature/ticket-attachment` се предлага към родителския клон, не към main. Parent минималните сигнали имат hosted PASS; **attachment има само локално приемане**. Локален кандидат `20261101195615_ticket_attachment.sql`:21 migration файла/28 application tables; последно потвърдени hosted20/27. Нито кандидатът, нито новият bucket/Edge function са приложени/deployed в този пакет.

Един активен pending/ready файл към сигнал: PNG (`image/png`), JPEG (`image/jpeg`) или PDF (`application/pdf`),1..5242880bytes, безопасно basename до120Unicode символа с правилно разширение. Private `ticket-private-files`, immutable server key `scope/item/document.ext`, no upsert. Upload/read само текущият проверен подател или изрично scoped `manage_tickets`. Owner reporter премахва само собствен upload; staff може всеки разрешен файл с причина. Друг съсобственик, `manage_documents`, registry-only, platform/org admin не наследяват достъп. Status на сигнала не се променя от файла. Няма нова capability или разширяване на имотните документи.

`ticket_attachments` е минимален typed document target с composite scope/item FK, uploader/time/type/size/SHA,15min pending lease и ready/removed/bytes-deleted история. Create idempotence изисква същия request UUID и payload. Incomplete/expired upload се показва за изрично прекратяване; не се изтрива мълчаливо. Tombstone→Storage API remove→finish запазва причината/audit и позволява довършване след прекъсване. Без SQL DELETE на `storage.objects`. Complete проверява обект/размер/MIME; SHA/signature се проверяват при всяко защитено четене. Няма antivirus/full image decoding/EXIF обработка или гаранция за достоверност на съдържанието.

Нов `download-ticket-file`: само `{document_id}`→`auth.getUser`→caller-identity `authorize_ticket_file_download` с текущи права и session existence→fixed exact-key S3 GetObject→bounded size/SHA256/PNG-JPEG-PDF signature→повторна caller RPC→no-store attachment. Общият транспорт е `_shared/private-file-download.js`; unit adapter запазва строгия си unit/PDF договор. Новият handler връща `application/octet-stream`+attachment/nosniff за коректен Blob през installed functions-js, а trusted metadata/S3 запазват конкретния MIME. Direct Storage bytes/sign/list/info/copy/user-S3 не са download пътища; restrictive SELECT е само за разрешено delete/delete_many. Няма URL fallback. След отнемане новата заявка трябва да откаже със същия JWT; вече получени bytes не могат да се отнемат.

Локални проверки без credentials/hosted requests:

```powershell
npm.cmd run check:ticket-file-db
npm.cmd run check:ticket-file-download
npm.cmd run check:ticket-file-service
npm.cmd run check:ticket-file-browser
npm.cmd run check:unit-file-download
npm.cmd run build
```

DB проверките ползват disposable PGlite с изрични Auth/Storage fixtures. Service/browser ползват реален supabase-js/HTTP, application JS и handler с локални Auth/S3 adapters. Те доказват локалните contracts/policies/bytes, **не реалния provider/CDN/Storage runtime**. Browser е истински Edge,375/1440px, две теми, навигация/reload; screenshot QA артефактите са локални и игнорирани. Test credentials са генерирани само в RAM за `.invalid` фиктивни акаунти; не се създават hosted users.

### Следващо hosted приемане — изисква отделно възлагане

1. Read-only preflight за `qfybswnezdzzahmozikr`: parent20 versions, candidate отсъства, review на LF-SHA256 и непроменени20 стари SQL, target table/bucket/RPC/function липсват, operation helper и managed RLS са налични. Само migration21 pending в exact-version CLI dry-run. Не изпълнявай стари migration helpers, твърдо насочени към19/20.
2. Exact apply само `20261101195615`, после действително потвърждение на history, grants/RLS/bucket private/MIME/size. Няма ръчно timestamp/history repair. При неизвестен резултат първо read-only reconciliation. Additive схема е съвместима с current main/live и parent signal frontend; unit policies/capabilities остават непокътнати.
3. Presence-only проверка на **съществуващите server secrets**: `UNIT_FILES_PUBLIC_KEY` (публичният publishable key за caller RPC), `UNIT_FILES_S3_ENDPOINT=https://qfybswnezdzzahmozikr.storage.supabase.co/storage/v1/s3`, `UNIT_FILES_S3_REGION` (действителният регион), `UNIT_FILES_S3_ACCESS_KEY_ID`, `UNIT_FILES_S3_SECRET_ACCESS_KEY` (само сървърно S3 GetObject). Supabase предоставя `SUPABASE_URL`. Не извеждай стойности, не копирай във VITE/frontend/Git, не оттегляй работния S3 key. В този пакет нито се искат, нито се записват нови реални keys/secrets. Ако липсват/не разрешават новия bucket, спри за конкретна конфигурация; не разширявай права на предположение.
4. След разрешение deploy **само** `supabase functions deploy download-ticket-file --project-ref qfybswnezdzzahmozikr` (pinned local CLI; verify_jwt остава true). Bundler включва shared core. Няма нужда от redeploy на съществуващия unit handler; неговият hosted v1 не е променен от локалното извличане на shared кода.
5. Reuse на съществуващите синтетични Auth A/B/password-QA при нужда от двама current verified co-owners; без нови users. Запиши baseline/sobstveni IDs/run marker, временни scoped manage_tickets/verify_owner_access назначения и owner links само ако липсват и са разрешени. Не засягай лични записи/pending. Assertions са с обикновени сесии: реални PDF/PNG/JPEG bytes/SHA, reporter/staff upload/read, owner own-only removal, друг съсобственик на същия имот/foreign scope/anonymous отказ, positive download→role revoke→same-JWT отказ, отделно owner-link revoke. Докажи непозволени direct authenticated/public/sign/sign-many/list/info/copy/S3 user reads с positive Edge control; no-store success/error headers. Type/size limits се проверяват директно към Storage API отделно от app validation. Провери incomplete/missing/expired upload, exact removal и local frontend→hosted. Конфигурационна грешка не е authorization PASS.
6. Cleanup само записаните собствени object paths чрез разрешените tombstone/API/finish операции; оттегли само временните grants/links/membership и закрий само собствените QA сесии. Пази ticket/status/document/audit history; нулеви owned Storage objects и remaining pending resources се сверяват действително. При прекъсване запиши IDs и неизвестните операции преди повторение. Не чисти общи fixtures по prefix. CLI operator token се изчиства след употреба; server S3 secrets остават работни.
7. Едва след hosted gate: parent review/merge по отделно release решение, retarget child към main и re-review само добавката. Без самостоятелни merge/deployment/retries сега. Публикацията се планира отделно с бюджета; няма промяна на hosting настройки.

Официална основа: [bucket type/size restrictions](https://supabase.com/docs/guides/storage/buckets/creating-buckets), [operation-specific Storage helpers](https://supabase.com/docs/guides/storage/schema/helper-functions). Наличните локални проверки не заместват бъдещото hosted приемане.

## Минимален сигнал: hosted приемане PASS, frontend в draft PR

Exact [20261101141944_owner_signals.sql](migrations/20261101141944_owner_signals.sql) и [20261101180527_ticket_revision_conflict.sql](migrations/20261101180527_ticket_revision_conflict.sql) са приложени еднократно с точните версии след single-pending CLI dry-run/hash gates. Текущо: **20 приложени миграции /27 таблици (23public+4private)**;20локалниSQLфайла. Последната миграция променя само stale conflict кода на private status функцията; няма нова таблица, роля или frontend логика. Приложените SQL файлове не са редактирани.

Предишните hosted ordinary-session проверки доказват current owner create/own-author read, same-unit co-owner privacy, foreign scope, forged/direct DML откази, lifecycle/history и отделни same-JWT role/link revoke. Local frontend→hosted UI е проверен. Последният blocker е затворен с **един тесен real-browser тест**: current revision6→HTTP204/revision7; stale6→**HTTP409/PT409 за109ms**, actual row/events unchanged; actual page reload→current7→HTTP204/revision8. Няма останали retry заявки. Това съответства на [PostgREST custom HTTP errors](https://docs.postgrest.org/en/stable/references/errors.html#raise-errors-with-http-status-codes) и отстранява [проблема с40001/PostgREST14 retries](https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions).

Cleanup е действително потвърден: новите временни роли ended, новата membership inactive, нови QA сесии0; по-старите synthetic сесии и personal/pending fingerprints са запазени, Auth акаунти7. Няма нов signal/person/unit/ownership/ownerlink или Storage ресурс в коригиращия тест. Запазени са същите3completed marked сигнала; първият вече еrevision8, общо16events/16signal audit реда. По-ранното изрично одобрено synthetic person verification остава audited fixture промяна; новият тест не я променя. CLI token е изчистен. Две QA подготовителни грешки са поправени преди status заявките; stale заявката не е преизпълнявана.

Owner създава само за текущ разрешен собствен имот; author/scope/new са server-derived. Собственият прочит изисква авторство и текуща проверена собственост. Нов собственик не наследява чужди сигнали; историческият нефинансов достъп предстои. Org admin назначава explicit scoped manage_tickets; platform/org/registry/document права не го наследяват. Статуси: new→accepted→in_progress→completed, reopen completed→in_progress с причина. Direct client DML е отказан; събитията са append-only.

Локалните команди check:tickets, check:tickets-api, check:tickets-browser и check:ticket-revision са описани в package.json; disposable PostgreSQL/симулираният Auth transport сами по себе си не са hosted доказателство. Коригиращият пакет не повтаря тези завършени набори: използва запазеното локално доказателство и новия narrow hosted тест. Hosted PASS тук е само за минималния сигнален договор, **не за целия REQ009/DB-G/MVP**.

Следва отделно разрешен release review на PR #5; той остава draft/unmerged. Main/live2e1b8f3 не съдържа signal UI. Backend е съвместим с текущия main и не изисква повторен apply, нов server secret или Auth/hosting настройка при бъдещ frontend release. Не е правен merge/production deployment или бюджетна проверка в acceptance пакета.

Файл към сигнал, категория/отговорник, прости задачи, известия и отчети са отделни приети MVP стъпки. Ticket attachment изисква собствен договор за target, owner upload, type/size, audience, отнемане, incomplete upload и проследимо премахване. Staff-managed unit PDF не предоставя това право. Няма промяна на неговите bucket/policies/Edge download.

## Hosted Storage приемане — PASS, 01.11.2026

Исторически checkpoint на Storage release в проект **qfybswnezdzzahmozikr**: **18 приложени миграции /25 таблици**; текущият signal checkpoint е20/27, описан по-горе. Управляваните Auth/Storage таблици не са включени в броя. [20261101094452_unit_file_download_boundary.sql](migrations/20261101094452_unit_file_download_boundary.sql) е приложена еднократно с точната версия; предишните17 SQL файла са неизменени. LF-SHA256 на новата миграция: `3f3ebcb47d47966c8bd9e7c022d04b72310cbfa614a7d65e1953a5bafbc56b31`. Един [JS Edge handler](functions/download-unit-file/index.js) `download-unit-file`, версия1 ACTIVE/verify_jwt=true, е deployed в Supabase. **Този код обединява Storage PR #2 и theme fix PR #3 в един release; production се публикува само от main. Git/общият release PR установяват конкретния публикуван commit и ready резултат.**

| Реално проверено с обикновени синтетични сесии | Резултат |
|---|---|
| PDF upload → pending integrity → ready → Edge/S3 bytes | 621 bytes и точно5242880 bytes със съвпадащ SHA-256 |
| Staff default и изричен owner opt-in | Неупълномощеният owner отказва; текущият проверен owner чете само owners файла |
| Anonymous, чужд scope и подменен document ID | Отказ; не се използват счупен transport/configuration за доказателство |
| Успешен download → role revoke → повторен download | Отказ с непроменен JWT и същия document ID; отделен owner positive control още чете |
| Успешен owner download → owner-link revoke | Отказ със същия JWT, без refresh/nonce |
| Direct Storage default/authenticated/public/info/head/range/render и повторен default GET |400 при наличен файл и положителен handler control |
| Signing, batch signing, list и copy | Sign400; batch200 с error и без URL; list200 с празен набор; copy отказ |
| Директен S3 GetObject с user JWT + валиден legacy anon |404 NoSuchKey, докато handler чете съществуващия файл; не privileged RLS доказателство |
| HTTP cache граница | Успешните и отказаните Edge отговори са no-store; успешен CDN статус DYNAMIC, без ETag; безопасни headers са запазени |
| Действителен local frontend → hosted | Реален browser upload/integrity/download/hash/removal; reload; разгледани375/light и1440/dark, без overlap/overflow/console/page errors |

Cleanup е потвърден от действителните записи: **0 objects;5 собствени document history реда removed/bytes_deleted;2 временни роли отнети;owner link оттеглен;новото собствено membership inactive**. Audit историята остава. Auth accounts7; fingerprint сверка на защитените profiles/roles/requests/memberships е непроменена. Личният admin/request и pending акаунтът не са променяни. CLI token и локалните S3 credential копия са изчистени; работният S3 key и петте server secrets са запазени. QA evidence/journals/screenshots са локални/игнорирани, не публичен demo достъп.

Предишният SDK/CDN same-JWT FAIL и fail-closed allowed-download отказ са исторически реални резултати. Те доведоха до тази граница; старите приложени SQL не са редактирани. Не се твърди, че стар Storage URL непременно проверява текущите права. Вече получени bytes не могат да бъдат отнети; старите премахнати cached QA обекти не са пресъздавани. При отнемането се повтаря вече успешната **handler** заявка; директните клиентски URL вече никога не получават read разрешение за новите файлове.

## Договор за private файл

Един активен PDF/application/pdf към scoped имот,1..5242880 bytes, immutable generated path, без upsert/версии/OCR/malware scan/inline preview. `manage_documents` е изрично optional scoped manager право с `read_registry`; няма platform/org-admin/manage_registry наследяване. Owner read изисква едновременно `visibility=owners` и текуща проверена account-person/ownership връзка. Default е staff. Собствеността не създава служебни права.

Клиентът подава само document ID: Auth getUser → caller-JWT RPC/current session/current DB права → точен trusted metadata key → server-only S3 GetObject → bounded размер/SHA-256 → повторна RPC авторизация → no-store attachment. Pending integrity е разрешен само на uploader с текущи права и срок. Няма direct Storage fallback, подписан/публичен URL или cached permission ticket. Client Storage SELECT остава само за authorized delete/delete_many на removed документ. Премахване: tombstone → Storage API remove → finish; историята остава, прекъсване изисква проверка преди retry.

Общ25s abort и5MiB buffer ограничават заявката. Подписан JWT сам не доказва текуща роля; RPC проверява и session_id. Заявка, разрешена преди committed отнемане, може вече да е върнала bytes; няма обещание за атомарна DB+S3 транзакция или ретроактивно изтриване от клиентски диск.

## Server setup и последваща ротация

Настройките вече са записани в проекта. **Не прилагай миграциите и не създавай S3 key повторно при restart.** Бъдещи промени изискват exact project/history/hash preflight, отделно разрешение и съвместимост с live.

| Edge server variable | Предназначение |
|---|---|
| UNIT_FILES_PUBLIC_KEY | Съществуващ sb_publishable ключ за caller-scoped Auth/RPC; не operator key |
| UNIT_FILES_S3_ACCESS_KEY_ID / UNIT_FILES_S3_SECRET_ACCESS_KEY | Generated server S3 credentials; никога frontend/VITE/Git/logs |
| UNIT_FILES_S3_ENDPOINT | https://qfybswnezdzzahmozikr.storage.supabase.co/storage/v1/s3 |
| UNIT_FILES_S3_REGION | eu-west-1, проверена за този проект |

SUPABASE_URL се предоставя от Edge runtime и се проверява за точния project. Generated S3 key има всички S3 операции/all buckets и bypass RLS; **не е scoped readonly ключ**. Handler кодът допуска само GetObject за вече разрешения metadata обект. Caller authorization никога не използва привилегированата самоличност.

При бъдещ разрешен deploy/rotation: временен CLI token само в игнориран `.env.migration.local`; нужните scopes са database_write/database_pooling_config_read за apply и edge_functions_read, edge_functions_write, edge_functions_secrets_read и edge_functions_secrets_write за function/secret операции. Не се иска projects_read при explicit project ref.403 на secrets inventory блокира gate до проверена корекция, не се заобикаля. Secrets се подават чрез игнориран `.env.edge.local`, не като CLI аргументи:

```powershell
npx --no-install supabase secrets set --project-ref qfybswnezdzzahmozikr --env-file .env.edge.local
npx --no-install supabase functions deploy download-unit-file --project-ref qfybswnezdzzahmozikr --use-api
```

Командите не са инструкции за повторение сега. Не използвай prune/no-verify-jwt. При ротация първо заместващ S3 key → server secret update → положителен download и отрицателни проверки → едва след потвърждение revoke на стария key. Локалните копия/CLI token се изчистват след използване; работните server secrets остават нужни. Текущият работен key не е оттеглян. Няма покупка или hosting промяна.

Free ограниченията за invocations/uncached egress и runtime memory/CPU остават; тестът не е load/abuse тест и не обещава неограничена безплатна работа. Не е измерено отчитането на двата мрежови хопа. [Private caching KB](https://supabase.com/kb/troubleshooting/storage-private-bucket-files-still-accessible-after-remove-access-or-logout), [S3 auth](https://supabase.com/docs/guides/storage/s3/authentication), [Edge auth](https://supabase.com/docs/guides/functions/auth).

## Целеви проверки и повторно hosted изпълнение

Pinned server imports/lock: Supabase JS2.118.0, AWS S3 SDK3.1161.0, Smithy FetchHttpHandler5.8.0; не влизат в browser bundle. Локалните PGlite/Auth/S3 fixtures се различават от реалното hosted приемане:

```powershell
npm run check:unit-file-download
npm run check:unit-file-download-db
npm run check:unit-file-download-integration
node scripts/check-unit-file-hosted-probes.mjs
npm run check:unit-file-hosted
```

Последната команда по подразбиране е **OFFLINE PLAN**, без env/login/HTTP/mutation. Hosted изпълнение е само по отделно възлагане с exact project, прегледан fixture и **нов** маркиран journal; старите cleaned journals не се replay-ват. Нужни са обикновените A/B/OWNER credentials в `.env.rls.local`/`.env.password-policy.local`, public config в `.env.local` и `STORAGE_QA_LEGACY_ANON_KEY` в `.env.storage-qa.local` за поддържания S3 user-token режим (не service_role/publishable). Windows S3 subprocess изисква Deno2.9.6 в `.local/edge-tools/node_modules/deno/deno.exe`; например локален tool install с `npm install --prefix .local/edge-tools --no-save deno@2.9.6`. Няма operator credential в access assertions. Optional STORAGE_QA_MANAGEMENT_TOKEN е само за exact guarded membership cleanup.

```powershell
npm run check:unit-file-hosted -- --phase setup --execute --project qfybswnezdzzahmozikr --journal .local/storage-hosted-qa/new-run.json --external-membership-cleanup
npm run check:unit-file-hosted -- --phase assertions --execute --project qfybswnezdzzahmozikr --journal .local/storage-hosted-qa/new-run.json
npm run check:unit-file-hosted -- --phase cleanup --execute --project qfybswnezdzzahmozikr --journal .local/storage-hosted-qa/new-run.json --external-membership-cleanup
```

Setup проверява реални RPC/handler/key readiness преди grants. Copy probe записва exact target/intention; timeout/неочакван успех изисква state reconciliation. Не се приема transport/config failure за denial PASS. Safe evidence съдържа само status/header allowlist/резултати, без request headers, tokens, signed URLs или response bodies. Cleanup засяга само journal-owned rows/objects; traceable audit се пази. При нужда generated guarded membership SQL се изпълнява през доверен operator след review; baseline memberships не се приемат за собствени.

Реалната frontend проверка използва `npm run dev` на127.0.0.1:5173, synthetic scoped staff и маркиран PDF; проверява upload→ready→download SHA→remove и действителните DB записи. Не е нужен нов email/PKCE/redirect сценарий. QA credentials не са reviewer/demo credentials. Общият Storage/theme release проверява само интеграцията, следва един main merge/автоматичен Netlify production deploy и тесен live smoke. Старият hosted набор не се replay-ва; миграции/secrets/Edge deployment не се повтарят. При release проблем се записват доказателства и recovery план, без автоматичен втори deploy. Full MVP, сигнали и други модули не се обявяват за завършени.

## Миграционна история

| Файл | Реализиран обхват |
|---|---|
| [20261029205815_access_core.sql](migrations/20261029205815_access_core.sql) | Profiles, organizations, memberships, роли/каталог, audit, onboarding, private bootstrap |
| [20261029205824_registry_scope.sql](migrations/20261029205824_registry_scope.sql) | Buildings/entrances/scopes/assignments/units/periods и guarded RPC |
| [20261029210354_access_indexes.sql](migrations/20261029210354_access_indexes.sql) | FK индекси |
| [20261029210914_access_identity_guards.sql](migrations/20261029210914_access_identity_guards.sql) | Текущ confirmed/non-anonymous Auth actor |
| [20261029230135_explicit_scope_setup.sql](migrations/20261029230135_explicit_scope_setup.sql) | Отделно manager предложение/приемане; затворен org-admin-only physical RPC; staff projection |
| [20261029230141_registry_provenance.sql](migrations/20261029230141_registry_provenance.sql) | Typed provenance, author/time и review на DB-B |
| [20261029230146_organization_request_lifecycle.sql](migrations/20261029230146_organization_request_lifecycle.sql) | Revision/correct/withdraw/reject/activate/audit |
| [20261029233202_provenance_calendar_date.sql](migrations/20261029233202_provenance_calendar_date.sql) | known_from спрямо Europe/Sofia business date |
| [20261030160838_scoped_persons.sql](migrations/20261030160838_scoped_persons.sql) | Scoped persons, field evidence, optimistic revision, private history |
| [20261030194407_ownership_periods.sql](migrations/20261030194407_ownership_periods.sql) | Ownership periods, set reviews, private idempotent batches |
| [20261030203754_occupancy_periods.sql](migrations/20261030203754_occupancy_periods.sql) | Individual/aggregate occupancy periods, set reviews, private batches |
| [20261030205226_occupancy_subject_guard.sql](migrations/20261030205226_occupancy_subject_guard.sql) | Physical person/current revision guard и review invalidation |

| [20261031092207_verified_owner_access.sql](migrations/20261031092207_verified_owner_access.sql) | Explicit verifier делегация, account-person history и минимален current owner projection |
| [20261031092951_owner_verifier_explicit_delegation.sql](migrations/20261031092951_owner_verifier_explicit_delegation.sql) | Само отделният verifier setter може да включи правото с основание; generic INSERT отказ |

| [20261031113950_private_unit_file.sql](migrations/20261031113950_private_unit_file.sql) | Private bucket, document lifecycle, scoped permission и guards |
| [20261101081203_unit_file_authenticated_info.sql](migrations/20261101081203_unit_file_authenticated_info.sql) | Историческа info preflight диагностика |
| [20261101082303_unit_file_uncached_download.sql](migrations/20261101082303_unit_file_uncached_download.sql) | Исторически fail-closed read attempt; immutable SQL |
| [20261101094452_unit_file_download_boundary.sql](migrations/20261101094452_unit_file_download_boundary.sql) | Current authorization/session RPC и handler-only client read policies |
| [20261101141944_owner_signals.sql](migrations/20261101141944_owner_signals.sql) | Приложен minimal signal schema/RPC/RLS; първоначалният stale код е коригиран от следващата миграция |
| [20261101180527_ticket_revision_conflict.sql](migrations/20261101180527_ticket_revision_conflict.sql) | Приложена exact корекция40001→PT409; current/staleHTTP409/reload и cleanup HOSTED PASS |

Не прилагай миграциите повторно върху този проект и не преименувай изпълнени версии. Ownership действителната версия е194407;193517 е било име на непубликуван draft. Приложените SQL statements и локалните файлове са сверени след LF/trim normalization. Private таблици: bootstrap_state, person_revisions, ownership_batches, occupancy_batches. Всички23 public таблици имат RLS. Няма приложни anon grants; private не се излага през Data API.

За отделна безопасна тестова Supabase база историята се прилага по ред/в транзакции след сверка на remote history. Нужни са стандартните Supabase Auth роли/схема, PostgreSQL15+ и btree_gist. Не се редактират произволно managed auth/storage схеми; има FK към auth.users и guarded read на потвърждението. Имената на CLI командите се проверяват с инсталирания CLI help преди операция. **Пълен Docker/Supabase clean reset и clean-checkout setup не са изпълнени**; PGlite rebuild проверява само нужния PostgreSQL/Auth договор.

## Клиентска и Auth конфигурация

Копирай .env.example като .env.local и попълни VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY за установения проект. И двете са публични. Secret/service-role/DB пароли/SMTP ключове не се поставят във frontend, VITE_*, Git или логове. Local dev/preview командите са в README. Hosting env съдържа само публичните две стойности.

Последната потвърдена конфигурация от30.10.2026 (не нова Dashboard проверка): Site URL https://propertyhub-ilopolo.netlify.app; точно три разрешени redirect адреса:

- https://propertyhub-ilopolo.netlify.app/pages/account.html
- http://127.0.0.1:5173/pages/account.html
- http://127.0.0.1:4173/pages/account.html

Email provider/signup и Confirm Email са включени; anonymous sign-ins/manual linking са изключени. **Custom SMTP с Brevo Free е настроен и реалната доставка на confirmation/reset е доказана**. Built-in SMTP ограничението вече не е текущ blocker и не изисква Supabase team membership за тестовите получатели. SMTP credentials са само в Dashboard. Няма маркетинг или бъдещи напомняния. За бизнес версията предстоят собствен удостоверен домейн и преглед на разходите според потреблението. Настоящата университетска конфигурация не е гаранция за бъдещи provider лимити или доставка.

Signup/recovery започват и завършват в същия браузърен профил и origin. Реални доставени писма, PKCE, confirmed pending session без роли, logout/relogin и recovery new-password login/old-password отказ са проверени с отделни акаунти. Историческият flow_state_expired не отменя последващия чист signup PASS. Password-reset интерфейсът и account password change са реализирани.

Временна политика: server minimum8/no character requirements; UI8–256+поне една ASCII цифра. API допуска8 символа без цифра — UI не е server enforcement. Няма forced reset или допълнително uppercase/special изискване; existing login остава разрешен. Единна server политика предстои преди бизнес старт. Leaked-password protection е останала OFF при предходния преглед; не се заявява нова настройка или пълна business security готовност. Local signOut не означава незабавна невалидност на вече издаден JWT.

## Bootstrap и назначения

[Операторският bootstrap](operators/bootstrap-platform-admin.sql) е изпълнен еднократно за одобрения точен confirmed Auth UUID. Няма public wrapper/client EXECUTE; пази фиксиран target и audit, не избира първия signup. Не го изпълнявай повторно за друг акаунт. Личен UUID/парола не се публикуват. Новите потребители остават pending без роли.

Platform admin активира проверена organization заявка; org admin управлява ограничени изрични назначения в своята org. Първият scope изисква точен confirmed manager recipient,48h предложение и лично приемане; записва отделен operational grant. Manager: read_registry/manage_registry; controller: read_registry. Няма operational inheritance от platform/org admin, fake firm за self_managed или auto claim на чужд адрес.

Проверени account-person links и минимален current owner projection са реализирани; пълният финансов/исторически owner портал, token invitations и cashier/finance workflow още липсват. Ownership/occupancy registry не ги създава автоматично. verify_owner_access е отделно optional manager право, изрично назначавано от org admin на друг current manager в собствен managed scope чрез set_owner_verifier с основание. Потвърждаване/оттегляне изискват това право и read_registry; няма самопотвърждение или auto admin inheritance. Demo/reviewer достъпът е предстоящ и не използва личния platform admin или QA credentials.

## Проверки и синтетични ресурси

Командите съществуват в package.json. Текущият пакет изпълни само целевите Storage проверки; останалите suites не са повторени:

| Команда | Среда и ограничения |
|---|---|
| npm.cmd run check:db | Всички локални миграции във временен PGlite PostgreSQL; Auth/JWT са fixtures, не hosted sessions |
| npm.cmd run check:occupancy-db | Самостоятелен rebuild с целеви occupancy assertions |
| npm.cmd run check:unit-shares-domain | Само pure synthetic проценти/периоди/basis; без DB/API/UI |
| npm.cmd run check:rls | Hosted publishable key+ordinary A/B/pending sessions и вече проверен manifest; може да записва fixtures |
| npm.cmd run check:persons | Съществуващи synthetic resources; записва идентифицирани QA лица |
| npm.cmd run check:ownership | Ordinary-session atomic/history/isolation/concurrency/review проверки; запазени request keys |
| npm.cmd run check:occupancy | Ordinary-session count/mode/history/isolation/concurrency/review проверки |
| npm.cmd run check:occupancy-subject | Отделно synthetic scoped лице за type/revision guard; оставя го inactive, не създава Auth акаунт |
| npm.cmd run check:ownership-browser / check:occupancy-browser | Edge върху preview; за live --read-only и правилен CHECK_BASE_URL; credentials/manifests не се публикуват |

Синтетичните A/B/pending Auth акаунти и две организации вече са създадени; допълнителните QA scopes/лица/периоди остават за инспекция. **Не пресъздавай fixtures при retry.** Първо провери локалните journals и действителните записи; прекъсната заявка може вече да е завършила. QA env файловете и .local manifests липсват от публичния checkout по дизайн; тестовете не са универсален visitor setup.

Операторският [create-rls-users скрипт](../scripts/create-rls-users.mjs) използва Auth Admin API само за отделно разрешен setup; secret key е в игнориран .env.operator.local, никога в клиента. npm.cmd run setup:rls-users -- --create не е команда за повторение върху готовите ресурси. Administrative email_confirm доказва setup, не доставка. Реалните RLS assertions ползват ordinary sessions и publishable key, а не privileged ключ. Пароли и tokens не се извеждат. Глобалният Confirm Email не се изключва.

Запазени са hosted2-org/pending allow/deny и revocation със същата сесия, реални browser API→SELECT проверки, persons/ownership/occupancy и реални email PKCE проверки. Локалните и hosted доказателства се отчитат отделно. Историческите числа22/30/9 са конкретни test checkpoints, не общ брой актуални тестове или таблици. Screenshots и отчети са игнорирани, не публични credentials.

Audit и private bootstrap/history/batch таблиците умишлено са затворени за пряк клиентски достъп; RLS-without-policy INFO не се премахва с отворена policy. Изложените registry таблици имат конкретни scope policies. Storage upload/download, финансови/исторически owner projections, CSV import/export, signals, notifications и finance/reporting още не са реализирани. Идеалните части са domain-only. Виж публичната архитектура за съществуващите отношения и ограничения.

Owner-access checks: npm.cmd run check:owner-access-db (временен PostgreSQL); npm.cmd run check:owner-access-api (existing ordinary A/B/OWNER/PENDING sessions, publishable key, без нов Auth); npm.cmd run check:owner-access-browser (реални local Edge действия/снимки). State и request journals са ignored .local/owner-access-qa; не се публикуват и не се пресъздават след неизвестен резултат. Миграциите са additive спрямо предишния live backend; старите RPC signatures/default grants са непроменени.
