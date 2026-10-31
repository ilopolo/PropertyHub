# Supabase — setup, схема и проверки

Установеният проект е qfybswnezdzzahmozikr. **Hosted baseline:14 приложени SQL миграции;24 приложни таблици:20 public +4 private.** Управляваните auth/storage таблици не са включени. Историята е сверена при съответните feature checkpoints; тази документационна редакция не прилага SQL или променя настройки. [README](../README.md) · [Действителни ER отношения](../docs/public/ARCHITECTURE.md).

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

Не прилагай миграциите повторно върху този проект и не преименувай изпълнени версии. Ownership действителната версия е194407;193517 е било име на непубликуван draft. Приложените SQL statements и локалните файлове са сверени след LF/trim normalization. Private таблици: bootstrap_state, person_revisions, ownership_batches, occupancy_batches. Всички20 public таблици имат RLS. Няма приложни anon grants; private не се излага през Data API.

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

Командите съществуват в package.json; тук не са преизпълнявани функционални тестове:

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


## Private файл към имот — локално проверен кандидат, още без hosted release

Този branch съдържа [20261031113950_private_unit_file.sql](migrations/20261031113950_private_unit_file.sql), **НЕПРИЛОЖЕНА** миграция. Hosted baseline остава14 миграции /24 приложни таблици (20public+4private); branch след прилагане би бил15 /25 (21public+4private). Без managed-schema DDL: добавя private bucket unit-private-files и ограничени policies върху storage.objects; не редактира Supabase таблици/функции. Bucket name collision или липсващ storage.allow_only_operation(text) спират миграцията, вместо да променят наличното.

- Съществуващото планирано manage_documents е optional manager permission +read_registry, изрично назначавано в собствен managed scope от org admin през assign_staff_role. В UI пакетът „Файлове“ означава manager с точно тези две права, без manage_registry. Няма автоматична промяна на стари роли или inheritance от platform/org admin. Existing manager с друг permission пакет се прекратява и се назначава изрично подходящият subset през съществуващия lifecycle; няма тихо добавяне към старата роля.
- Един активен файл на scope/unit; само PDF, application/pdf,1..5242880bytes (5MiB). Генериран immutable path scope/unit/document.pdf; без upsert/copy/versions. Клиентски SHA-256 се сравнява с реално свалени bytes при upload и download; това не е server content attestation, проверка за malware или удостоверяване на PDF. Bucket налага MIME/размер, не доказва съдържание. Няма inline preview.
- Default visibility=staff. Само изрично избраното owners допуска текущ проверен собственик чрез fresh my_owned_units projection. Собственикът чете ready файла, няма upload/delete/оперативни права. Няма общо право върху всички документи към имота. Metadata и bytes проверяват същите scope/visibility/current rights; owner projection не издава uploader/history.
- prepare_unit_document→pending15min; upload през Storage API, без upsert; authenticated download +SHA256 check; complete_unit_document проверява actual object size/MIME, тогава ready. Недовършено/изтекло качване не е owner-visible. Manager го отменя и качва отново; няма автоматично доизмисляне/публикуване.
- remove_unit_document първо записва tombstone/actor/reason и спира download. Storage API remove изтрива bytes; finish_unit_document_removal потвърждава липсващ object и запазва история. При прекъсване UI предлага довършване; SQL DELETE на storage.objects не е приложен метод за физическо изтриване. Current right revocation спира новите metadata/byte заявки; вече свален файл не може да бъде отнет.
- Само authenticated get. SELECT е operation-specific; signed URL, signed upload, list/copy и UPDATE/upsert не се предоставят. Restrictive guards ограничават и бъдещи broad permissive policies за този bucket, без да променят другите buckets. Download използва cache:no-store и upload cacheControl:0.

### Локални проверки и граници

npm.cmd run check:unit-file-domain; npm.cmd run check:unit-file-db; npm.cmd run check:unit-file-browser. Първите проверки са pure domain и временен PGlite PostgreSQL с изрична Storage schema/helper fixture. Browser runner използва действителен Edge, действителния frontend/SDK и real HTTP upload/download bytes върху локален Node QA transport +SQL/RLS; **НЕ е Supabase Storage/Auth runtime**, не чете env credentials и блокира hosted заявки. Browser screenshots/отчети са ignored. Тези доказателства не са hosted Storage PASS или пълен local Supabase stack PASS.

