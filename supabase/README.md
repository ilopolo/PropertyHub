# Supabase

DB-A/B е приложено в съществуващия проект `qfybswnezdzzahmozikr`. Не създавай нов проект. Приложени версии:

- `20261029205815_access_core.sql`: профили, организации, memberships, роли/каталог, audit, organization onboarding и затворен операторски bootstrap.
- `20261029205824_registry_scope.sql`: сгради, входове, обхвати/назначения, обекти/периоди и контролирани RPC.
- `20261029210354_access_indexes.sql`: FK индекси.
- `20261029210914_access_identity_guards.sql`: текуща потвърдена Auth идентичност и защита при изтрит получател.

Файловете са създадени с официалния CLI; след прилагане чрез Supabase plugin имената са синхронизирани с действителните remote версии от `list_migrations`. Не прилагай същите SQL файлове отново върху този проект. За нова безопасна тестова база прилагай по ред, в транзакции. Миграциите изискват стандартните Supabase роли/Auth, PostgreSQL 15+ и btree_gist. Няма промени/тригери в управляваните auth/storage схеми; има FK към auth.users и разрешено сървърно четене на потвърждението. Локалната PGlite проверка имитира само нужния Auth договор, а не пълния Supabase stack. Docker/Supabase reset не е изпълняван.

## Auth конфигурация

Проверено на 29.10.2026: email provider включен, signup разрешен, Confirm email включено, anonymous sign-ins и manual linking изключени. Data API върна `PGRST106` за private и потвърди exposed schemas `public, graphql_public`. Остави private неизложена.

Site URL остава `http://localhost:3000`. Потребителят добави двата Redirect URLs; последващ read-only Dashboard преглед потвърди точно два запазени адреса:

- `http://127.0.0.1:5173/pages/account.html`
- `http://127.0.0.1:4173/pages/account.html`

Приложението подава callback URL от действителния origin. PKCE потвърждението трябва да се отвори в същия браузър/профил, в който е започнала регистрацията. При hosting се добавя действителният HTTPS callback и се преглежда Site URL; няма измислен live адрес. Не изключвай потвърждението като обход на SMTP проблем.

