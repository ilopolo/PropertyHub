# PropertyHub

Учебно приложение за управление на етажна собственост с девет HTML входа, Bootstrap и светла/тъмна тема. Реализирани са Supabase Auth, pending профил, контролирани служебни назначения, scoped регистър на имоти и лица, собственост/съсобственост с периоди, произход, проверки и запазена история на корекциите. Clean signup/confirmation/PKCE и recovery са доказани с отделни тестови акаунти; правата са проверени през реални потребителски сесии.

Финанси, Storage и проверени account-person връзки/портален достъп предстоят. Записът за собственост не предоставя достъп и не прехвърля стари дългове. Сборът на дяловете не се нормализира и не означава автоматично пълнота или финансова готовност. Наличен код не се отчита като преминал продуктов тест.

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

Първата ограничена DEV-03 стъпка добавя в „Сгради“ преглед на принадлежността на обектите към избрана дата. Периодът е [начало, край), датата по подразбиране е за Europe/Sofia. „Период и произход“ показва отделно датите/източниците на обекта и принадлежността. Полетата са текущите записани стойности, не исторически версии; прегледът не удостоверява финансова готовност. При друга дата формите за текущ unit/person запис са скрити; ownership периодите имат отделни проследими корекции. Използват се съществуващите таблици и RLS, без нови миграции. `npm.cmd run check:registry-date` проверява календарната валидация; Лицата и ownership периодите са отделни реализирани секции; импортът остава следваща стъпка.

В „Вход → Забравена парола“ има заявка за възстановяване с общ отговор, който не разкрива съществуването на акаунт. Supabase SDK използва PKCE и съществуващия `pages/account.html` callback. След recovery събитие и проверен Auth потребител се показва форма за нова парола; няма промяна на роли или DB назначения. Отвори писмото веднага в браузъра, в който е поискано. `npm.cmd run check:password-reset` проверява реалния браузър и SDK с изолирани HTTP тестови отговори; не изпраща писма и не доказва hosted recovery. Отделният реален live тест премина: доставено recovery писмо, успешен PKCE exchange, смяна на паролата, изход, вход с новата парола и отказ със старата. Провереният тестов акаунт остава pending без роли и контексти.

Ранна версия: **https://propertyhub-ilopolo.netlify.app**. Първият production deployment е от проверения `fc32f17`. Статичният артефакт е само `dist/`, без SPA fallback. Един Netlify site е свързан със съществуващото `ilopolo/PropertyHub`, branch `main`; build `npm run build`, publish `dist`, Node 24. В hosting environment са зададени само публичните Supabase URL/publishable key. Няма публични demo credentials.