### Оставащ release gate — без автоматично изпълнение

1. Read-only свери hosted history14 и hash на baseline, operation helper/Storage API version, managed grants/RLS, bucket name absence и наличните policies. Feature клон не изолира Supabase. При несъвпадение спри и отчети; не пресъздавай fixtures/миграции.
2. След отделно разрешен release прозорец приложи точно новата additive миграция транзакционно преди новия frontend. Старият live b088cfb остава съвместим: старите RPC signatures/default grants не са изменени, новата capability не е дадена на никого автоматично. При failure не merge-вай UI.
3. С existing synthetic ordinary sessions и минимално изрично file grant (без лични акаунти) докажи реалния Storage API: private/public/sign отказ, MIME и5MiB граница, interrupted pending/cleanup, upload→download actual bytes+SHA256; anonymous/foreign scope отказ, default staff-only/explicit owner audience и same-session revocation. Свери actual metadata/object записи и физически bytes, после оттегли точно временните synthetic grants/links и премахни само новите synthetic files чрез Storage API. Не използвай operator ключ за RLS доказателство. Hosted helper/operation mapping и multi-transaction races остават непроверени локално.
4. Само след тези gates обедини проверени промени в разрешен merge към main/една production публикация с бюджетен резерв; после targeted live navigation/download/revoke. Настоящият PR НЕ се merge-ва и няма production deployment. При rollback на frontend остави additive DB и отказаните pending/removed записи за контролиран cleanup; не drop-вай/преименувай историята.


Verified-owner история: действителната приложена/committed версия е20261031092207_verified_owner_access.sql;20261031091247 е била неприлагана CLI чернова. Local/committed/saved applied statement hash е e3a12961f10c23ebc1a50baad74d6075 (LF/trim). Номерът на черновата в стар списък не е основание за rename или reapply.

### Подготвен hosted Storage harness — още НЕ е изпълнен

[check-unit-file-hosted.mjs](../scripts/check-unit-file-hosted.mjs) има безопасен **offline plan** по подразбиране: не зарежда env, не влиза в Auth и не изпраща HTTP. Целта е фиксирана към qfybswnezdzzahmozikr — същият споделен проект с live версията, **не изолиран staging**. Скриптът никога не прилага миграции или създава Auth акаунти. [Локалната preparation проверка](../scripts/check-unit-file-hosted-preparation.mjs) проверява execution/project/path guards, собствеността на journal ресурсите, guarded membership SQL и синтетичен валиден PDF с точни5MiB/5MiB+1 размери. Това не е managed Storage runtime тест.

```powershell
npm.cmd run check:unit-file-hosted
npm.cmd run check:unit-file-hosted-preparation
```

За бъдещо отделно разрешено изпълнение са нужни игнорирани fixture/journal под .local/storage-hosted-qa. Fixture форматът е project,org,scope,unit,foreignScope,foreignUnit,person:{id,revision},auth:{A,B,OWNER},profiles:{A,B,OWNER}; всички ID са UUID на предварително проверени синтетични ресурси. Точните IDs не се публикуват. В локалната работна среда има подготвен fixture от предишния owner journal и read-only inventory; не го пресъздавай с нови акаунти/организации. Преди execute свери IDs/current grants/person revision/ownership и заетия file slot.

Credentials се четат само в execute режим от игнорираните .env.local, .env.rls.local, .env.password-policy.local и optional .env.storage-qa.local:

