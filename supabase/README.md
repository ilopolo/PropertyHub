# Supabase — setup, схема и проверки

## Hosted Storage приемане — PASS, 01.11.2026; frontend release предстои

Проект **qfybswnezdzzahmozikr**, **18 приложени миграции / 25 приложни таблици (21 public + 4 private)**. Управляваните Auth/Storage таблици не са включени в броя. [20261101094452_unit_file_download_boundary.sql](migrations/20261101094452_unit_file_download_boundary.sql) е приложена еднократно с точната версия; предишните17 SQL файла са неизменени. LF-SHA256 на новата миграция: `3f3ebcb47d47966c8bd9e7c022d04b72310cbfa614a7d65e1953a5bafbc56b31`. Един [JS Edge handler](functions/download-unit-file/index.js) `download-unit-file`, версия1 ACTIVE/verify_jwt=true, е deployed в Supabase. **Netlify main/live b088cfb още няма файловия UI; PR #2 остава отделен, без merge/production публикация.**

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

Реалната frontend проверка използва `npm run dev` на127.0.0.1:5173, synthetic scoped staff и маркиран PDF; проверява upload→ready→download SHA→remove и действителните DB записи. Не е нужен нов email/PKCE/redirect сценарий. QA credentials не са reviewer/demo credentials. Следващото release решение е отделно: PR review/combined main merge/един Netlify production deploy/целеви live smoke. В този пакет няма main merge/production/manual preview/budget проверка; full MVP, сигнали и други модули не се обявяват за завършени.

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

Не прилагай миграциите повторно върху този проект и не преименувай изпълнени версии. Ownership действителната версия е194407;193517 е било име на непубликуван draft. Приложените SQL statements и локалните файлове са сверени след LF/trim normalization. Private таблици: bootstrap_state, person_revisions, ownership_batches, occupancy_batches. Всички21 public таблици имат RLS. Няма приложни anon grants; private не се излага през Data API.

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
