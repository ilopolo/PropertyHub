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

`npm.cmd run check:browser` използва Playwright с инсталиран Microsoft Edge и трите изолирани синтетични акаунта от игнорираната локална конфигурация. Нужни са вече проверени fixtures; скриптът не ги създава. Изпълнени са 18 случая за organization-admin/buildings при 375/1440 px, light/dark, разрешен и pending достъп, навигация/reload и изолация на собствената организация. Всички снимки са прегледани; поправеният контраст на destructive outline бутоните премина отделни четири проверки. `node scripts/check-browser-actions.mjs` проверява UI scope request/revoke и unit create/verify с реален SELECT на записите през обикновена сесия. Снимките и отчетите остават само в игнорирана `.local/`; пароли и сесии не се записват в тях. Начално scope приемане и staff assign/revoke са API-проверени, но още нямат отделен UI write PASS.

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

Няма публикуван live URL или demo credentials. Статичният артефакт е само `dist/`, без SPA fallback: страниците са реални HTML файлове. Намерен е съществуващ Netlify акаунт и wizard за `ilopolo/PropertyHub`/main; в прегледания team няма видим site за това repo. `netlify.toml` задава build/publish, Node 24, CSP и основни security headers. Те още не са проверени върху действителен live отговор. Не се публикува коренът на работната папка.

Следващата конкретна hosting стъпка е в съществуващия wizard да се избере свободно project име (краткото `propertyhub` е заето), да се зададат `VITE_SUPABASE_URL` и `VITE_SUPABASE_PUBLISHABLE_KEY` от локалната публична конфигурация и да се изпълни първи deploy от проверения main. Build command: `npm run build`; publish directory: `dist`; Node 24.19.0 е локално проверената версия. Не се задава операторски ключ. След действителен HTTPS URL се добавя точният `/pages/account.html` callback в Supabase, преглежда се Site URL и се проверяват деветте deep links/reload, HTTP headers, темите и Auth confirmation/login/logout през live origin. Deployment не е извършен и URL не се отгатва. [Netlify Vite настройки](https://docs.netlify.com/build/frameworks/framework-setup-guides/vite/).

Първият platform admin е назначен чрез защитения операторски bootstrap след проверен pending тест и точен предоставен Auth UUID; role/audit записите са проверени. Следва довършване на DEV-02 доказателствата: browser проверки на разрешените административни/registry действия и чист confirmation callback; реалните 2-org/pending API проверки вече са преминали. Hosting/live остава отделна задача. След това DEV-03 доизгражда регистъра и проверените собственически връзки. Виж [архитектурата](docs/public/ARCHITECTURE.md).

Vite конфигурацията следва официалното [multi-page ръководство](https://vite.dev/guide/build.html#multi-page-app).
