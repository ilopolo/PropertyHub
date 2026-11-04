# Ръчно отчетено плащане и изрично покритие

## Статус и граница — 04.11.2026

**04.11.2026: ограничено hosted API/UI/native PostgreSQL MVCC приемане PASS.**
Точните версии `20261104080554` → `20261104110007` → `20261104114357` са
приложени еднократно след проверени hashes и dry-run само с тези кандидати.
Потвърдени са **34 приложени миграции**. Frontend остава draft PR #9, извън main/production.
Не са променяни предходни SQL, Auth акаунти, production hosting или Edge функции.

## Реално hosted приемане — 04.11.2026

**04.11.2026: ограничено hosted API/UI/native PostgreSQL MVCC приемане PASS.**
Точните версии `20261104080554` → `20261104110007` → `20261104114357` са
приложени еднократно след проверени hashes и dry-run само с тези кандидати.
Потвърдени са **34 приложени миграции**. Frontend остава draft PR #9, извън main/production.
Не са променяни предходни SQL, Auth акаунти, production hosting или Edge функции.

Осем ordinary-session API групи провериха: explicit scoped права и липса на org-admin
наследяване; цял receipt с точно едно inbound; частично отнасяне/аванс и неизменно
постъпление; replay/stale HTTP409; чужд scope/подменени данни/direct и legacy write
откази; историческа компенсация след деактивиране; атомарен replacement с причина
при друга сметка; successful record → отнето право → отказ със **същия JWT**.
Реален deferred-constraint failure в отделна native транзакция доказа rollback на
payment, movement, allocations, operation receipt и audit. Не са заменяни общи функции
или triggers за теста. Всички използвани сметки са изрично избрани, EUR и method-compatible.

Единадесет native PostgreSQL случая използваха независими holder/contender/observer
connections, официалния CA и проверен TLS, наблюдаван waiter/blocker преди release,
deadlines и finally затваряне. Проверени са duplicate receipt; configuration writer
и stale account revision; двете подредби receipt/deactivation; конкуриращи allocations
за един payment и за един личен остатък; двете подредби allocation/reversal; duplicate
compensation; competing replacements; allocation, което печели срещу прегледана
unpaid batch correction. Няма двойни/частични postings, overcoverage или променени
стари charge/party snapshots. На 04.11.2026 е изпълнен отделно **само обратният unpaid
race**, без повторение на тези 11 случая: B публикува валидна прегледана unpaid correction
като holder; independent A allocation към стария party е наблюдаван waiter преди release.
След holder commit то отказва `PT409/payment_obligation_not_current`. Committed са цели
original/reversal/replacement batches, по 4 начислителни и 6 лични реда; old snapshots са неизменни.
Няма allocation или негов operation receipt, а платежният запис от 1.00 EUR остава изцяло неразнесен.
Двете конкретни подредби вече са hosted доказани; не се твърдят всички interleavings.

Отделният run пази 3 синтетични пакета начисления, 12 начислителни и 18 лични реда, 1 плащане и 1 inbound, без отнасяния.
Cleanup е PASS: 4 собствени назначения (включително отнетия initial setup grant), 5 собствени сесии,
деактивирана получаваща сметка и собствен scope/assignment, възстановен membership
и непроменен защитен baseline; Auth акаунтите остават 7. Финансовата/audit история се пази.
Операторският DB URI е изчистен; CLI token не е нужен/зареждан. Общите retained counts
след този run са 24 payments, 24 movements и 10 allocations. Няма нова миграция или product fix.

Реален локален Vite/Edge frontend към hosted проекта на отделен QA порт: receipt
1.00 EUR → explicit allocation 0.01 → остатък 0.99 → атомарна корекция с нов receipt
0.90 по друга активна сметка, без автоматично ново allocation. B с record право
няма correction действия. Reload/navigation и четири лично прегледани screenshots
375/1440, light/dark са PASS. Това е feature frontend, не production/live smoke.