Live проверките преминаха: 18 Edge org/registry комбинации със синтетични сесии (375/1440, light/dark), действителен преглед на всички screenshots, деветте deep links/assets и още 11 browser smoke групи за всички страници/reload/theme/security headers, pending login/logout/relogin и отрицателни callbacks. Netlify badge е изключен след установен CSP конфликт; CSP не е отслабена. `npm.cmd run check:live` възпроизвежда smoke набора; артефактите остават локални. [Netlify Vite настройки](https://docs.netlify.com/build/frameworks/framework-setup-guides/vite/).

Supabase Site URL е HTTPS origin; точният `https://propertyhub-ilopolo.netlify.app/pages/account.html` е добавен в Redirect URLs, а двата локални callback адреса са запазени. Custom SMTP използва Brevo Free само за Auth писма, при включен Confirm Email. Чистият live signup сценарий е проверен с отделен нерегистриран тестов адрес: получено confirmation писмо, PKCE exchange200, потвърден собствен pending профил и нула роли/организации/контексти чрез реалната потребителска сесия, logout и повторен login. По-ранният опит е отказан с `flow_state_expired`; той е запазен като исторически неуспех. Реалният password recovery PKCE сценарий също е преминал. Git-triggered deployment от main е настроен; бъдещ модул не е започван.

Първият platform admin е назначен чрез защитения операторски bootstrap след проверен pending тест и точен предоставен Auth UUID; role/audit записите са проверени. DEV-02 Auth/RLS/ранен live обхват е проверен, включително чист signup callback, recovery и реалните 2-org/pending API/UI allow/deny проверки. DEV-03 е частично реализиран; account-person links, идеалните части и финансовите зависимости остават отделни задачи. Актуалната приета Auth политика е server minimum8 без character requirements и UI8 с цифра; API допуска пароли без цифра. Виж [Supabase документацията](supabase/README.md). Виж [архитектурата](docs/public/ARCHITECTURE.md).

Vite конфигурацията следва официалното [multi-page ръководство](https://vite.dev/guide/build.html#multi-page-app).

### Scoped persons and password policy

The registry supports staff-authorized scoped person records with optional contacts, explicit provenance and a separate verification step. Full-record replacement requires a fresh source assertion, checks the expected revision, preserves the previous revision privately and clears verification. Equal names/emails stay separate. This does not create account links, ownership or owner access.

New passwords in registration, recovery and account change require 8–256 characters and at least one ASCII digit. Existing-password login is unaffected. The accepted temporary hosted policy is minimum 8 without character requirements: the hosted API permits passwords without digits; the digit check is client validation, not server enforcement. Deployment/configuration verification is recorded separately. A unified server policy remains a decision before business launch. No uppercase/special-character requirement or forced reset is added.

Targeted checks: `node scripts/check-password-policy.mjs`, `npm run check:password-reset` (isolated browser contract, no delivered email), `node scripts/check-persons.mjs` (existing synthetic A/B/pending resources; creates four identified synthetic person records and retains them), and `node scripts/check-persons-browser.mjs` (local production preview). QA output and credentials remain ignored.

### Собственост и съсобственост

В „Сгради“ избери обхват, дата и имот. Служител с manage_registry може да подготви до20 нови периода, корекции или оттегляния за този имот и да ги запише атомарно с общ източник, ограничения на историята и основание. Корекцията запазва оригиналните факти; новите редове отново чакат преглед. Дяловете са точен decimal text от0 до1 (строго положителен, до10 десетични знака); периодите са [начало,край). „Известно от“ е отделна дата, не автоматична дата на покупка.

Непълен сбор е разрешен и обозначен; сбор над1 и припокриване на същото лице/имот се отказват сървърно. Редовете и целият набор за избрана дата се проверяват отделно. Проверка на набора изисква точен сбор1 и всички приложими редове verified; промяната обезсилва старото потвърждение, като го запазва в историята. Няма нормализация или автоматичен owner portal.

Целеви проверки: `npm run check:ownership-domain`, `npm run check:db`, `npm run check:ownership` и `npm run check:ownership-browser`. Hosted тестовете използват съществуващите изолирани синтетични ресурси и пазят request keys преди записи; не пресъздавай fixtures при повторение. Live browser режимът е `--read-only` с блокирани write заявки.


### Обитаване с периоди и произход

В „Сгради“ разрешен служител въвежда обща декларация за имот или конкретни физически лица с деклариран статут: собственик, носител на право на ползване, наемател или друг обитател. Това е описателен регистър, а не доказателство за собственост или финансови разчетни единици. Периодите са [начало,край), в рамките на принадлежността на имота. Общият брой е цяло неотрицателно число или неизвестен; празното не е нула. Липса на запис, неизвестен брой, декларирана нула и изрично проверена нула се показват отделно.

Сървърът не допуска обща декларация и конкретни лица за застъпващи се периоди, застъпващи се общи декларации или повторение на същото лице/имот независимо от статута. Различни scoped лица не се сливат по име/имейл. Конкретното лице е физическо и броят му е1. Броенето е за избрания имот и дата; няма глобално удостоверяване на самоличност или автоматично финансово изчисление.

Атомарната група съдържа до20 промени за един имот и изричен произход, известно от, ограничения на историята и основание. Корекциите/оттеглянията запазват оригинала. Новите записи чакат преглед; отделната проверка на набора изисква известен брой и проверени приложими редове. Промяна на свързаното лице обезсилва проверката и изисква ново сведение. read_registry разрешава преглед; manage_registry разрешава запис и проверка чрез RPC. Direct writes са отказани.

Записът не създава собственост, account-person връзка, портален достъп, начисления, законови освобождавания или пропорционално начисляване по дни. Потвърдена нула обитатели не означава нулево начисление.

Миграции: 20261030203754_occupancy_periods.sql и 20261030205226_occupancy_subject_guard.sql. Предишната ownership миграция е 20261030194407_ownership_periods.sql; по-ранното193517 е име на непубликуван draft, не друга приложена версия.

Целеви проверки: npm run check:occupancy-domain, npm run check:occupancy-db (самостоятелен временен PostgreSQL), npm run check:occupancy (съществуващи синтетични сесии), npm run check:occupancy-subject и npm run check:occupancy-browser. Hosted сценарии запазват request keys преди запис и откриват съществуващия QA ресурс при продължение. Subject тестът създава едно отделно scoped QA лице и го оставя неактивно, без нов Auth акаунт. Live browser режимът --read-only блокира записите. Артефакти/данни/credentials остават локални.