| Променливи | Предназначение |
|---|---|
| VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY | Точният project URL и само publishable key; не privileged key |
| RLS_A_EMAIL, RLS_A_PASSWORD | Съществуващ synthetic A: org admin за назначенията, без файлово наследяване |
| RLS_B_EMAIL, RLS_B_PASSWORD | Съществуващ synthetic B: временно файлово/verifier назначение в A; след revoke отново само чужд scope B |
| PASSWORD_QA_EMAIL, PASSWORD_QA_PASSWORD | Вече съществуващият изолиран owner QA акаунт, без нова парола/reset |
| STORAGE_QA_MANAGEMENT_TOKEN | Optional Management API token с database write достъп за конкретния проект; **само за точния membership cleanup**, не за access assertions. Не е Project Secret/service-role. Алтернативата е existing operator connector с генерирания guarded SQL |

Не въвеждай пароли/token в CLI аргументи, VITE_ променливи за операторски ключове, чат, screenshots или Git. Изходът не съдържа credentials, еднократни URL или API response bodies. Sessions са ordinary, без persistence/auto-refresh; same-JWT сравненията остават само в RAM. Global Confirm Email и личните акаунти не се променят. Pending QA акаунтът не се използва, за да остане pending.

След отделно разрешен read-only preflight и apply на миграцията, **НЕ като част от настоящата подготовка**:

```powershell
npm.cmd run check:unit-file-hosted -- --phase setup --execute --project qfybswnezdzzahmozikr --external-membership-cleanup
npm.cmd run check:unit-file-hosted -- --phase assertions --execute --project qfybswnezdzzahmozikr
npm.cmd run check:unit-file-hosted -- --phase cleanup --execute --project qfybswnezdzzahmozikr
```

- **setup:** проверява ordinary identities, baseline role/membership IDs, наличен document RPC/capability, person/ownership и свободния slot. Missing RPC/schema е preflight failure, никога успешен deny. A дава на B нов manager subset read_registry/manage_documents и отделно verify_owner_access; после B създава точно маркирана owner връзка. Не се изменят старите A/B назначения.
- **assertions:** реални SDK upload/download SHA256 на малък staff-only и точен5MiB owner PDF; default privacy; anonymous/public/signed отказ; raw MIME/size откази и incomplete pending/complete refusal; чужди scope/unit IDs. B role се отнема, а **owner positive control още сваля същите bytes** — така foreign refusal не се бърка с липсващ файл. Втори изричен временен B grant възстановява само test setup за owner-link revoke/cleanup. Проверява се действително отнемане на owner bytes/metadata при същия JWT и проследим tombstone→Storage API remove→finish. Няма SQL DELETE на storage.objects.
- **cleanup:** само journal IDs и filename marker storage-qa-<run>-<kind>.pdf, с проверка на uploader/scope/unit и link evidence. Запазва document/link/role/audit историята; не изтрива Auth/person/unit/org или baseline grants. Новият B membership в A се деактивира само по exact ID/profile/org и при липса на активни роли. Default operator вариантът генерира <journal>.membership-cleanup.sql; изпълни го през съществуващия connector след преглед и повтори само cleanup. Дотогава cleanup не е PASS. Optional token използва [Management API query](https://supabase.com/docs/reference/api/v1-run-a-query), beta endpoint; ако той е недостъпен/променен, остани на reviewed SQL през connector, без заобикаляне на права. Привилегированият cleanup не е RLS доказателство.

setup отказва върху съществуващ journal. Assertions не се повтарят върху interrupted/completed run; първо cleanup/сверка, после нов journal path. Lock предпазва от паралелен writer. При pending role/link/prepare intention, неочаквано позволен negative write или stale lock: първо установи крайния server result по точните ID/marker и journal/.tmp, после документирано поправи състоянието; не изтривай lock и не повтаряй setup на сляпо. Completed cleanup се отчита RETAIN, не нов hosted PASS. Възможни многотранзакционни Storage races и provider operation mapping остават отделни hosted gates.

Проверено в тази подготовка: syntax/offline guards/fixture ownership/PDF boundaries, **0 HTTP от preparation теста**. Read-only connector inventory потвърди14 миграции, неприложена Storage миграция, липсващи bucket/documents, наличен helper и подходящите стари synthetic данни. Няма изпълнени hosted setup/assertions/cleanup и няма нов Storage PASS. Продуктовите SQL/policies/service са само прегледани, без промяна.