Cleanup на първоначалния payment run PASS: шест собствени сметки са деактивирани, девет run назначения са
оттеглени, временно активираният membership е върнат към baseline. Собствените Auth
сесии и native транзакции/връзки са затворени. Остават **23 синтетични payment реда**
(17 receipts: 11 валидни и 6 отменени; 6 reversal реда), 23 movements, 10 allocation
реда и една непубликувана correction draft. Account versions, snapshots и audit са
запазени; точният retained-ID manifest е локален. Защитените предишни записи/demo,
личните записи съвпадат с baseline; Auth акаунтите остават седем, без създаване или изтриване. CLI token/DB URI са изчистени.

Ограничения: ръчен отчет, не банково потвърждение или пълен баланс; няма legacy backfill,
банкови услуги, opening balances, разходи, трансфери, фондови движения или отчети.
В hosted базата нямаше предходни payment редове при apply: nonempty legacy upgrade
остава локално доказан сценарий. Platform-admin-only и read_rules-only отрицателните
fixtures са от предходните локални проверки; новото hosted admin-denial доказателство
е с org admin. Повторения с нов key не разпознават автоматично една реална банкова
транзакция. Пълният payment MVP/owner финансов портал не са обявени за завършени.

Следващ release gate: отделно разрешен общ feature integration/public review и един
main release; текущото приемане **не разрешава merge/deployment**. Не се повтарят
apply/setup или завършените набори без засегната промяна. За нов run се изискват нов
marker/baseline, изрично разрешение и exact history inspect, не replay на този manifest.


### Legacy upgrade: local-only граница и текущ release

Запазеният локален upgrade fixture съдържа receipt преди inbound миграцията. Проверява
се, че след apply старият payment row е непроменен, movements остават 0, историческият
feed го чете и новата компенсация отказва с 23514 вместо да измисля movement. Това е
**локално PGlite доказателство**, не hosted upgrade на непразна payment база.

При реалния apply payment таблиците бяха празни. Тесният SELECT от обратния race
потвърди 24 payments, 24 movements и 0 payments без movement. Затова липсата на nonempty
hosted upgrade тест **не блокира текущия frontend release към тази вече мигрирана база**,
при запазени fail-closed legacy write входове и без внос/конвертиране на стари receipts.
Това не е общо разрешение за release или доказателство за реален legacy cutover.
Преди приемане/конвертиране на исторически платежни записи е нужен отделен контролиран
manifest/document/account-version/date/duplicate и hosted acceptance gate. Няма backfill
или историческо преобразуване в този пакет.

## Права и данни

- `read_payments`: отделно изрично scoped право за manager/cashier/controller.
- `record_payments`: необходимото четене, запис и изрично отнасяне.
- Отмяна/корекция: едновременно `record_payments` и `correct_finance` в същия scope.

Каталогът на допустимите права не назначава никого. Admin роли, `read_rules`,
ownership и account-person link не дават payment достъп. Owner partial projections
по D18 остават отделна необходима MVP стъпка; базовите payment таблици не са owner API.

Плащането пази платец според документа, optional scoped person ID, дата на получаване,
точна EUR сума, отчетен начин (`cash`/`bank_transfer`), документна референция,
предназначение, причина, server actor/time и произход `manual_report_v1`.
Самоличността/автентичността на платеца не се удостоверява автоматично от формата.
Платецът може да е трето лице; той не сменя длъжника и не получава права.
Датата е валидна calendar DATE, не бъдеща спрямо server Europe/Sofia.

Сумите използват съществуващия точен money validator: положителни decimal strings,
до12цели цифри и2десетични позиции, без rounding. SQL приема canonical две позиции.
Няма float междинни стойности. Revision е отделен брояч на immutable събитията.

## Процес и инварианти

1. `record_manual_payment_inbound(scope,account_id,account_revision,payload,request_key,note)` създава immutable receipt и точно едно full inbound атомарно.
   Първоначално цялата сума е неразнесена; няма implicit FIFO или автоматичен debtor.
2. `allocate_manual_payment(scope,payment_id,expected_revision,obligation_party_id,amount,request_key,note)`
   покрива точно избрания личен ред. Charge, person, scope и остатъкът се извеждат
   от сървъра; клиентът не подава свободен длъжник, charge или готов snapshot.
3. Всеки allocation е отделно изрично указание. Receipt и личният ред са в един scope;
   задължението е публикувано, положително и от текущ неотменен batch. Няма служебно
   преместване на credit между receipts, лица, обекти или обхвати.
