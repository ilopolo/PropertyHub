> Current-write-access correction е приложена:41 backendверсии. Проверените API/native/UI
> пътища са PASS; org-admin authority-loss native case остава **UNVERIFIED/P1 release gate**.
> Това не е общо hosted/production приемане. CALC е неприложен/fixture blocked.
> [Резултати по функция и точни ограничения](supabase/README.md).

# PropertyHub

**P6a unit CSV — ограничен corrective hosted/API/UI/native PostgreSQL PASS,
извън production.** Корекция20261106185945 е приложена еднократно с окончателния
hash; тогавашната backend история е40версии. Пет тесни ordinary-JWT групи, два реални native
revoke отказа и два разрешени контрола са PASS. Реалният frontend→hosted UI/export
поток е проверен, включително CSV bytes/raw-formula защита и8mobile/desktop/две теми
снимки. Cleanup/baseline/credential clearing са потвърдени; първоначалният FAIL и
локалните regression доказателства са запазени като история. Няма production
приемане, merge/deployment, CALC apply или historical backdating.
[Формат, права, граници и бъдещо приемане](docs/public/REGISTRY_CSV.md).

## Интеграция на main във финансовия клон, 06.11.2026

Актуалният main f8f39aa е интегриран със запазена история във финансовия клон.
Production остава на 9b98359; тази интеграция не е deployment. CALC-04 кодът и
неприложената му миграция са запазени. Месечната навигация използва вече разрешените
server scopes от draft/preview/charge проекциите и текущия server can_manage_registry;
не зарежда monthly rule/preview историята в header и не дава права от име на роля.
Реалният monthly service/RPC проверява отново достъпа при отваряне. P2 cutover е
приключен; CALC hosted/MVCC остава BLOCKED от октомврийския fixture, не става PASS
чрез Git merge. Няма промяна на SQL, финансови права, формули или write механизми.

Учебно multi-page приложение за управление на етажна собственост с HTML/CSS, чист JavaScript, Bootstrap, Node/npm/Vite и Supabase DB/Auth. Четиринадесет HTML входа в този клон, български интерфейс, светла/тъмна тема. Целият приет университетски MVP още не е завършен.

