# Ръчно отчетено плащане и изрично покритие

## Статус и граница — 04.11.2026

Само локално проверен кандидат `20261104080554_manual_payment_allocations.sql`
в draft PR #9. **Не е приложен hosted; payment API/UI/MVCC PASS няма.** Предходните
B/2 и Publish A rollover доказателства не доказват този нов процес.

Ръчното отчитане не е банково потвърждение, получаване на средства през приложението
или промяна на касова/банкова наличност. DB-26 изискването за едно inbound
`money_movement` остава **задължителен следващ зависим пакет**, не отпаднал MVP обхват.
Няма разходи, фондови движения, банкови услуги или owner финансов портал.

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

1. `record_manual_payment(scope,payload,request_key,note)` създава immutable receipt.
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

`reverse_manual_payment` изисква точната текуща revision и двете права. Добавя
свързан отрицателен payment и отрицателни allocations, освобождаващи само старите
покрития. Оригиналите не се редактират/изтриват. Това е отмяна на отчетения запис,
**не банков refund** или реално изходящо движение.

`replace_manual_payment` прави същата отмяна и нов положителен receipt атомарно,
с връзка към оригинала. Новата сума остава неразнесена до ново изрично указание;
старите allocations не се копират. Историята пази причината, actor и връзките.
Повторени отмени/корекции не създават втора reversal операция.

Published charge/party snapshots остават неизменни. Unpaid full-batch correction
е разрешена само когато няма **никаква allocation история** към стария batch.
Дори след отменено плащане исторически покритият batch остава извън този unpaid
template; необходим е бъдещ отделен payment-aware charge correction договор.
Само неразнесен receipt не блокира корекция на непокрит batch.

`payments.id` е стабилната връзка за бъдещия `money_movements.payment_id` с unique
source constraint. Следващият пакет трябва да сверява вече съществуващите receipts/
reversals и cutover/provenance, да записва постъплението веднъж и да не създава ново
плащане или allocations. Засега няма cash/fund balance и няма такъв posting engine.

## DB-26 inbound — чист domain договор, 04.11.2026

`src/domain/payment-movements.js` подготвя само детерминирано намерение. Няма DB,
API, UI, банков достъп, credentials, собствен clock или persistence. Проверява се с:

```powershell
npm.cmd run check:payment-movements
```

**8 синтетични domain групи PASS.** Това не е DB/RLS/API/hosted/MVCC приемане и
не завършва DB-26. Manual-payment migration остава неприложена; този пакет няма SQL.

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
Самото `id` на бъдещия DB movement се назначава от сървъра; source key не е измислен
UUID на вече записан ред.

120получени с40отнесени+80свободни → едно намерение за120. След ново отнасяне
100+20или120+0 изходът е **идентичен**. Allocation state се валидира, но не участва
в идентичността или съдържанието на движението. Няма втори приход за всеки личен ред.
Същият payment UUID има същия source key при повторение и различен входен ред.
Промяна на account/сума под същия key не разрешава втори запис: бъдещият server
трябва да провери immutable input и да върне съществуващ резултат или HTTP409.

### Компенсация и корекция

`preparePaymentCompensation({reversal_payment,original_movement,account,
compensation_date,as_of_date,reason})` изисква:

- Точния **записан** първичен movement UUID плюс каноничните му неизменени полета.
  Само payment ID или липса на движение не е достатъчна за автоматична компенсация.
- Negative `kind='reversal'` payment с отделен UUID, точен `reversal_of_id` към
  оригиналния payment, същите scope/валута/метод/изходна дата и цялата обратна сума.
- Същата изрично активна account конфигурация; няма прехвърляне към друга сметка.
- Изрична причина и дата от оригиналната дата до `as_of_date`, включително границите.
  Това е ограничение на този първи технически договор, не правило за правно или
  счетоводно backdating. Не се избира тихо датата на оригинала или текущият ден.

Резултатът е положителна цяла сума с `direction='out'`, `kind='payment_reversal'`,
source key по reversal payment UUID и точни `reversal_of_id`/`reversal_of_key` към
оригиналното движение. Оригиналът остава непроменен. Това е компенсиращ отчетен запис,
не банков refund или expense payment. Archived account/correction-date policy извън
тези граници остава блокирана; модулът не я заобикаля чрез друга сметка.

При replacement бъдещата транзакция трябва да свърже стария receipt, компенсацията
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

### Следващ атомарен DB пакет и общ payment/MVCC gate

1. Първо зависимият приложен account-configuration пакет, описан по-долу, и
   проверима конфигурация/provenance, без наследяване от admin роли.
   Нова отделна миграция; committed20261104080554 не се
   редактира. Ръчното receipt-only API не трябва да остане bypass за normal postings:
   versioned atomic write с изричен account или конкретен fail-closed отказ.
2. Нормално получаване: текущи права + locked account/scope/currency/source → receipt
   и точно едно inbound движение за цялата сума в една транзакция. Няма частичен receipt
   без задължителното му posting. Future unique(payment_id)/source key, FK и canonical
   payload/receipt проверки осигуряват реалната идемпотентност.
3. Allocation променя само coverage/remainder. Cancellation/replacement атомарно
   пази оригинала, counter-allocations и съответната whole compensation; exact original
   FK + unique reversal guard изключват двойна компенсация. Всички financial writes
   споделят договорения lock order и безопасния HTTP409 конфликтен механизъм.
4. Общ local gate за receipt+movement+allocations+compensation, след това отделно
   разрешено fresh hosted preflight на actual историята (последно31), exact hashes/
   подредените pending manual и бъдещия inbound кандидат, dry-run и проверка на
   съвместимостта. Няма fixtures или обещание за PASS преди завършената схема.
5. Ordinary-session API/UI assertions плюс независими PostgreSQL transactions с
   controlled barrier/observer/waiter: duplicate receipt/posting, two allocations към
   един остатък, cancellation срещу allocation, duplicate compensation/replacement и
   payment срещу unpaid correction. Един цял допустим резултат или timely409; няма
   double cash, orphan posting, overcoverage или частична корекция.
6. Same-JWT revoke, missing/archived/wrong-scope account и spoofed source откази;
   непроменени A/B snapshots/demo/personal baseline. Unknown result → exact receipts/
   movement IDs inspect преди retry. Own-only cleanup със запазена финансовa/audit
   история и отделен запис за transition resources. Без PH-DEMO-V1 mutations.

Този план не е DB-26 реализация или разрешение за apply. Account lifecycle е
реализиран в отделния локален DB-21 кандидат. DB-26 posting RPC/constraints,
атомарност, transition и hosted/MVCC приемането още предстоят.

### Конфигурация на парични сметки — следващият локален кандидат

DB-21 вече е локално реализиран и проверен, с неприложена20261104110007. [CASH_ACCOUNTS](CASH_ACCOUNTS.md) определя единственото право manage_cash_accounts, explicit org-admin назначения, scoped read-only, неизменима икономическа идентичност, version/reason/history и еднопосочно деактивиране. Това не променя manual-payment allocations и не записва постъпление.

Следва само отделната атомарна payment↔movement DB-26 интеграция и общото hosted/MVCC приемане. Не се backfill-ват старите синтетични плащания автоматично. Текущият domain отказва компенсация през неактивна сметка; историческият correction policy извън тази граница още изисква отделно решение.

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

## Следващо hosted/MVCC приемане — само след отделно разрешение

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
