# Моите финанси — личен read-only преглед

## Ограничено hosted приемане PASS — 04.11.2026

Точната `20261104182905_owner_financial_projection.sql` е приложена еднократно след
fresh34-version baseline, candidate absence и dry-run единствено с нея. SHA-256:
`240cc08bfed5aeeeea95ffe8577467668ebbeb67b51340da1a441cba9cf4a9d3`.
Native read-only inspect потвърди **35 версии**, петте точни function bodies и grants:
authenticated може guarded history/access; anon и direct internal identity helper са
затворени. Няма други миграции, стар SQL edit или продуктова поправка в този пакет.

Шест ordinary-JWT/API и шест тесни frontend→hosted UI/приемателни групи PASS:

- Само личните published parties и signed allocations; mixed payment100/40/60 връща
  own40 без receipt total/ID, чужд payer/contact/account/document/note или foreign parts.
- Съсобственик на същия обект, foreign person/scope/unit filter, staff-only/noidentity
  и owner direct SELECT изолация. Подменен person input се отказва по RPC signature;
  това не се брои за самостоятелно RLS доказателство. Няма права от payer label/рольово име.
- Истински отделен synthetic seller/buyer интервал M03.11→T04.11: seller е с0current
  units и без QA staff SELECT, но запазва личния snapshot; buyer не наследява неговия дълг.
- Original/unpaid replacement/reversal са проследими и само current личните редове
  влизат в сбора. Първоначално personal112.51−coverage40.00=remaining72.51 EUR;
  signed40/−40 след компенсацията възстановява remaining112.51, без скрита история.
- Committed identity-link revoke → нов API/UI403 със същия непроменен JWT; няма refresh
  или нов login между доказаните read/revoke/read стъпки.
- Valid identity без партии е real empty, включително при payer-person на неразнесен
  аванс0.10 без лично beneficiary основание. Staff без identity е real noidentity.
  Controlled500 проверява само UI error≠empty; не е hosted authorization доказателство.
  Mobile/desktop375/1440, двете теми/reload/dashboard са проверени,4screenshots прегледани.

Setup използва съществуващите A/B/OWNER профили в нов маркиран NONDEMO scope.
Existing self-verifier delegation правилно отказа; използван е отделен explicit B
verifier, без self-verification/директен SQL за owner link или промяна на authority.
Само новите own synthetic unit-membership periods имат изрично подаден предходен ден
с journal/audit, за да е реално приложим seller fixture; не са редактирани стари записи.

Cleanup е потвърден с отделна actual SELECT сверка:0 активни own роли/links/sessions/
останали native connections;7 роли и3 identity links отнети,11 собствени Auth сесии
затворени, own account archived и scope/assignment inactive. Exact nondemo membership
baseline е възстановен. Старите snapshots/лични/demo записи и7Auth са запазени.
Остават маркирани synthetic3batches/12charges/18parties,3payments/3movements/4allocations
и audit: original100 е компенсиран, allocations40/60/−40/−60 са история;0.10 е валиден
неразнесен QA аванс без owner attribution. Подробните IDs/journal са локални, извън Git.
Временните CLI token и DB URI са изчистени; ordinary QA паролите/server secrets са запазени.

Това затваря P1 hosted access/UI gate, **не production release или пълния owner MVP**.
Няма нов native MVCC race: read-only проекцията не променя writers/lock contracts, чиито
предишни доказателства са запазени. Invalid profile/person-revision/session отрицателните
варианти остават локално доказани; тук е добавен real same-JWT link-revocation runtime.
Няма standalone advance beneficiary, owner payment, funds/reports/export/notifications,
exact rational/СИО разширяване или общ as-of engine.

## Договор P1 преди DDL — 04.11.2026

Локална реализация върху FND-F05 published parties и explicit payment allocations.
Няма нови задължения, плащане от собственик, преразпределяне, отчетен баланс или
самостоятелен аванс. Това не завършва целия owner финансов MVP.

`my_financial_history(unit_filter uuid default null)` извежда caller от Auth,
изисква потвърден активен профил/жива сесия и неревокирана account-person връзка към
активно verified лице със същата revision. Не приема profile/person/debtor/scope ID.
Optional unit filter се сверява само с разрешените лични публикувани редове.
Липса на валидна идентичност: `42501/owner_finance_identity_required`; неподходящ
filter: `42501/owner_finance_filter_forbidden`. Валидна идентичност без редове е empty.

D18: няма JOIN към текущ owner/management assignment за правото върху исторически
личен дълг. Бившият собственик с валидна identity link чете собствените си parties,
не новите операции/регистър на купувача. Link/person/profile/session revocation
се проверява при всяка нова заявка. `confirm_owner_link` не се разширява.
Staff и admin права не разширяват тази проекция; staff+owner вижда тук само своето.

`my_financial_access()` връща само boolean за достъпната лична дейност в навигацията,
без payload или нови права. Историята проверява отново самоличността независимо от него.