4. Отнесеното не надхвърля нито свободната сума, нито точния личен остатък.
   За валиден receipt: **отнесено + неразнесено = сумата**. Частичното покритие и
   свободният аванс следват FIN-005; например120→100покритие+20аванс. Авансът пази
   платеца, предназначението, датата и scope на същия receipt, без автоматичен трансфер.
5. Same actor/request key и същият canonical input връщат същия резултат. Променен
   input със същия key, stale revision или надвишен остатък дават `PT409`/HTTP409.
   Няма автоматичен retry или банково разпознаване на еднакви реални транзакции.

Всички writers ползват общия scope `:charge-publication` advisory lock с publish/
unpaid correction. След изчакването правата и остатъците се проверяват отново.
Това е техническа защита; реалните interleavings още изискват PostgreSQL/MVCC приемане.
Таблиците са SELECT-only с RLS; writes минават през guarded RPC с проверен actor,
fixed search_path, ограничени grants, operation receipt и audit.

## Отмяна, корекция и начислителни snapshots

`reverse_manual_payment_inbound` изисква точната текуща revision, двете права и изрична compensation_date. Добавя
свързан отрицателен payment и отрицателни allocations, освобождаващи само старите
покрития. Оригиналите не се редактират/изтриват. Това е отмяна на отчетения запис,
**не банков refund** или реално изходящо движение.

`replace_manual_payment_inbound` прави същата отмяна/whole compensation и нов положителен receipt/inbound атомарно,
с връзка към оригинала. Новата сума остава неразнесена до ново изрично указание;
старите allocations не се копират. Историята пази причината, actor и връзките.
Повторени отмени/корекции не създават втора reversal операция.

Published charge/party snapshots остават неизменни. Unpaid full-batch correction
е разрешена само когато няма **никаква allocation история** към стария batch.
Дори след отменено плащане исторически покритият batch остава извън този unpaid
template; необходим е бъдещ отделен payment-aware charge correction договор.
Само неразнесен receipt не блокира корекция на непокрит batch.

`payments.id` вече има unique стабилна връзка с `money_movements.payment_id` в локалния inbound кандидат. Корекцията използва original account/version snapshot, включително след деактивиране. Replacement изисква ACTIVE account/version и конкретна причина при различен account ID. Старите receipt-only record/reverse/replace входове са fail-closed; allocation/historical read се пазят. Няма backfill на стари receipts или пълен balance engine. [Подробности и API](PAYMENT_INBOUND.md).

## DB-26 inbound — чист domain договор, 04.11.2026

`src/domain/payment-movements.js` подготвя само детерминирано намерение. Няма DB,
API, UI, банков достъп, credentials, собствен clock или persistence. Проверява се с:

```powershell
npm.cmd run check:payment-movements
```

**8 синтетични domain групи PASS.** Това не е DB/RLS/API/hosted/MVCC приемане и
самостоятелно не завършва DB-26. Pure helper няма SQL; отделната локална интеграция
е описана в [PAYMENT_INBOUND](PAYMENT_INBOUND.md). Трите миграции са приложени; общото ограничено hosted приемане е отчетено в началото.

### Изрични входове и сметка

`preparePaymentReceipt({payment,account,allocation_state,as_of_date})` приема trusted
server projections, не произволен клиентски payload:

- `payment`: `id`, `scope_id`, изрично `currency='EUR'`, положителна `amount`,
  `payment_date`, отчетен `method`, `origin='manual_report_v1'`, `kind='receipt'`,
  изрично `reversal_of_id=null`, `replaces_id` (null или точният предходен payment ID).
- `account`: конкретен UUID `id`, `scope_id`, `currency='EUR'`,
  `account_type='cash'|'bank'` и изрично `archived_at=null`.
- `allocation_state`: изрични `allocated_amount` и `unallocated_amount`, включително
  нулите. Сборът им трябва точно да възстановява цялата платежна сума.
- `as_of_date`: изрична валидна проверочна дата; получаването не е след нея.
  Бъдещият сървър извежда тази дата по Europe/Sofia, не я приема за доверена от клиента.

