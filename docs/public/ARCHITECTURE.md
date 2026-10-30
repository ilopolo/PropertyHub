# Реализирана архитектура

HTML/CSS/чист JavaScript/Bootstrap, Node/npm/Vite. Девет HTML входа: начало, dashboard, buildings, account, login, register, platform-admin, organization-admin и съвместимият admin навигационен индекс. Регистрация/вход и двата административни процеса имат отделни файлове. Общият ES module зарежда навигация, тема, BG ресурси и каталог. Контролерите в `src/pages` обработват формите; `src/ui` съдържа споделени UI операции, `src/services` извиква Supabase SDK/Auth/Data API. Няма React/Vue/TypeScript.

```mermaid
flowchart LR
  HTML[Отделни HTML страници] --> Controller[src/pages]
  Controller --> UI[src/ui: навигация и тема]
  Controller --> Catalog[src/domain: каталог]
  Controller --> Services[src/services: Auth, access, registry]
  Services --> Supabase[Supabase Auth / Data API]
  Supabase --> RLS[Grants + RLS + проверени RPC]
```

Тъмната тема използва Bootstrap `data-bs-theme` и `localStorage` ключ `propertyhub.theme` (само предпочитание, без лични данни). При забранен storage изборът работи в текущата страница. CSS tokens са в `src/styles/main.css`. Няма analytics.

DB-A/B миграциите са приложени в установения Supabase проект. Има 14 приложни таблици в public и затворена private.bootstrap_state. Всички public таблици имат RLS. Няма anon grants за приложните таблици/RPC. Само колони за собствено име/предпочитания имат директен UPDATE; добавянето на регистър и административните промени минават през контролирани функции. Public RPC са SECURITY INVOKER обвивки към изрично разрешени, проверяващи текущата Auth идентичност SECURITY DEFINER функции в неизложената private схема, с фиксиран празен search_path. Bootstrap няма public обвивка или клиентски EXECUTE. Audit е append-only чрез доверените операции. [Миграции, setup и проверки](../../supabase/README.md).

Профилът има собствен UUID и отделна уникална auth_user_id връзка. След потвърден вход ensure_profile създава pending профил без роля. Потвърден имейл не доказва собственост/служебно право. Единствено името за представяне може да се вземе от user_metadata; права не се извеждат от metadata. Първото platform назначение изисква доверен оператор, точен одобрен и потвърден Auth UUID и еднократно фиксиране в bootstrap_state. След личния pending тест и предоставен от потребителя UUID bootstrap е изпълнен на 29.10.2026: проверени са active профил, един platform_admin/manage_platform grant и съответстващи bootstrap/audit записи, без организационни или оперативни роли.

Platform admin активира проверена заявка за организация и първо org admin назначение. Org admin управлява разрешените manager/controller назначения в собствените активни org/scopes; няма автоматичен registry/finance достъп. Manager работи с изрични read_registry/manage_registry; controller чете. Проверяват се текущи profile/role/membership/org/management assignment/status/периоди при всяка заявка. Архивиране/редакция на регистъра, касиерски функции, покани с токени, owner links и финансови операции следват в отделни пакети.

Началният scope използва отделна административна заявка за manager пакет към точен confirmed акаунт, с 48h срок и преглед на текущото право на издателя. Само получателят приема: физическият контекст, членството и изричният manager grant се записват атомарно. Чист org admin не наследява оперативни права; старият `create_management_context` е затворен. Org staff projection показва минималните назначения в собствената организация, без глобален профилен каталог. Organization onboarding вече допуска корекция, оттегляне, отказ и активация с основание/exact revision; token invites и owner links остават затворени.

Шестте DB-B таблици пазят typed source kind/reference, known_from, needs_review/verified, recorder/reviewer/time/note. При създаване стойностите са непроверени; липсваща площ остава неизвестна и след преглед на останалите стойности. Един source packet покрива въведените стойности на реда. Field-level evidence за смесени източници и исторически редакции трябва да предшества отварянето на такива операции. Verified ред не е финансова готовност; собственост, обитаване и дялове още не са реализирани.