DTO v1: `schema_version`, `currency=EUR`, `items`, `totals` (точни string assessed/covered/
remaining само за текущите лични редове). Всеки item има opaque party/unit ID,
исторически `unit_label`, `liability_date`, `due_date`, `published_at`, `period_start/end`,
`status=current|superseded|reversal`, string `assessed_amount`, разрешен string
`unit_amount`, string `covered_amount`, nullable string `remaining_amount`, nullable
`related_item_id` само към друг собствен видим ред и `coverage`.

Coverage ред: собствен allocation ID, signed exact string amount, source payment date,
recorded timestamp, nullable compensation date, own `reversal_of_id` и системен
`basis_code=manual_coverage|coverage_reversal`. Не се връщат payment ID/цялата му сума,
payer label/person, contacts, bank account/reference, document reference, arbitrary
note/purpose, чужди allocations, unallocated credit или raw snapshots/review/audit JSON.
При payment100 с own40/foreign60 се връща40, без100/60 и чужди полета.

Current remaining = фиксираната лична сума − signed собствените allocations. Не се
преизчислява личната отговорност/квота. Superseded/reversal item има remaining=null
и не влиза в текущия сбор; original/correction/reversal историята се пази. Missing
стойност не става0. Самостоятелен неразнесен аванс няма автоматично owner beneficiary.

Public invoker wrapper → private fixed-search-path guarded projection; базовите
таблици/SELECT политики и всички finance writers остават непроменени. UI е „Моите
финанси“ в Account, достижим и без текущ owned unit. Няма данни в localStorage.
Loading/noidentity/empty/error са отделни състояния; UI не налага server права.

Официална техническа основа: [database functions](https://supabase.com/docs/guides/database/functions)
и [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
## Запазено локално приемане на checkpoint8f4134a

Към този локален checkpoint миграцията `20261104182905` беше неприложена; текущият
hosted резултат е записан по-горе.
`npm run check:owner-finances`:10 целеви локални DB/RLS/DTO групи PASS.
`npm run check:owner-finances-browser`:9 тесни реални UI/service групи PASS:
SDK/HTTP към disposable PGlite и симулиран Auth, съсобственик40/60, foreign filter403,
loading/noidentity/empty/error, former-owner dashboard, staff+owner изолация,
same-session link revoke, signed reversal history,375/1440две теми/reload.
Четирите актуални screenshots са прегледани: четими в двете теми без horizontal overflow.
Production build в отделна директория и navigation/assets на11HTML входа PASS;
потребителският preview/build не е подменян. Syntax и прегледът на19изрични public paths
са PASS, без credentials loading. Secret pattern scan не е доказателство за всеки
възможен вид секрет; вътрешни документи/QA артефакти не са част от публичния комплект.
Самостоятелният fixture използва съществуващия детерминиран локален publication day;
не е променян часовникът на машина/hosted проект. Няма претенция за hosted/MVCC PASS.
Няма нов owner payment writer, advance beneficiary, funds/reports/export или пълен
owner финансов MVP. Предишните SQL файлове и финансовите write пътища са непроменени.

## Запазен setup/resume/cleanup план за отделно разрешен нов run

Текущият run е приключен и проверен. Не повтаряй apply/setup/cleanup по старите receipts.
Точките по-долу пазят първоначалния план; нов run изисква fresh baseline и нов marker.

1. Read-only baseline на точния проект, действителна история, липса на candidate и
   съвпаднал SQL hash. След P1 са потвърдени35 applied версии, включително20261104182905.
   Тази версия не се прилага повторно. Нов candidate изисква отделно разрешение; без повторение на
   старите financial/Auth/Storage/signal набори.
2. Отделен маркиран NONDEMO run с baseline/manifest/намерение преди writes; съществуващи
   ordinary QA identities и минимални временни явни verifier/financial назначения.
   Защитени лични и PH-DEMO-V1 records/назначения не се променят. Не се ползват стари
   QA batches като демо. Session/identity provenance и точните IDs се записват privately.
3. Guarded синтетични published own/co-owner parties, mixed100 с own40/foreign60,
   current/historical ownership и correction/reversed-coverage fixtures. Проверяват се
   exact personal/current totals, whitelist/no foreign payload, denied filter/actor spoof,
   direct table RLS и owner+staff separation. Историческият seller чете своя snapshot,
   buyer не наследява чужд дълг/нови операции. Valid identity без debt е empty.
4. Един и същ реален JWT: read → committed link revoke → нов read403; отделно current
   person revision/session checks; липсващите profile prerequisites се проверяват без
   промяна на споделените demo/лични profile status. Само собствени QA session IDs могат
   да бъдат затваряни. Access boolean не замества реалния RPC отказ.
   Тесен local frontend→hosted UI на отделен QA порт/профил, error≠empty, reload.
   Read-only projection не заявява нов MVCC writer gate; real hosted session/RLS runtime
   е доказан в горния ограничен обхват. Local mocks/PGlite сами не го заменят.
5. Inspect след unknown outcome преди retry; cleanup само на exact own receipts за
   временни назначения/връзки/сесии. Financial snapshots/allocations/audit история се
   запазват с marker/IDs/status. Baseline на защитените записи се сравнява. Само бъдещи
   изрично разрешени операторски credentials се изчистват след употреба, без стойности
   в journal/логове. При unknown write първо inspect на точните IDs/receipts, без blind retry.
