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
