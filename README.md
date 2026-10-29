# PropertyHub

Учебно приложение за управление на етажна собственост. DEV-02 добавя Supabase Auth интерфейс (регистрация/вход/изход/повторно потвърждение), pending профил, заявка за организация, контролирани назначения и минимален регистър. Пет HTML входа, Bootstrap и светла/тъмна тема. DB-A/B миграциите са приложени в установения Supabase проект. Личният тест потвърди login, pending без права, logout/reload и повторен login; Auth имейлът е потвърден в DB, но отварянето на confirmation връзката показа грешка и чистият callback още не е приет. Реалните 2-org RLS проверки очакват синтетични акаунти. Финанси, собственически връзки и Storage предстоят. Наличен код или заготовка не се отчита като преминал продуктов тест.

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

Няма публикуван live URL или demo credentials. Статичният артефакт е само `dist/`, без SPA fallback: `/pages/dashboard.html` и `/pages/buildings.html` са реални файлове. Предложен хост е Netlify; акаунт/сайт и deployment още не са настроени. Не се публикува коренът на работната папка.

Следващата конкретна hosting задача е проверка за съществуващ Netlify site и свързване на текущото GitHub repo/main към него (или един site за това repo, ако няма съществуващ). Build command: `npm run build`; publish directory: `dist`; Node 24.19.0 е локално проверената версия. В build environment се задават само `VITE_SUPABASE_URL` и publishable ключът. След получаване на действителния HTTPS URL се добавя точният `/pages/account.html` callback в Supabase, преглежда се Site URL и се проверяват петте deep links/reload, темите и Auth confirmation/login/logout през live origin. Deployment не е извършен и URL не се отгатва. [Netlify Vite настройки](https://docs.netlify.com/build/frameworks/framework-setup-guides/vite/).

Първият platform admin е назначен чрез защитения операторски bootstrap след проверен pending тест и точен предоставен Auth UUID; role/audit записите са проверени. Следва довършване на DEV-02 доказателствата: потребителски проверки след назначението, чист confirmation callback и реални 2-org RLS сесии. Hosting/live остава отделна задача. След това DEV-03 доизгражда регистъра и проверените собственически връзки. Виж [архитектурата](docs/public/ARCHITECTURE.md).

Vite конфигурацията следва официалното [multi-page ръководство](https://vite.dev/guide/build.html#multi-page-app).
