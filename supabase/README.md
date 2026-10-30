# Supabase

DB-A/B е приложено в съществуващия проект `qfybswnezdzzahmozikr`. Не създавай нов проект. Приложени версии:

- `20261029205815_access_core.sql`: профили, организации, memberships, роли/каталог, audit, organization onboarding и затворен операторски bootstrap.
- `20261029205824_registry_scope.sql`: сгради, входове, обхвати/назначения, обекти/периоди и контролирани RPC.
- `20261029210354_access_indexes.sql`: FK индекси.
- `20261029210914_access_identity_guards.sql`: текуща потвърдена Auth идентичност и защита при изтрит получател.
- `20261029230135_explicit_scope_setup.sql`: отделно начално назначение с exact recipient/48h/приемане, затваряне на стария org-admin-only registry RPC и минимален преглед на назначенията в собствената организация.
- `20261029230141_registry_provenance.sql`: типизирани източник, known_from, needs_review/verified и сървърни автор/време; отделна защитена verification операция.
- `20261029230146_organization_request_lifecycle.sql`: корекция, оттегляне, отказ и activation review с revision/основание; creation audit само за новите заявки.
- `20261029233202_provenance_calendar_date.sql`: known_from се сверява с календарната дата Europe/Sofia, независимо от UTC session timezone; отделна регресионна проверка след полунощ.

Четирите допълващи миграции са приложени на 29.10.2026 UTC (30.10 Europe/Sofia) и remote statements са сверени с локалните файлове. Общо 14 public приложни таблици, всички с RLS, плюс затворената private.bootstrap_state. Началната заявка е административно намерение и не дава действаща роля. Org admin посочва точен confirmed получател за manager/read_registry/manage_registry; само получателят може да приеме и да създаде нов физически scope. Сървърът отново проверява издателя/org/срока; scope и отделният manager grant се записват атомарно. Чист org admin не може да създава physical registry през стария RPC. Няма автоматично самоназначение, сливане по адрес или разширяване към финансови права.

Минималният provenance пакет покрива въведените стойности на реда с един изричен източник. Непопълнена площ/етаж остава неизвестна и след проверка на наличните стойности. known_from е ограничение на известната история, не дата на покупка. Legacy редовете не получават измислен източник/дата. Field-level evidence за различни източници и исторически редакции е условие преди отваряне на такива редакции; финансов publish още няма. Локалният PostgreSQL набор е разширен до 22 групи; hosted потребителските проверки се отчитат отделно.

Файловете са създадени с официалния CLI; след прилагане чрез Supabase plugin имената са синхронизирани с действителните remote версии от `list_migrations`. Не прилагай същите SQL файлове отново върху този проект. За нова безопасна тестова база прилагай по ред, в транзакции. Миграциите изискват стандартните Supabase роли/Auth, PostgreSQL 15+ и btree_gist. Няма промени/тригери в управляваните auth/storage схеми; има FK към auth.users и разрешено сървърно четене на потвърждението. Локалната PGlite проверка имитира само нужния Auth договор, а не пълния Supabase stack. Docker/Supabase reset не е изпълняван.

## Операторско създаване на RLS потребители

`scripts/create-rls-users.mjs` е отделен Node инструмент, извън frontend dependency graph. Подготви локален игнориран `.env.operator.local` с един ред `SUPABASE_OPERATOR_SECRET=`. В Dashboard на същия проект → Project Settings → API Keys → Secret keys копирай наличния secret key само след `=` в този файл. Не го изпращай в чат/лог и не използвай VITE име. Инструментът проверява ignored/untracked пътищата, изисква modern secret key и фиксира project URL.

1. `npm.cmd run setup:rls-users` проверява локалната готовност без създаване.
2. `npm.cmd run setup:rls-users -- --create` създава точно A/B/PENDING с уникални `@propertyhub.invalid` адреси, случайни отделни пароли и `email_confirm: true`. Няма SMTP доставка, Supabase team membership или промяна на глобалния Confirm Email. Паролите се записват единствено в игнорирания `.env.rls.local`, а логът показва само A/B/PENDING и резултат. При частичен неуспех завършените записи се запазват локално и автоматично повторно създаване отказва; първо се инспектира състоянието.
3. Премахни стойността на операторския ключ от локалния файл след setup. Не е необходим за `check:rls`. Административното потвърждение на синтетичен акаунт не доказва доставка или владение на имейл.

