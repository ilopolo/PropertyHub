# PropertyHub

Учебно приложение за управление на етажна собственост. DEV-02 добавя Supabase Auth интерфейс (регистрация/вход/изход/повторно потвърждение), pending профил, заявка за организация, контролирани назначения и минимален регистър. Девет HTML входа, Bootstrap и светла/тъмна тема. DB-A/B миграциите са приложени в установения Supabase проект. Личният тест потвърди login, pending без права, logout/reload и повторен login; Auth имейлът е потвърден в DB, но отварянето на confirmation връзката показа грешка и чистият callback още не е приет. Преминаха 11 hosted 2-org/pending RLS групи с реални потребителски сесии и проверки на записите; синтетичните fixtures остават за инспекция. Финанси, собственически връзки и Storage предстоят. Наличен код или заготовка не се отчита като преминал продуктов тест.

## Локален старт

Node.js 22.12+ (проверено с 24.19.0) и npm. В PowerShell използвай `npm.cmd`, ако политиката блокира `npm.ps1`.

```powershell
npm.cmd ci
npm.cmd run dev
```

Отвори http://127.0.0.1:5173. За production:

```powershell
npm.cmd run build
npm.cmd run preview
```

В отделен терминал при работещ preview:

```powershell
npm.cmd run check:navigation
npm.cmd run check:db
npm.cmd run check:auth-callback
```

Preview: http://127.0.0.1:4173. Проверявай отделно browser navigation/reload, mobile и темите; HTTP проверката не изпълнява браузърния JavaScript.

`npm.cmd run check:browser` използва Playwright с инсталиран Microsoft Edge и трите изолирани синтетични акаунта от игнорираната локална конфигурация. Нужни са вече проверени fixtures; скриптът не ги създава. Изпълнени са 18 случая за organization-admin/buildings при 375/1440 px, light/dark, разрешен и pending достъп, навигация/reload и изолация на собствената организация. Всички снимки са прегледани; поправеният контраст на destructive outline бутоните премина отделни четири проверки. `node scripts/check-browser-actions.mjs` проверява UI scope request/revoke и unit create/verify с реален SELECT на записите през обикновена сесия. Снимките и отчетите остават само в игнорирана `.local/`; пароли и сесии не се записват в тях. `node scripts/check-browser-appointments.mjs` допълнително премина live UI приемане на изрично начално назначение и controller assign/revoke, с проверка на реалния отделен manager grant и минималните controller права. Inbox е заснет и прегледан в четирите комбинации; след промяната преминаха 8 целеви A случая.

## Структура

- `index.html`, `pages/`: начало, табло, сгради/обекти, акаунт и администриране; отделните входове са във `vite.config.js`.
- `src/pages/`, `src/ui/`: контролер и споделена навигация/тема.
- `src/domain/modules.js`: каталог на модули/действия; не предоставя права.
- `src/services/`: Supabase client, Auth, контролирани административни операции и registry заявки.
- `src/i18n/`, `src/styles/`: BG ресурси и общи UI tokens.
- `supabase/migrations/`: действителни DB-A/B миграции; `supabase/operators/`: доверен bootstrap, без публичен endpoint.
- `docs/public/`: публична техническа документация.

## Конфигурация и безопасност

Публичните страници работят без `.env.local`; за Auth/данни копирай `.env.example` като `.env.local` и въведи URL и `sb_publishable_...` ключ на установения проект. Всички `VITE_*` стойности са видими в браузъра; никога service-role/secret ключ или DB парола. Регистрацията не дава роля. Профилът се създава от потвърдената Auth сесия с отделен вътрешен UUID; user_metadata се използва само за име за представяне. Права се извеждат от текущите DB назначения, не от клиентски claims или бутони.

Прочети [Supabase setup и проверки](supabase/README.md) преди миграция/първо назначение. `npm.cmd run check:db` използва временен PostgreSQL (PGlite) с тестова Auth схема; това не е live Supabase Auth тест. `npm.cmd run check:rls` изисква три отделни потвърдени синтетични акаунта и проверен fixture setup; при липса завършва с BLOCKED/exit 2, без фиктивен PASS.

Пакетът за планиране е локален и игнориран: `docs/*` извън `docs/public/`, `assignment/`, `references/`, `history/`, `START_HERE.md`, manifest. Публичният checkout не съдържа тези материали. Не използвай `git add .` или `git add -f`. Преглеждай изричните пътища и staged diff преди commit; преди първи push показвай точния списък.

## Публикуване и следващ пакет

В „Вход → Забравена парола“ има заявка за възстановяване с общ отговор, който не разкрива съществуването на акаунт. Supabase SDK използва PKCE и съществуващия `pages/account.html` callback. След recovery събитие и проверен Auth потребител се показва форма за нова парола; няма промяна на роли или DB назначения. Отвори писмото веднага в браузъра, в който е поискано. `npm.cmd run check:password-reset` проверява реалния браузър и SDK с изолирани HTTP тестови отговори; не изпраща писма и не доказва hosted recovery. Отделният реален live тест премина: доставено recovery писмо, успешен PKCE exchange, смяна на паролата, изход, вход с новата парола и отказ със старата. Провереният тестов акаунт остава pending без роли и контексти.

Ранна версия: **https://propertyhub-ilopolo.netlify.app**. Първият production deployment е от проверения `fc32f17`. Статичният артефакт е само `dist/`, без SPA fallback. Един Netlify site е свързан със съществуващото `ilopolo/PropertyHub`, branch `main`; build `npm run build`, publish `dist`, Node 24. В hosting environment са зададени само публичните Supabase URL/publishable key. Няма публични demo credentials.

Live проверките преминаха: 18 Edge org/registry комбинации със синтетични сесии (375/1440, light/dark), действителен преглед на всички screenshots, деветте deep links/assets и още 11 browser smoke групи за всички страници/reload/theme/security headers, pending login/logout/relogin и отрицателни callbacks. Netlify badge е изключен след установен CSP конфликт; CSP не е отслабена. `npm.cmd run check:live` възпроизвежда smoke набора; артефактите остават локални. [Netlify Vite настройки](https://docs.netlify.com/build/frameworks/framework-setup-guides/vite/).

Supabase Site URL е HTTPS origin; точният `https://propertyhub-ilopolo.netlify.app/pages/account.html` е добавен в Redirect URLs, а двата локални callback адреса са запазени. Custom SMTP използва Brevo Free само за Auth писма, при включен Confirm Email. Един контролиран signup е доставен (Brevo Sent/Delivered и получено писмо); имейлът е потвърден. Първият signup PKCE exchange е отказан с `flow_state_expired` и остава неприет. Обикновен login, собствен pending профил с нула роли/организации/контексти, logout и повторен login са проверени с действителните записи. Реалният recovery PKCE сценарий е преминал отделно; той не заменя чистия signup callback тест. Git-triggered deployment от main е настроен; бъдещ модул не е започван.

Първият platform admin е назначен чрез защитения операторски bootstrap след проверен pending тест и точен предоставен Auth UUID; role/audit записите са проверени. DEV-02 остава незавършен: чист confirmation callback още не е приет; реалните 2-org/pending API и UI scope acceptance/staff assign/revoke проверки са преминали. След затварянето им DEV-03 доизгражда регистъра и проверените собственически връзки. Виж [архитектурата](docs/public/ARCHITECTURE.md).

Vite конфигурацията следва официалното [multi-page ръководство](https://vite.dev/guide/build.html#multi-page-app).
