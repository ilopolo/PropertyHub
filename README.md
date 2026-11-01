# PropertyHub

Учебно multi-page приложение за управление на етажна собственост с HTML/CSS, чист JavaScript, Bootstrap, Node/npm/Vite и Supabase DB/Auth. Девет HTML входа, български интерфейс, светла/тъмна тема. Целият приет университетски MVP още не е завършен.

[Хранилище](https://github.com/ilopolo/PropertyHub) · [Ранна live версия](https://propertyhub-ilopolo.netlify.app) · [Архитектура и ER диаграми](docs/public/ARCHITECTURE.md) · [Supabase setup](supabase/README.md)

## Реално състояние

| Статус | Функции |
|---|---|
| Работят и са проверени | Supabase register/login/logout, pending без роли, реално доставени confirmation/recovery писма и PKCE; отделни platform/org admin процеси, изрични manager/controller назначения; разрешен регистър на имоти и scoped лица; собственост/съсобственост и описателно обитаване с периоди, произход, проверки и история; проверена account-person връзка и минимален собствен изглед |
| Проверено локално, още без hosted release | Private PDF към имот: DB/bucket вече са applied; реални bytes/hash/visibility/limits/cleanup са проверени. Hosted приемането е FAIL за same-session revoke заради cached authorization; последната policy е fail-closed и разрешеният download също е блокиран. Не е готово за merge/production. Виж [договора и release стъпките](supabase/README.md#private-файл-към-имот--локално-проверен-кандидат-още-без-hosted-release) |
| Частична основа | Регистърът няма пълен lifecycle/import/mixed-source редактор. Dashboard е каталог, не оперативно табло. Идеалните части имат само проверен чист domain validator, без API/UI/DB интеграция |
| Предстоят | Пълен собственически портал с финансови/исторически функции; Hosted Storage приемане и публикация на подготвения private-file пакет; сигнали/задачи; правила/начисления/плащания/разходи/фондове/начални салда; отчети; CSV import/export; in-app известия; безопасен demo достъп |

Наеми, онлайн плащания, OCR, AI, EN и автоматични външни напомняния са бъдещи идеи, не работещи функции. Регистрацията не дава административни права. Собствеността/обитаването не създават автоматично акаунтна връзка, портален достъп, начисления или прехвърляне на стари дългове.

## Локален старт

Node.js22.12+ според package.json (средата е проверявана с Node24.19.0) и npm. В PowerShell използвай npm.cmd, ако npm.ps1 е блокиран.

```powershell
npm.cmd ci
Copy-Item .env.example .env.local
npm.cmd run dev
```

Преди старта попълни локално само VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY за установения проект. Те са публична клиентска конфигурация. Никога secret/service-role ключ, DB парола или SMTP credentials във VITE_*. Публичните страници се отварят и без backend конфигурация; Auth/registry изискват правилните стойности.

Dev: http://127.0.0.1:5173. Production preview:

```powershell
npm.cmd run build
npm.cmd run preview
```

Preview: http://127.0.0.1:4173. Двата сървъра са loopback-only и ползват strictPort. При зает порт спри собствения стар процес; не сменяй origin в започнат PKCE сценарий.

Това са команди, сверени с package.json и конфигурацията. Build/dev/preview са използвани при разработката; **пълен clean-checkout → нов Supabase stack → готов reviewer context сценарий още не е проверен**. Не прилагай миграциите повторно върху съществуващия проект; виж Supabase setup.

## Проверки и ограничения на доказателствата

При работещ production preview в отделен терминал:

```powershell
npm.cmd run check:navigation
```

Самостоятелни локални проверки:

```powershell
npm.cmd run check:db
npm.cmd run check:occupancy-db
npm.cmd run check:unit-shares-domain
npm.cmd run check:unit-file-domain
npm.cmd run check:unit-file-db
```

DB скриптовете използват временен PGlite PostgreSQL и тестов Auth договор, не hosted GoTrue. Идеалните части се оценяват с точна BigInt аритметика,8 десетични знака и явен знаменател/състав;99.99% не става100%. Резултатът ready не удостоверява правна валидност, сървърни права или persisted review.

Hosted/browser harness-ите изискват Microsoft Edge/Playwright, отделни синтетични сесии и вече подготвени игнорирани manifests. Те не са demo за посетители и не са автоматично възпроизводими от чист checkout. Някои сценарии записват тестови данни; не ги пускай без техния setup/обхват. npm.cmd run check:password-reset е изолиран browser/SDK contract тест без доставка на писмо. Отделните реални signup/recovery и2-org RLS проверки вече са изпълнени; не се повтарят само за документационна промяна.

Запазените проверки включват ordinary-session API allow/deny и реални Edge local/live проверки при375/1440 px и двете теми. Screenshots са прегледани при съответните feature checkpoints. HTTP200/build не се представят като визуален PASS. QA снимки, отчети, credentials и лични данни остават извън публичния пакет.

## Данни и структура

**14 SQL миграции** описват **24 приложни таблици:20 public +4 private**. Това са различни бройки; auth/storage системните таблици не са включени. Публичната ER диаграма отразява реализираните отношения, не бъдещи DB16/Storage/finance таблици.

- index.html и pages/: отделни входове, изрично изброени във vite.config.js.
- src/pages/: контролери; src/ui/: renderer-и, форми, навигация и тема.
- src/services/: Supabase/Auth, административни и registry операции.
- src/domain/: календарни правила, ownership/occupancy, password и domain-only unit shares. Каталогът на модули не предоставя права.
- src/i18n/ и src/styles/: BG ресурси и общи стилове; някои текстове още са в контролери.
- supabase/migrations/: публична приложена SQL история; supabase/operators/: доверен bootstrap без публичен endpoint.
- docs/public/: публична техническа документация.

## Live, Auth и demo

Netlify е свързан със съществуващото ilopolo/PropertyHub, branch main: npm run build, publish dist, Node24, без SPA fallback. netlify.toml съдържа headers/CSP. В build средата има само публичните Supabase URL/publishable key. Live версията е ранен работещ поднабор, не завършен MVP.

Brevo Free custom SMTP се използва за Auth confirmation и password reset, при включен Confirm Email. Реална доставка и успешни PKCE/pending/recovery сценарии са доказани с отделни тестови акаунти. Връзката се отваря в същия браузърен профил и origin, където е поискана. Виж точните разрешени callback адреси в Supabase setup. Маркетинг и бъдещи известия не са част от тази конфигурация.

Приетата временна password политика е server minimum8 без character requirements и UI8–256 с поне една ASCII цифра. **API допуска парола без цифра**; UI не е сървърна защита. Няма задължителна главна буква/специален знак и съществуващият login не се блокира от правилото за нова парола. Единна server политика предстои преди бизнес старт.

**Demo достъпът за проверяващите предстои.** Няма публикувани примерни credentials. Собствен signup остава pending и не дава registry достъп. Трябват отделни синтетични данни/ограничени reviewer роли и безопасни инструкции за предоставяне на тестов вход; личният platform admin и QA паролите не са demo акаунти. Няма измислени credentials или инструкции за самоиздигане.

Вътрешните планове, assignment/references/history и локалните QA/env файлове са игнорирани и не се публикуват. Публичната документация описва действителното приложение; не изисква наличието на вътрешния пакет.

## Проверена връзка и собствен изглед

В „Акаунт“ има „Моите текущо разрешени имоти“ и обновяване със server read. Връзката се потвърждава само от отделно назначен scoped manager с verify_owner_access и read_registry, с точен потвърден Auth UUID, проверено scoped лице/ревизия, текуща проверена собственост и основание. Не се свързва по име/имейл. Org admin изрично включва/отнема verification правото на друг manager в собствен managed scope; то не следва от manage_registry/manage_members/platform_admin. Самоназначаване/самопотвърждаване и общият grant пакет без отделно основание са отказани.

Оттеглянето пази кой/кога/защо и спира следващия owner read от същата сесия. Корекцията е revoke и нова проверка; старият request key не възстановява отнет достъп. Собственикът вижда само текущите разрешени идентификатори, не чужди лица, finance/history или operational registry. Няма нова owner role/membership от link. Личните demo права не са променяни. Целеви команди: npm.cmd run check:owner-access-db, npm.cmd run check:owner-access-api и npm.cmd run check:owner-access-browser; hosted/UI scripts ползват само предварително проверените синтетични manifests и запазват заявки преди записи. Не пресъздавай fixtures при retry.

Private-file browser QA: npm.cmd run check:unit-file-browser стартира собствен loopback dev5173/API54331 с изолирани синтетични данни. Портовете трябва да са свободни. Използва реален Edge/SDK/HTTP bytes с локален QA transport, не hosted Supabase Storage; не изисква ключове, SMTP или тестови Auth акаунти и не е demo достъп.