Следват `check:rls -- --prepare`, преглед/операторско прилагане на генерирания fixture SQL и `check:rls` с обикновени password сесии. Скриптът проверява и реалното първо scope приемане, own-org staff projection, provenance и requester lifecycle. Не използва privileged ключ за assertions. Няма тестови credentials в публичния checkout.

## Текущи Auth настройки

Проверено на 29.10.2026: email provider включен, signup разрешен, Confirm email включено, anonymous sign-ins и manual linking изключени. Data API върна `PGRST106` за private и потвърди exposed schemas `public, graphql_public`. Остави private неизложена.

Site URL остава `http://localhost:3000`. Потребителят добави двата Redirect URLs; последващ read-only Dashboard преглед потвърди точно два запазени адреса:

- `http://127.0.0.1:5173/pages/account.html`
- `http://127.0.0.1:4173/pages/account.html`

Приложението подава callback URL от действителния origin. PKCE потвърждението трябва да се отвори в същия браузър/профил, в който е започнала регистрацията. При hosting се добавя действителният HTTPS callback и се преглежда Site URL; няма измислен live адрес. Не изключвай потвърждението като обход на SMTP проблем.

SMTP Settings е проверено: custom SMTP е изключен. Според [официалната документация](https://supabase.com/docs/guides/auth/auth-smtp) вграденият изпращач допуска само имейлите на членовете на Supabase организацията. За личния първи тест използвай имейла, с който членуваш в организацията на проекта; друг адрес изисква собствен SMTP. Не се обещава доставка преди действително получено писмо и не се отгатва текущият лимит. Email/OTP expiry, password policy, JWT expiry, session lifetime и числовите rate limits остават непроверени: Authentication → Sign In / Providers → Email; Sessions; Rate Limits; Project Settings → JWT Keys/свързаните JWT настройки. Не изпращай пароли/ключове в чат. `signOut({scope:'local'})` приключва текущия клиентски login; не се твърди, че вече издаденият JWT веднага изтича.

Локалният адрес е `http://127.0.0.1:5173/pages/account.html` при работещ `npm.cmd run dev`; production preview е на `http://127.0.0.1:4173/pages/account.html`. Потребителят лично се регистрира и потвърди login → pending без права → logout/reload → повторен login. Confirmation връзката показа грешка; DB и последващият вход потвърждават, че Auth имейлът е потвърден. Причината за конкретната callback грешка не е доказана и нов чист callback още не е приет. `check:auth-callback` проверява безопасната класификация на изтекли/използвани връзки, session проблеми и съществуваща потвърдена сесия. Не се иска ново писмо като единствен изход за вече потвърден акаунт. Личният акаунт и парола са създадени от потребителя; последващият операторски bootstrap е описан отделно. Вграденият callback е разрешен изрично, така че непромененият Site URL не се използва за този signup път. Отваряй новите връзки в същия браузър/профил и origin, в който са поискани.

## Първи platform admin

Създай/потвърди одобрения акаунт. В страницата Акаунт се показва точният Auth UUID. Операторът сверява UUID и потвърждението в доверена среда. `operators/bootstrap-platform-admin.sql` приема psql променлива `auth_user_id`; няма вградени credentials. Ако използваш Dashboard SQL Editor, след сверка изпълни само `select private.bootstrap_platform_admin('ТОЧНИЯТ_UUID'::uuid);` със заменена стойност, в транзакция.

Функцията не е exposed RPC, anon/authenticated нямат EXECUTE. Един фиксиран target, идемпотентно повторение за същия UUID, отказ за друг, audit запис. Не избира първия signup. Bootstrap е изпълнен операторски на 29.10.2026 след личния pending тест и предоставен от потребителя точен Auth UUID. Преди изпълнение е сверена потвърдената неанонимна Auth идентичност и уникалната profile връзка. След изпълнение са проверени active профил, точно platform_admin/manage_platform, един bootstrap state и един съответстващ audit запис, без org membership/scope или други роли. Личният UUID не се включва в публичната документация. Довереният операторски достъп служи за setup и проверка на записите, не е доказателство за потребителски RLS. Промяна/възстановяване на platform/org admin и последен администратор изискват отделен recovery процес; няма публичен generic delete/demotion endpoint.

Platform admin преглежда заявка за организация и активира нейния подател като първи org admin. Org admin предлага начално manager назначение към точен confirmed Auth UUID; само получателят приема и създава контекста атомарно с отделния grant. За действащ scope назначенията остават изрични. Manager получава read_registry/manage_registry, controller — read_registry. Назначението и собствеността са отделни. Административните роли не наследяват operational registry/finance права; org admin може изрично да назначи и себе си в допустимия обхват. Staff покани с токени, owner заявки/връзки, касиерски/финансови права и password reset UI още не са реализирани; зависимите функции не са временно отворени.

## Проверки

`npm.cmd run check:db` прилага всички миграции върху празен временен PostgreSQL и проверява 22 групи, включително реално записани/непроменени редове, 2-org изолация, grants, RLS, periods/FK, bootstrap и отнемане. Auth таблицата и JWT claim setting са локални fixtures: това НЕ са реални GoTrue сесии.

За hosted потребителски проверки създай три отделни потвърдени синтетични акаунта без назначения. В игнориран `.env.rls.local` запиши `RLS_A_EMAIL`, `RLS_A_PASSWORD`, `RLS_B_EMAIL`, `RLS_B_PASSWORD`, `RLS_PENDING_EMAIL`, `RLS_PENDING_PASSWORD`. Скриптът приема само publishable ключ; не използва service-role за assertions.

При текущия built-in SMTP поддържан начин за тези fixtures е [Auth Admin API createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser), извикан само от доверена операторска/server среда. За всеки от трите изрично синтетични акаунта се задават уникален тестов имейл, отделна случайна парола и `email_confirm: true`. Административният secret/service-role ключ остава само в средата на setup процеса — никога във VITE_*, frontend, Git или чата. Не се променя глобалният Confirm Email, не се добавят тестовите потребители към Supabase организацията и не се записва директно в auth схемата. Всеки акаунт започва без приложни роли; след setup тестовете влизат с email/password и ползват обикновени JWT сесии и publishable ключ. Това доказва login/RLS, но не email delivery/владение на пощата. За реално тестване на confirmation писма към други адреси е нужен custom SMTP. Операторският setup е изпълнен: точно три синтетични confirmed акаунта, без промяна на глобалния Confirm Email. Стойността на локалния operator secret е премахната след setup.

1. `npm.cmd run check:rls -- --prepare` влиза с реалните акаунти, създава минималните им pending профили и генерира `.local/rls-fixtures.sql` и `.local/rls-fixtures.json`. SQL не е приложен автоматично. Отказва акаунти с вече съществуващи роли или стар manifest.
2. Прегледай и приложи fixture SQL през доверен операторски SQL достъп само в посочения проект. Създават се само две синтетични организации и org admin назначения за A/B, без platform bootstrap и без промени в auth. Scope и отделният manager пакет се създават после от действителните потребителски сесии чрез изрично начално назначение и приемане. Това е подготовка, не RLS доказателство.
3. `npm.cmd run check:rls` проверява с реални сесии записите в двете org, чужди SELECT/INSERT/UPDATE/DELETE, забранено повишение чрез metadata, revocation със същата сесия, възстановяване по разрешения процес и logout. Fixture записите остават за инспекция; скриптът не ги изтрива и не ги публикува.

Hosted резултат: 11 реално преминали групи с publishable ключ и три обикновени password сесии, плюс logout. Scope/manager приемането е изпълнено от потребителските сесии след отделния operator fixture setup за двете организации. Проверени са cross-org SELECT/INSERT/UPDATE/DELETE с реалните редове, pending/self-elevation, staff projection, provenance, requester revision/withdrawal и revocation със същата сесия. Двете синтетични организации/обекти остават за инспекция. Личната platform заявка остава pending и не е активирана. Чист първи email callback още не е проверен; административният synthetic setup не го заменя.

Допълнително премина `npm.cmd run check:rls -- --calendar`: Bulgarian calendar known_from се записва през обикновената A сесия, следващата дата се отказва и няма записан ред. Това е целева проверка след календарната миграция, без повторение на целия набор. Отделен browser тест отказа ясно означена синтетична заявка; pending сесията потвърди rejected/revision=2/основание и липса на org/roles. Няма browser активация на организация. Проверени са също реалният platform екран и липсата на наследени org admin/registry форми; останалите записващи browser сценарии са отделни от преминалите API проверки.

Audit/bootstrap таблиците умишлено нямат клиентски grants/policies; security advisor ги отбелязва с INFO `rls_enabled_no_policy`. Не добавяй отворена policy за премахване на известието. [Описание на проверката](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). FK предупрежденията са отстранени; unused indexes са очаквани върху празната схема.

Service-role ключове, DB пароли, refresh/access tokens и тестови пароли не принадлежат във frontend, VITE_* или Git. Hosting/live и Storage остават предстоящи.
