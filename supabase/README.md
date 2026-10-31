# Supabase — setup, схема и проверки

Установеният проект е qfybswnezdzzahmozikr. **14 приложени/committed SQL миграции;24 приложни таблици:20 public +4 private.** Управляваните auth/storage таблици не са включени. Историята е сверена при съответните feature checkpoints; тази документационна редакция не прилага SQL или променя настройки. [README](../README.md) · [Действителни ER отношения](../docs/public/ARCHITECTURE.md).

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
