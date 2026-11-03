# PropertyHub

Учебно multi-page приложение за управление на етажна собственост с HTML/CSS, чист JavaScript, Bootstrap, Node/npm/Vite и Supabase DB/Auth. Единадесет HTML входа в този клон, български интерфейс, светла/тъмна тема. Целият приет университетски MVP още не е завършен.

[Хранилище](https://github.com/ilopolo/PropertyHub) · [Ранна live версия](https://propertyhub-ilopolo.netlify.app) · [Архитектура и ER диаграми](docs/public/ARCHITECTURE.md) · [Supabase setup](supabase/README.md)

## Реално състояние

**Publish A — ограничени hosted API/UI/MVCC проверки PASS, общият gate още е отворен:** exact миграция **20261103064400** е приложена; backend има 29 миграции и 39 public/private приложни таблици. Обикновени synthetic сесии и 5 контролирани независими PostgreSQL случая доказаха атомарен batch, exact snapshot/R, откази, replay/business duplicates, input writer и unpaid correction. Реален UI и same-JWT 200 → 403 след отнемане на правото са проверени. **Естествената смяна на календарния ден не е изчакана**; локалният clock тест не я замества. Frontend остава draft PR #9, извън main/production. Съсобствеността остава задължителна следваща MVP подстъпка. [Доказателства и оставащ gate](supabase/README.md#fnd-f05--локално-публикуване-a).

**FND-F05 preview — ограниченото hosted приемане е PASS:** шестте точни миграции са приложени; при това приемане backend имаше 28 миграции и 35 приложни таблици (преди publish A по-горе). Обикновени синтетични сесии и реален локален frontend провериха версиите, правата, изчисленията, HTTP 409 и отнемането на права със същия JWT. Допълнително преминаха осем контролирани PostgreSQL/MVCC случая с независими сесии и наблюдавани locks/waiters преди release: activation/preview replay, конфликтни активации, редакция срещу проверка и preview срещу writer/phantom insert. Старите snapshots са неизменни; cleanup е потвърден. Собствениците са само контекст, без лични суми, длъжник или задължение. Frontend остава draft PR #9, извън main/production; това не означава завършен финансов MVP. [Договор и приемане](supabase/README.md#fnd-f05--локален-начислителен-preview).

**DB-D/1–2:** защитен каталог, основание и доказателства, чернова и активация само за **FND-F05: целево набиране при недостиг за основен ремонт по чл. 17, ал. 2, т. 5 ЗУЕС**. Изрични scoped финансови права, точни версии, мотивиран преглед и неизменим snapshot. Синтетичните fixtures не удостоверяват реално решение. [Договор и setup](supabase/README.md#db-d1--локални-финансови-чернови). Шестте миграции на основата и целевото hosted/MVCC приемане са приключили; frontend release предстои. Самата основа не създава задължения; publish A е отделен пакет с ограничени hosted доказателства и оставащ date-rollover gate. Няма плащания, ledger или движение на фондови средства; реалната клиентска приложимост е отделен gate.

Минималните сигнали и приложението към тях са включени в **един общ frontend release**, обединяващ PR #5/#6 със запазена история. Backend е проверен: 21 миграции, 28 таблици и две отделни download Edge функции. Current owner подава собствен сигнал и един private PNG/JPEG/PDF до 5 MiB; изрично оправомощен служител обработва статуса. Конкретният production commit/READY и live smoke резултат се записват в общия release PR. [Договор, доказателства и операторски правила](supabase/README.md#минимално-приложение-към-сигнал--общ-frontend-release).

| Статус | Функции |
|---|---|
| Работят и са проверени | Supabase register/login/logout, pending без роли, реално доставени confirmation/recovery писма и PKCE; отделни platform/org admin процеси, изрични manager/controller назначения; разрешен регистър на имоти и scoped лица; собственост/съсобственост и описателно обитаване с периоди, произход, проверки и история; проверена account-person връзка и минимален собствен изглед |
| Включено в общия Storage/theme release | Един private PDF към имот:18 миграции/25 таблици, JS Edge/S3 download; реални bytes/hash, staff-only/owner opt-in, direct/sign/S3 откази, same-JWT role/link revoke и cleanup PASS. UI/service интеграцията е проверена; общият release включва Storage PR #2 и theme PR #3. Надписът/title/aria на бутона показват следващото действие. Виж [резултатите и setup](supabase/README.md). Конкретният production commit/ready статус се потвърждава отделно за deployment-а |
| Частична основа | Регистърът няма пълен lifecycle/import/mixed-source редактор. Dashboard е каталог, не оперативно табло. Идеалните части имат persisted версии/отделна проверка и връзка с изчислителен preview; целевото hosted API/UI/MVCC приемане е PASS, frontend release предстои |
| Минимални сигнали и приложение — общ release | Двете exact миграции20261101141944/20261101180527 са приложени:20миграции/27таблици. Предишните access/RLS/co-owner/status/same-JWT/UI доказателства плюс новия current→staleHTTP409→reload/current тест затварят минималния договор. Stale отказът еPT409 за109ms, без промяна на ред/events; cleanup е потвърден. Общият release включва signal/attachment UI; категория, отговорник и задачи остават извън тази стъпка, целият REQ009 остава частичен |
| Отделен release / предстоят | Категория/отговорник чакат отделния PR #8 release. Финансовата FND-F05 основа за каталог, основание, активация и preview е hosted проверена в PR #9; publish A има ограничени hosted API/UI/MVCC проверки и оставащ естествен date-rollover gate, а пълното публикуване със съсобственост остава предстоящо. Плащания, разходи, фондови операции, начални салда и отчети не са реализирани. Предстоят също пълният финансов/исторически owner портал, задачите към сигнали, CSV import/export, in-app известия и безопасен demo достъп |

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
npm.cmd run check:unit-share-records
npm.cmd run check:unit-share-records-browser
npm.cmd run check:financial-preview
npm.cmd run check:financial-preview-browser
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
- src/domain/: календарни правила, ownership/occupancy, password и точен unit-shares validator с persisted adapter. Каталогът на модули не предоставя права.
- src/i18n/ и src/styles/: BG ресурси и общи стилове; някои текстове още са в контролери.
- supabase/migrations/: публична SQL история и ясно означени неприложени кандидати; supabase/operators/: доверен bootstrap без публичен endpoint.
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