Методът `cash` е съвместим с cash account, `bank_transfer` — с bank account. Това
е проверка на **вече избраната** сметка, не избор по метода. Липсваща, непълна,
архивирана или несъвместима конфигурация отказва; няма fallback, автоматично
възстановяване на сметка или подразбираща се EUR валута. Сметката е място на парите;
фондът е предназначение, категорията е вид основание. Модулът не избира фонд или
категория и не доказва нормативна пригодност на банкова сметка за ремонтния фонд.

Прието решение: конкретните сметки се управляват **приложно от оправомощени
представители на организацията/етажната собственост чрез отделно изрично scoped
право**. Операторският setup не е избраният нормален клиентски процес.
В следващия локален DB-21 кандидат са реализирани `manage_cash_accounts`, защитеното назначаване и account lifecycle; [точният договор](CASH_ACCOUNTS.md). Тази конфигурация не е DB-26 posting.
Оперативните права вече са приети: текущо `record_payments` за запис/posting;
компенсация изисква и `correct_finance`; `read_payments` или `record_payments` за
служебен преглед. Няма admin/role-name/read_rules наследяване. Domain функцията
не удостоверява назначение, самоличност, документ или банково получаване.

### Едно първично постъпление

Изходът е `manual-payment-movement-v1`: `source_key='payment:<canonical UUID>'`,
`payment_id`, scope/account/currency, `kind='payment_receipt'`, `direction='in'`,
цялата положителна `amount` и точните integer-string `amount_cents`, дата и произход.
Стойностите използват съществуващите money validators и BigInt, без float/rounding.
Самото `id` на DB movement се назначава от сървъра; source key не е измислен
UUID на вече записан ред.

120получени с40отнесени+80свободни → едно намерение за120. След ново отнасяне
100+20или120+0 изходът е **идентичен**. Allocation state се валидира, но не участва
в идентичността или съдържанието на движението. Няма втори приход за всеки личен ред.
Същият payment UUID има същия source key при повторение и различен входен ред.
Промяна на account/сума под същия key не разрешава втори запис: локално реализираният server
трябва да провери immutable input и да върне съществуващ резултат или HTTP409.

### Компенсация и корекция

`preparePaymentCompensation({reversal_payment,original_movement,account,
compensation_date,as_of_date,reason})` изисква:

- Точния **записан** първичен movement UUID плюс каноничните му неизменени полета.
  Само payment ID или липса на движение не е достатъчна за автоматична компенсация.
- Negative `kind='reversal'` payment с отделен UUID, точен `reversal_of_id` към
  оригиналния payment, същите scope/валута/метод/изходна дата и цялата обратна сума.
- Точната историческа account конфигурация от original movement snapshot, валидна при първоначалния запис. Текущата сметка може вече да е деактивирана; няма unarchive или прехвърляне. Pure validator получава този доверен snapshot, не променена текуща проекция.
- Изрична причина и дата от оригиналната дата до `as_of_date`, включително границите.
  Това е ограничение на този първи технически договор, не правило за правно или
  счетоводно backdating. Не се избира тихо датата на оригинала или текущият ден.

Резултатът е положителна цяла сума с `direction='out'`, `kind='payment_reversal'`,
source key по reversal payment UUID и точни `reversal_of_id`/`reversal_of_key` към
оригиналното движение. Оригиналът остава непроменен. Това е компенсиращ отчетен запис,
не банков refund или expense payment. Приетият historical compensation договор използва original stored account/version, current record_payments+correct_finance, explicit date/reason и unique original reversal. Други случаи извън тези граници не се заобикалят чрез друга сметка.

При replacement реализираната локална транзакция свързва стария receipt, компенсацията
и новия receipt с отделното му изрично избрано account основание. Няма автоматичен
трансфер, копиране на allocations или промяна на личните начислителни snapshots.

### Отделен контролиран преход на стари записи

Няма автоматичен loop/backfill на съществуващи manual receipts. Нужен е отделно
разрешен manifest с точните payment IDs, origin/статус/reversal chain, пълна сума,
документна референция, конкретна сметка и версия/основание на конфигурацията,
избрана дата/cutover и проверка за вече съществуващ posting. Opening/legacy credit
или сума, вече включена в opening cash, не е нов приход. Нов key не поправя липсващо
основание и не разрешава повторно постъпление. Не се създава нов payment/allocation.

