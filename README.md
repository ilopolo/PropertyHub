# PropertyHub

Учебно приложение за управление на етажна собственост. Текущата реализация е DEV-01: Vite multi-page основа с обща навигация, Bootstrap и светла/тъмна тема. Три отделни HTML страници: начало, табло и заготовка за сгради. Няма работещи Auth, CRUD, финансови операции или Storage. Заготовките не изпълняват изискването за завършени продуктови екрани.

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
```

Preview: http://127.0.0.1:4173. Проверявай отделно browser navigation/reload, mobile и темите; HTTP проверката не изпълнява браузърния JavaScript.

## Структура

- `index.html`, `pages/`: отделни входове; добавянето на страница изисква вход във `vite.config.js`.
- `src/pages/`, `src/ui/`: контролер и споделена навигация/тема.
- `src/domain/modules.js`: каталог на модули/действия; не предоставя права.
- `src/services/`: граница за бъдещи операции; сега само статус на конфигурацията.
- `src/i18n/`, `src/styles/`: BG ресурси и общи UI tokens.
- `supabase/migrations/`: място за бъдещи SQL миграции; няма приложена схема.
- `docs/public/`: публична техническа документация.

## Конфигурация и безопасност

Skeleton-ът работи без `.env.local`. При следващия пакет копирай `.env.example` като `.env.local` и въведи само URL и publishable ключ на установения проект. Налична конфигурация не доказва връзка или права. Всички `VITE_*` стойности са видими в браузъра; никога service-role/secret ключ или DB парола. Реални лични данни не се използват.

Пакетът за планиране е локален и игнориран: `docs/*` извън `docs/public/`, `assignment/`, `references/`, `history/`, `START_HERE.md`, manifest. Публичният checkout не съдържа тези материали. Не използвай `git add .` или `git add -f`. Преглеждай изричните пътища и staged diff преди commit; преди първи push показвай точния списък.

## Публикуване и следващ пакет

Няма публикуван live URL или demo credentials. Статичният артефакт е само `dist/`, без SPA fallback: `/pages/dashboard.html` и `/pages/buildings.html` са реални файлове. Предложен хост е Netlify; акаунт/сайт и deployment още не са настроени. Не се публикува коренът на работната папка.

Следва DEV-02: минимални DB-A/B, Supabase Auth/pending, защитено първо администраторско назначение и grants/RLS с две синтетични организации. Диаграма на реалната DB ще бъде добавена с действителните таблици. Виж [архитектурата](docs/public/ARCHITECTURE.md).

Vite конфигурацията следва официалното [multi-page ръководство](https://vite.dev/guide/build.html#multi-page-app).