```mermaid
erDiagram
    AUTH_USERS o|--o| PROFILES : authenticates
    PROFILES ||--o{ ORGANIZATION_MEMBERSHIPS : joins
    ORGANIZATIONS ||--o{ ORGANIZATION_MEMBERSHIPS : has
    ORGANIZATION_MEMBERSHIPS ||--o{ USER_ROLES : grants
    PROFILES ||--o{ USER_ROLES : holds
    ROLE_PERMISSIONS }o--o{ USER_ROLES : validates
    BUILDINGS ||--o{ ENTRANCES : contains
    BUILDINGS ||--o{ MANAGEMENT_UNITS : scopes
    BUILDINGS ||--o{ UNITS : contains
    MANAGEMENT_UNITS ||--o{ MANAGEMENT_ASSIGNMENTS : assigned
    ORGANIZATIONS ||--o{ MANAGEMENT_ASSIGNMENTS : manages
    MANAGEMENT_UNITS ||--o{ USER_ROLES : limits
    MANAGEMENT_UNITS ||--o{ UNIT_SCOPE_PERIODS : includes
    UNITS ||--o{ UNIT_SCOPE_PERIODS : belongs
    PROFILES ||--o{ ACCESS_REQUESTS : requests
    ORGANIZATIONS ||--o{ SCOPE_SETUP_REQUESTS : authorizes
    PROFILES ||--o{ SCOPE_SETUP_REQUESTS : receives
    MANAGEMENT_UNITS o|--o| SCOPE_SETUP_REQUESTS : fulfills
    PROFILES o|--o{ AUDIT_EVENTS : acts
```

Диаграмата показва основните отношения. ROLE_PERMISSIONS→USER_ROLES се валидира с trigger/контролирана функция, а не с масивен FK. Composite FK пазят entrance/building и membership/profile съвместимост; trigger валидира unit/scope; exclusion constraints забраняват припокрити membership/management/unit-scope периоди. Няма автоматично сливане по адрес или прехвърляне на чуждо управление.

Преминали са 22 локални PostgreSQL групи с тестови Auth fixtures; те не са live Auth сесии. Потребителят потвърди реални login, pending без административни/registry права, logout/reload и повторен login преди bootstrap. Confirmation връзката е върнала грешка, въпреки че акаунтът е потвърден. Обработката вече различава изтекла/използвана връзка, session проблем и доказана текуща confirmed сесия, без да твърди конкретна причина за историческия случай или да отразява token/error_description. Нов чист callback още не е проверен. Bootstrap записите са проверени операторски. След отделен Auth Admin setup са изпълнени 11 hosted групи с три обикновени password сесии и publishable ключ, плюс logout: първо scope/manager приемане, действителни unit/period записи, cross-org SELECT/INSERT/UPDATE/DELETE откази, pending/metadata/self-elevation, staff projection, provenance, requester lifecycle и revocation със същата сесия. Operator fixture SQL създава само двете синтетични организации/org admin основания и не служи за RLS доказателство. Fixtures остават за инспекция. Browser записващите действия, чист callback, Storage и live deployment още не са приети; DEV-02 не е завършен.

`vite build` включва само изричните HTML входове и техните зависимости. Планиращият пакет е игнориран от Git; достъпът до него през dev сървъра е забранен. За hosting се използва само `dist/`. Development и preview се обвързват към loopback, не към LAN.

Допълнително са преминали 18 реални Playwright/Edge случая за org/registry: две ширини, две теми, разрешен/pending достъп, own-org опции, навигация/reload и browser errors. Всички snapshots са действително прегледани; danger outline contrast е поправен и целево проверен при четирите комбинации (6.05:1 light, 8.54:1 dark). UI scope request/revoke и unit create/verify са проверени с реалните записи през ordinary A сесия; неизвестната площ остава NULL. Това не удостоверява още UI scope приемане/staff assign/revoke, clean email callback или live deployment.