Предишните synthetic начисления/preview/batches не са плащания. Наличието на суми
1500.03или1000.06EUR в QA историята не доказва получени пари и не се преобразува в cash.
Domain приемането тук не установява действителното наличие на стари payments hosted.

### Атомарен DB-26 кандидат и общ payment/MVCC gate

Интеграцията е реализирана и приложена с20261104114357. Предходните SQL са непроменени. [PAYMENT_INBOUND](PAYMENT_INBOUND.md) определя всички RPC, constraints/receipts/locks, приетата историческа compensation, новите14локални групи и точния общ hosted/MVCC резултат за трите версии. Няма automatic backfill.

Приложната account конфигурация е отделният локален DB-21 кандидат с manage_cash_accounts; payment права не я редактират. [CASH_ACCOUNTS](CASH_ACCOUNTS.md) остава водещ за конфигурацията. Няма движение от самото създаване/редакция на account.

## Локално приемане

```powershell
npm.cmd run check:manual-payments
npm.cmd run check:manual-payments-browser
npm.cmd run build
```

11целеви domain/DB/RLS групи и реален изолиран Edge/Vite/SDK/HTTP/service/UI процес
са PASS. Пълно/частично покритие, аванс, exact остатък, replay/stale409, чужд scope,
forged fields, explicit read/record/correction разделяне, append-only cancellation/
replacement и unpaid конфликт са проверени. Локалното съревнование е сериализирано
от PGlite; **не е PostgreSQL MVCC доказателство**. UI е проверен на375/1440 в две теми,
reload/navigation и различаване на technical error от empty;4снимки са прегледани.
Disposable fixtures не използват PH-DEMO-V1 или потребителския preview4173.

## Исторически pre-apply hosted/MVCC план — изпълнението е отчетено в началото

1. Fresh pinned project `qfybswnezdzzahmozikr`, actual history, candidate absence/
   hash и съвместимост с текущия live клиент. Запазеният baseline е31applied; клонът
   има31SQLфайла, а вече applied PR #8 версията е отделна. Изолирана пълна CLI история
   трябва да има само този един pending кандидат. Exact dry-run → pre-apply checkpoint
   → apply веднъж → actual32/function/grants/schema verification. При unknown първо
   inspect, не повторен apply. Старите миграции не се редактират.
2. Existing ordinary QA sessions и отделен маркиран non-demo scope. Exact manifest/
   baseline преди всеки write; минимални explicit record/read/correction grants,
   immutable synthetic published A/B parties; без нов Auth, PG GRANT или demo права.
3. Hosted API/UI: exact partial/full/advance sums; third-party payer; foreign scope,
   forged target/amount, direct DML/admin/read_rules denial; same-JWT role revoke;
   same-key replay/changed input; cancellation/replacement и unchanged charge snapshots.
4. Independent PostgreSQL holder/contender/observer с controlled barrier и наблюдаван
   waiter преди release: (a) duplicate receipt key; (b) same-payment stale allocations;
   (c) two payments racing for one personal remainder; (d) allocation/cancellation;
   (e) allocation/unpaid batch correction в двете сериализирани посоки. Един допустим
   winner/HTTP409, без overcoverage, partial cancellation или двойни записи. Обикновени
   JWT claims за assertions; operator само setup/observer/точен cleanup.
5. Преглед на exact receipts/IDs след unknown result. Cleanup отнема само собствените
   роли/сесии, затваря собствените транзакции и пази marked financial/audit history.
   Old A/B/demo/personal baseline hashes трябва да съвпадат. Не се изтриват receipts,
   allocations или публикувана история. Изчисти временния CLI token/DB URI.

Credentials за бъдещия run: original-root ignored `.env.migration.local` /
`SUPABASE_ACCESS_TOKEN` с database_write/database_pooling_config_read; independent
Session pooler URI във `.env.finance-mvcc.local` / `FINANCE_QA_DATABASE_URL`, official
CA/TLS и вече разрешения operator с observer/own-session cleanup/SET ROLE права;
ordinary QA credentials във `.env.rls.local`. Без Edge/Storage secrets или настройки.
Не се попълват/зареждат за локалните проверки.

Официална техническа основа: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
и [PostgREST custom HTTP errors](https://docs.postgrest.org/en/stable/references/errors.html#raise-errors-with-http-status-codes).