SMTP Settings е проверено: custom SMTP е изключен. Според [официалната документация](https://supabase.com/docs/guides/auth/auth-smtp) вграденият изпращач допуска само имейлите на членовете на Supabase организацията. За личния първи тест използвай имейла, с който членуваш в организацията на проекта; друг адрес изисква собствен SMTP. Не се обещава доставка преди действително получено писмо и не се отгатва текущият лимит. Email/OTP expiry, password policy, JWT expiry, session lifetime и числовите rate limits остават непроверени: Authentication → Sign In / Providers → Email; Sessions; Rate Limits; Project Settings → JWT Keys/свързаните JWT настройки. Не изпращай пароли/ключове в чат. `signOut({scope:'local'})` приключва текущия клиентски login; не се твърди, че вече издаденият JWT веднага изтича.

Локалният адрес е `http://127.0.0.1:5173/pages/account.html` при работещ `npm.cmd run dev`; production preview е на `http://127.0.0.1:4173/pages/account.html`. Потребителят лично се регистрира и потвърди login → pending без права → logout/reload → повторен login. Confirmation връзката показа грешка; DB и последващият вход потвърждават, че Auth имейлът е потвърден. Причината за конкретната callback грешка не е доказана и нов чист callback още не е приет. `check:auth-callback` проверява безопасната класификация на изтекли/използвани връзки, session проблеми и съществуваща потвърдена сесия. Не се иска ново писмо като единствен изход за вече потвърден акаунт. Агентът не е създавал личния акаунт/парола или platform назначение. Вграденият callback е разрешен изрично, така че непромененият Site URL не се използва за този signup път. Отваряй новите връзки в същия браузър/профил и origin, в който са поискани.

## Първи platform admin

Създай/потвърди одобрения акаунт. В страницата Акаунт се показва точният Auth UUID. Операторът сверява UUID и потвърждението в доверена среда. `operators/bootstrap-platform-admin.sql` приема psql променлива `auth_user_id`; няма вградени credentials. Ако използваш Dashboard SQL Editor, след сверка изпълни само `select private.bootstrap_platform_admin('ТОЧНИЯТ_UUID'::uuid);` със заменена стойност, в транзакция.

Функцията не е exposed RPC, anon/authenticated нямат EXECUTE. Един фиксиран target, идемпотентно повторение за същия UUID, отказ за друг, audit запис. Не избира първия signup. Bootstrap е изпълнен операторски на 29.10.2026 след личния pending тест и предоставен от потребителя точен Auth UUID. Преди изпълнение е сверена потвърдената неанонимна Auth идентичност и уникалната profile връзка. След изпълнение са проверени active профил, точно platform_admin/manage_platform, един bootstrap state и един съответстващ audit запис, без org membership/scope или други роли. Личният UUID не се включва в публичната документация. Довереният операторски достъп служи за setup и проверка на записите, не е доказателство за потребителски RLS. Промяна/възстановяване на platform/org admin и последен администратор изискват отделен recovery процес; няма публичен generic delete/demotion endpoint.

Platform admin преглежда заявка за организация и активира нейния подател като първи org admin. Org admin създава нов контекст и назначава потвърден съществуващ акаунт по точен Auth UUID. Manager получава read_registry/manage_registry, controller — read_registry. Назначението и собствеността са отделни. Административните роли не наследяват operational registry/finance права; org admin може изрично да назначи и себе си в допустимия обхват. Staff покани с токени, owner заявки/връзки, касиерски/финансови права и password reset UI още не са реализирани; зависимите функции не са временно отворени.

## Проверки

`npm.cmd run check:db` прилага всички миграции върху празен временен PostgreSQL и проверява 17 групи, включително реално записани/непроменени редове, 2-org изолация, grants, RLS, periods/FK, bootstrap и отнемане. Auth таблицата и JWT claim setting са локални fixtures: това НЕ са реални GoTrue сесии.

За hosted потребителски проверки създай три отделни потвърдени синтетични акаунта без назначения. В игнориран `.env.rls.local` запиши `RLS_A_EMAIL`, `RLS_A_PASSWORD`, `RLS_B_EMAIL`, `RLS_B_PASSWORD`, `RLS_PENDING_EMAIL`, `RLS_PENDING_PASSWORD`. Скриптът приема само publishable ключ; не използва service-role за assertions.

При текущия built-in SMTP поддържан начин за тези fixtures е [Auth Admin API createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser), извикан само от доверена операторска/server среда. За всеки от трите изрично синтетични акаунта се задават уникален тестов имейл, отделна случайна парола и `email_confirm: true`. Административният secret/service-role ключ остава само в средата на setup процеса — никога във VITE_*, frontend, Git или чата. Не се променя глобалният Confirm Email, не се добавят тестовите потребители към Supabase организацията и не се записва директно в auth схемата. Всеки акаунт започва без приложни роли; след setup тестовете влизат с email/password и ползват обикновени JWT сесии и publishable ключ. Това доказва login/RLS, но не email delivery/владение на пощата. За реално тестване на confirmation писма към други адреси е нужен custom SMTP. Този вариант е предложен; тестови акаунти още не са създадени.

1. `npm.cmd run check:rls -- --prepare` влиза с реалните акаунти, създава минималните им pending профили и генерира `.local/rls-fixtures.sql` и `.local/rls-fixtures.json`. SQL не е приложен автоматично. Отказва акаунти с вече съществуващи роли или стар manifest.
2. Прегледай и приложи fixture SQL през доверен операторски SQL достъп само в посочения проект. Създават се две синтетични организации, scopes и отделни org-admin/manager назначения за A/B, без platform bootstrap и без промени в auth. Това е подготовка, не RLS доказателство.
3. `npm.cmd run check:rls` проверява с реални сесии записите в двете org, чужди SELECT/INSERT/UPDATE/DELETE, забранено повишение чрез metadata, revocation със същата сесия, възстановяване по разрешения процес и logout. Fixture записите остават за инспекция; скриптът не ги изтрива и не ги публикува.

Към този checkpoint hosted сценарият е BLOCKED поради липса на потвърдени тестови акаунти. Потребителят отложи създаването им до собствената си регистрация. Подготвен е само игнориран празен `.env.rls.local` шаблон. `npm.cmd run check:public-api` реално проверява Auth flags, exposed schemas, отказани анонимни SELECT и ensure_profile RPC без signup; това не е достатъчно за приемане на 2-org теста.

Audit/bootstrap таблиците умишлено нямат клиентски grants/policies; security advisor ги отбелязва с INFO `rls_enabled_no_policy`. Не добавяй отворена policy за премахване на известието. [Описание на проверката](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). FK предупрежденията са отстранени; unused indexes са очаквани върху празната схема.

Service-role ключове, DB пароли, refresh/access tokens и тестови пароли не принадлежат във frontend, VITE_* или Git. Hosting/live и Storage остават предстоящи.
