# Моите финанси — личен read-only преглед

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
## Локално приемане и граници

Неприложена миграция: `20261104182905_owner_financial_projection.sql`.
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

## Тесен бъдещ hosted gate — изисква отделно разрешение

1. Read-only baseline на точния проект, действителна история, липса на candidate и
   съвпаднал SQL hash. Последно34 applied версии, без свежа hosted сверка в P1.
   Dry-run/apply само на новия candidate след съвместимост с live; без повторение на
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
   още трябва да е доказан. Local mocks/PGlite не го заменят.
5. Inspect след unknown outcome преди retry; cleanup само на exact own receipts за
   временни назначения/връзки/сесии. Financial snapshots/allocations/audit история се
   запазват с marker/IDs/status. Baseline на защитените записи се сравнява. Само бъдещи
   изрично разрешени операторски credentials се изчистват след употреба; P1 не ги чете.