[Хранилище](https://github.com/ilopolo/PropertyHub) · [Live приложение](https://propertyhub-ilopolo.netlify.app) · [Архитектура и ER диаграми](docs/public/ARCHITECTURE.md) · [Supabase setup](supabase/README.md)

## Реално състояние

**P5 CALC-04 — локален PASS:** изрично одобрена положителна месечна ставка в цели EUR центове × пълен проверен състав. Само приключил календарен месец и поддържаният единствен owner/occupant случай, отделно прегледана лична отговорност. 16 DB/domain/RLS и 8 реални localhost UI/service групи, 4 визуални 375/1440 light/dark снимки, изолиран offline ci/build/navigation PASS. Новата `20261105131317_monthly_management_equal_tariff.sql` е **НЕПРИЛОЖЕНА**; hosted/MVCC/production не са доказани за CALC-04. Последното запазено hosted доказателство е38 версии, включително production приетата P2. CALC hosted остава блокиран: липсва допустим пълен октомврийски fixture. [Договор и бъдещ acceptance план](docs/public/MONTHLY_MANAGEMENT.md).

**Production, 06.11.2026:** PR #10 е merge-нат със запазена история в
`9b9835990a540525ed87229fa4590e2e77d1ce4f`. Един automatic Netlify production deployment
`6aedeea5e28bf5fe312e1f85` е READY/published на 06.11.2026, 15:13:55 UTC.
Backend е потвърден с **38 приложени версии**; P2 `20261104212948` е приложена
еднократно. CALC-04 не е включен в този release и не е приложен.

Включени са registry/signal/attachment процесите, P1 „Моите финанси“, P2 explicit
категория и ticket-only навигация, FND-F05, payments/accounts/inbound, P4a и P4b,
както и логото, помощта и демонстрационните контакти. PR #8 историята е включена;
GitHub отчита PR #8 като merged чрез включената история; финансовият PR #9 остава отворен с неприключения CALC-04.

P2 hosted ordinary-JWT приемане: пет групи PASS, включително деветте категории,
anti-spoof/atomic откази, запазена NULL/history, празен ticket-only scope без registry
и revoke със същия JWT. Шест local-frontend→hosted UI групи и шест actual production
smoke групи PASS. Проверени са 13 production маршрута/CSP, 26 assets и 14 действителни
production снимки на 375/1440 px в двете теми, личната справка, logout/profile switch.
Cleanup и отделната read-only baseline сверка са PASS; временните права/връзки/сесии
са оттеглени, историята е запазена, operator credentials са изчистени.

Предишните финансови/Auth/Storage/MVCC доказателства са използвани повторно;
този release smoke не е нов пълен финансов/MVCC набор. CALC-04, expense attachment,
останалите начислителни методи, начални салда/пълен баланс, отчети, импорт/експорт
и другите непокрити приети MVP процеси остават незавършени.
[Изпълнен cutover и recovery ограничения](supabase/README.md#interim-finance-p2-release).

### История на предходните локални и hosted приемания

Числата и статусите по-долу са за датата на съответния пакет. Старите изрази
„frontend предстои“/„P2 неприложена“ описват онези checkpoints; текущият production
статус е горният. Frontend на приетите тук модули вече е публикуван чрез PR #10.

**Пред-release UI/branding/help — локално проверен пакет:** общ header с постоянно
достижими „Табло“, „Акаунт“ и „Изход“ след вход, отделно профилно административно меню,
текущ контекст, помощ по роли и видими пояснения към сложни полета. Личните финансови
справки се запазват. При logout или смяна на профил старото представяне се скрива и
страницата зарежда текущата сесия; server authorization и финансовите write операции
не са променени. Помощта и контактният екран увеличават HTML входовете на13.
Контактната форма е само локална демонстрация, без получател, изпращане или съхраняване;
в нея не трябва да се въвеждат реални лични данни. Бъдещите идеи са отделени от
неприключените приети MVP модули. [Лого и права](docs/public/BRANDING.md),
[third-party notices](public/third-party-notices.txt). Не е въведен нов проектен лиценз.
Девет целеви UI/service групи с локални синтетични данни, build/navigation за13HTML
и13 визуално прегледани снимки покриват375/1440px, двете теми, logout/смяна на профил,
състоянията и запазеното действие за разходен документ. Това е локално приемане;
не е нов hosted Auth/финансов тест или production smoke.

**Разходи P4b — ограничено hosted API/UI/MVCC PASS (05.11.2026):** document → partial/full отчетено изходящо плащане → точно едно outbound и цяла фондова разбивка, историческа компенсация и атомарен replacement. 8 API +2 rights/setup +1 source regression групи/22 отказа, 11 независими PostgreSQL observed-waiter случая и реален UI/4 визуални снимки PASS. Exact `20261105094824` е приложена: **37 backend версии**, P2 остава неприложена. Cleanup/baseline и credential clearing PASS; синтетичната история е запазена. Attachment, банков превод и пълен баланс не са реализирани. Frontend още е draft PR #9. [Договор, резултати и ограничения](docs/public/EXPENSES.md).

**Фондове P4a — ограничено hosted API/UI/MVCC PASS (05.11.2026):** конфигурация с
изрични scoped права, пълно отнасяне на записано inbound по фондове, проследими версии
и атомарно огледало при компенсация. След exact single-candidate dry-run е приложена
само `20261104221711`: **36 backend версии**, P2 остава неприложена. Шест API групи,
14 целеви отказа, осем независими PostgreSQL случая с наблюдавани waiters и реален UI
с четири визуално прегледани375/1440light/dark снимки са проверени. Cleanup и baseline
са потвърдени; историята е запазена и временните operator credentials са изчистени.
Предходните13DB/9UI локални проверки се пазят; forced trigger failure е local-only.
В рамките на P4a няма backfill, ново парично постъпление, фондов трансфер, разходен модул или пълен
фондов баланс. [Договор и граници](docs/public/FUNDS.md).

**P2 — локално приемане PASS, hosted предстои:** собственикът избира задължително
една от деветте категории; записът е атомарен, без автоматична категория и без промяна
на старите сигнали. Ticket-only служител достига и празен разрешен списък без регистров
достъп. PR #8 е включен в PR #9 със запазена история; PR #8/main не са merge-вани.
10 DB/RLS и9 UI/service групи, build/navigation и двете теми са проверени локално.
Новата `20261104212948` е неприложена. Старият live клиент е без категория: самостоятелен
hosted apply е блокиран до изрично съгласуван frontend cutover. [Договор и приемане](docs/public/TICKET_CREATION.md).

**„Моите финанси“ P1 — ограничено hosted API/UI PASS (04.11.2026):** лични публикувани задължения,
разрешената част от платежното покритие и точен текущ остатък, с история на замяна/
отмяна. Бивш собственик с валидна проверена самоличност запазва личната си история;
текуща собственост, платец или admin/staff роля не предоставят чужди лични данни.
Запазени са10 локални DB/RLS/DTO и9 UI/service групи; допълнени са6 тесни ordinary-JWT
API и6 frontend→hosted UI/приемателни групи. `20261104182905` е приложена точно веднъж:
**35 backend версии**, проверени тела/grants и same-JWT identity revoke. Cleanup е потвърден;
историята е запазена, временните credentials са изчистени. Frontend още не е в production.
Няма owner плащане или автоматично приписан аванс. [Договор, резултати и граници](docs/public/OWNER_FINANCES.md).

**Payment/account/inbound — ограничено hosted API/UI/MVCC PASS (04.11.2026):**
manual payment → explicit allocation/остатък и точно едно цялостно inbound, explicit
active EUR account/version, неизменима историческа компенсация след деактивиране и
атомарен replacement. Трите точни миграции са приложени:34 версии. Осем API групи,
11 native PostgreSQL races с наблюдавани waiters плюс отделният обратен unpaid race, и реален local frontend→hosted UI
са проверени. Cleanup оттегли само временните права/сесии и деактивира собствените
сметки; синтетичната финансова/audit история е запазена, protected baseline е непроменен.
Няма automatic legacy backfill, банково потвърждение, пълен баланс или завършен
payment MVP. Frontend остава draft PR #9, извън main/production.
[Точните резултати, ограничения и release стъпки](docs/public/PAYMENT_INBOUND.md).

**Co-owner B/2 — ограничено hosted API/UI/MVCC приемане PASS (04.11.2026):** обикновена дялова съсобственост с пълен проверен състав и точно представими десетични квоти. Сървърът извежда личните редове от фиксираната обектна сума; мотивиран преглед предхожда атомарното публикуване. `20261103171619` и минималната feed поправка `20261104073315` са приложени; при B/2 backend имаше31 миграции; след общото payment/account/inbound приемане са34 приложени версии (отделната PR #8 версия също е приложена). Шест API групи, три контролирани независими PostgreSQL races и реален локален frontend към hosted са проверени; cleanup пази финансовата/audit история и старите A snapshots. Точни рационални квоти като 1/3, СИО и спорни случаи остават неподдържани. Frontend още е draft PR #9, извън main/production. [Граници и приемане](supabase/README.md#fnd-f05--локална-съсобственост-b2).

**Publish A — целево hosted API/UI/MVCC и естествен rollover PASS:** предишните пет контролирани PostgreSQL случая и ordinary-session/UI проверки са допълнени на 04.11.2026 с точния стар reviewed draft → `charge_day_changed`/HTTP 409. Няма нов batch, начисления, лични редове или publication audit event. Часовникът не е променян; временният контекст е възстановен. Това е техническо приемане на ограничения договор, не юридическа заверка на реален случай или production release. [Договор и release граница](supabase/README.md#fnd-f05--локално-публикуване-a).

**FND-F05 preview — ограниченото hosted приемане е PASS:** шестте точни миграции са приложени; при това приемане backend имаше 28 миграции и 35 приложни таблици (преди publish A по-горе). Обикновени синтетични сесии и реален локален frontend провериха версиите, правата, изчисленията, HTTP 409 и отнемането на права със същия JWT. Допълнително преминаха осем контролирани PostgreSQL/MVCC случая с независими сесии и наблюдавани locks/waiters преди release: activation/preview replay, конфликтни активации, редакция срещу проверка и preview срещу writer/phantom insert. Старите snapshots са неизменни; cleanup е потвърден. Собствениците са само контекст, без лични суми, длъжник или задължение. Frontend остава draft PR #9, извън main/production; това не означава завършен финансов MVP. [Договор и приемане](supabase/README.md#fnd-f05--локален-начислителен-preview).

**DB-D/1–2:** защитен каталог, основание и доказателства, чернова и активация само за **FND-F05: целево набиране при недостиг за основен ремонт по чл. 17, ал. 2, т. 5 ЗУЕС**. Изрични scoped финансови права, точни версии, мотивиран преглед и неизменим snapshot. Синтетичните fixtures не удостоверяват реално решение. [Договор и setup](supabase/README.md#db-d1--локални-финансови-чернови). Шестте миграции на основата и целевото hosted/MVCC приемане са приключили; frontend release предстои. Самата основа не създава задължения; publish A/B са отделни пакети с целево hosted приемане; финансовият frontend release още предстои. Ръчните плащания и еднократното inbound са отделният hosted проверен поднабор по-горе; няма пълен ledger или движение на фондови средства. Реалната клиентска приложимост е отделен gate.

Минималните сигнали и приложението към тях са включени в **един общ frontend release**, обединяващ PR #5/#6 със запазена история. Backend е проверен: 21 миграции, 28 таблици и две отделни download Edge функции. Current owner подава собствен сигнал и един private PNG/JPEG/PDF до 5 MiB; изрично оправомощен служител обработва статуса. Конкретният production commit/READY и live smoke резултат се записват в общия release PR. [Договор, доказателства и операторски правила](supabase/README.md#минимално-приложение-към-сигнал--общ-frontend-release).

**Категория/отговорник от PR #8 — hosted backend проверен:** девет стабилни кода, текущо scoped manage_tickets, причина, revision/PT409 и история. Назначаването не дава права. Exact20261102080729 е приложена; тогава backend имаше22 миграции/28 таблици. Историята на PR #8 вече е включена в PR #9; frontend не е в production. Owner изборът е локално реализираният P2 по-горе; задачите остават неизпълнени.

| Статус | Функции |
|---|---|
| Работят и са проверени | Supabase register/login/logout, pending без роли, реално доставени confirmation/recovery писма и PKCE; отделни platform/org admin процеси, изрични manager/controller назначения; разрешен регистър на имоти и scoped лица; собственост/съсобственост и описателно обитаване с периоди, произход, проверки и история; проверена account-person връзка и минимален собствен изглед |
| Включено в общия Storage/theme release | Един private PDF към имот:18 миграции/25 таблици, JS Edge/S3 download; реални bytes/hash, staff-only/owner opt-in, direct/sign/S3 откази, same-JWT role/link revoke и cleanup PASS. UI/service интеграцията е проверена; общият release включва Storage PR #2 и theme PR #3. Надписът/title/aria на бутона показват следващото действие. Виж [резултатите и setup](supabase/README.md). Конкретният production commit/ready статус се потвърждава отделно за deployment-а |
| Частична основа | Регистърът няма пълен lifecycle/import/mixed-source редактор. Таблото показва ролево разрешени действия, без измислени показатели; каталогът е в разгъваем раздел. Идеалните части имат persisted версии/отделна проверка и връзка с изчислителен preview; целевото hosted API/UI/MVCC приемане е PASS, frontend release предстои |
| Минимални сигнали и приложение — общ release | Двете exact миграции20261101141944/20261101180527 са приложени:20миграции/27таблици. Предишните access/RLS/co-owner/status/same-JWT/UI доказателства плюс новия current→staleHTTP409→reload/current тест затварят минималния договор. Stale отказът еPT409 за109ms, без промяна на ред/events; cleanup е потвърден. Общият release включва signal/attachment UI; категория, отговорник и задачи остават извън тази стъпка, целият REQ009 остава частичен |
| Отделен release / предстоят | Категория/отговорник са включени от PR #8 в общия feature PR #9 и чакат общ release; P2 има отделен hosted/cutover gate. Финансовата FND-F05 основа, publish A/B, ръчните плащания/сметки, първичното inbound, owner P1 read-only проекцията и P4a фондовата аналитичност имат ограничено hosted приемане в PR #9. Exact rational квотите и останалите неподдържани режими на съсобственост остават отделни MVP подстъпки. Разходи, фондови трансфери, начални салда и отчети не са реализирани; пълният owner финансов MVP, задачите, CSV import/export и in-app известия предстоят. Устойчивият синтетичен demo има отделен контролиран достъп, без публичен login bypass |

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
