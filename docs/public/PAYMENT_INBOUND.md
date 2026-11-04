# Ръчно плащане и атомарно постъпление — DB-26

**04.11.2026: ограничено hosted API/UI/native PostgreSQL MVCC приемане PASS.**
Точните версии `20261104080554` → `20261104110007` → `20261104114357` са
приложени еднократно след проверени hashes и dry-run само с тези кандидати.
Потвърдени са **34 приложени миграции**. Frontend остава draft PR #9, извън main/production.
Не са променяни предходни SQL, Auth акаунти, production hosting или Edge функции.

Няма банкови интеграции, разходи, трансфери, начални салда, фондови движения
или претенция за пълен счетоводен/паричен баланс.

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

## Атомарност и права

Нов валиден receipt и точно едно първично inbound движение за **цялата** сума се
създават в една транзакция. Всички суми са точни евроценти. Explicit allocation и
авансът променят само покритието/неразнесения остатък; не създават второ постъпление.
Платецът остава отделен от длъжника; charge/party snapshots не се променят.
Ръчният отчет не доказва получаване от банка.

- Текущо scoped `record_payments`: запис/отнасяне и необходимото четене.
- Четене: `read_payments` или `record_payments`, без admin/owner/read_rules наследяване.
- Корекция: едновременно `record_payments` **и** `correct_finance` в същия scope.
- `manage_cash_accounts` управлява само конфигурацията и не дава payment достъп;
  payment правата не дават редакция на конфигурацията.

Получаващата сметка се избира изрично: active account ID и текуща revision,
същият scope, EUR и съвместимост `cash→cash`, `bank_transfer→bank`. Сървърът заключва
и проверява конфигурацията/версията; няма избор по метод, фонд или категория.
В movement остава точният неизменим account-version snapshot.

## Корекции, включително след деактивиране

Приетият ограничен исторически договор допуска **еднократна пълна** компенсация
на точния първичен movement. Сървърът извежда сумата, account ID/version/snapshot
и original links от записаното движение. Клиентът не избира друга сметка за reversal.
Current account може да е деактивирана; тя **не се активира**. Проверката използва
първоначално валидната запазена конфигурация, а не подменена текуща active проекция.

Изискват се текущите две права, причина и изрична дата: от датата на първичното
движение до текущата server дата Europe/Sofia включително. Няма подразбираща се дата.
Това е ограничение на техническия договор, не банков refund или счетоводна заверка.
Компенсиращият payment и движение, отрицателните coverage редове и историята се
запазват заедно. Оригиналите никога не се редактират/изтриват.

Replacement е **една атомарна корекция**: reversal, цяла компенсация, нов receipt
и ново inbound. Новото плащане изисква отделно избрана активна сметка/версия.
Ако account ID е различна, задължително се записва конкретно `account_change_reason`.
Не се пренасят allocations, не се подразбира трансфер и не се поправя банков баланс.
При отказ на който и да е етап няма частична компенсация или replacement.

## Server и API граница

`money_movements`: unique `payment_id`, unique `source_key='payment:<UUID>'`, unique
`reversal_of_id`; FK към payment, account-version и original movement/source.
INSERT guard сверява payment/scope/сума/метод/actor/config snapshot. UPDATE/DELETE са
забранени; SELECT е scoped RLS. Deferred completeness constraint отказва commit
на **всеки нов** payment без движение, включително accidental internal receipt-only write.

Public invoker RPC към private guarded операции с фиксиран search_path:

- `record_manual_payment_inbound(scope,account_id,account_revision,payload,request_key,note)`.
- `reverse_manual_payment_inbound(scope,target,expected_revision,compensation_date,request_key,note)`.
- `replace_manual_payment_inbound(scope,target,expected_revision,account_id,account_revision,compensation_date,account_change_reason,payload,request_key,note)`.
- `allocate_manual_payment(...)` остава съществуващият explicit coverage процес.
- `manual_payment_feed()` запазва старите полета и добавя `inbound_required`, scoped
  `cash_accounts` и immutable `movements` с точни decimal strings.

Старите `record_manual_payment`, `reverse_manual_payment`, `replace_manual_payment`
отказват нови writes с конкретно изискване за inbound API. Няма client DML или
достъпен receipt-only private обход. Предходното bookkeeping тяло е private,
с отнет client EXECUTE; новият RPC го използва вътрешно в същата транзакция.
Нова миграция преквалифицира неговата argument-name reference след преименуването;
предходните committed SQL файлове са непроменени.

Идемпотентност: same actor/request key + exact input връща същия резултат. Друг
account/revision/date/payload със същия key и stale inputs дават `PT409`/HTTP409.
Rights се проверяват и при replay. Не се обещава банково разпознаване на еднакви
реални транзакции, отчетени като нови записи с нови keys. SDK няма автоматичен retry.
При timeout първо се сверяват exact operation receipts/payment/movement IDs.

Lock order за inbound RPC: actor/payment key → scope charge-publication → scope
cash-account-configuration → target payment/movement/account rows. Allocation и unpaid
charge correction споделят charge-publication scope lock. Никаква allocation история
не се заличава: тя продължава да блокира unpaid full-batch charge correction,
включително след payment cancellation.


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

## Стари записи и съвместимост

Няма backfill, второ плащане или автоматично движение за предходни receipts.
Те остават четими, ясно означени като исторически записи без свързано постъпление;
не са доказана наличност. Explicit legacy allocation не добавя cash движение.
Legacy reversal/replacement без доказан original movement връща конкретно
`payment_legacy_transition_required`: не се измисля компенсация или баланс.

Контролираният преход е отделна стъпка: exact payment IDs и reversal chain, документ,
сметка/версия, дата/cutover, дублиране и opening coverage. Старите QA начисления и
синтетични плащания не стават реални клиентски наличности.

Текущият main/live не използва тези нови payment RPC. Основните му модули и старите
charge snapshots не се променят. Стар receipt-only feature frontend получава явен
отказ вместо тих account избор. Новият frontend изисква трите schema зависимости;
при непълна feed конфигурация показва техническа грешка и не предлага unsafe запис.

## Локално приемане

```powershell
npm.cmd run check:payment-inbound
npm.cmd run check:manual-payments
npm.cmd run check:payment-inbound-browser
```

14 нови domain/server/DB/RLS/upgrade групи, 11 засегнати manual-payment групи и
съвместимостта на account lifecycle са PASS. Проверени са принудителен posting
failure след payment insert и replacement failure след компенсацията: payment,
allocations, movement, receipts и audit се rollback-ват. Има canonical сравнение
с готовите `preparePaymentReceipt`/`preparePaymentCompensation`, без паралелна
JavaScript аритметика. Pure domain модулът остава непроменен; при compensation
получава точната историческа snapshot конфигурация.

Реален изолиран Vite/Edge/SDK/service/HTTP процес: explicit account → partial allocation
→ historical compensation след деактивиране → replacement към друга active account
с reason/date → cancellation; readonly/record-only/no-access, stale HTTP409 без retry,
375/1440 light/dark, reload/navigation и техническа грешка отделно от empty.
Транспортът използва local Auth/PGlite; това **не е hosted/MVCC доказателство**.

## Исторически pre-apply план и hashes — изпълнението е отчетено по-горе

Историческите предусловия са: отделно разрешение, fresh target `qfybswnezdzzahmozikr`, actual history (last
saved31), live compatibility и single expected ordered dry-run. LF SHA-256 включва
целия файл след CRLF→LF, без trim; старият manual LF-trim hash е запазен отделно.

| Ред | Миграция | LF SHA-256 |
|---|---|---|
| 1 | `20261104080554_manual_payment_allocations.sql` | `2b73ceb2f683594003c7d97375abad7a2f65eef66788b139ae0771f6f427e4b2` |
| 2 | `20261104110007_scoped_cash_accounts.sql` | `8d62ba590b6c1c970bf87e27b9e9c0c1539412446fd1d709c8de9cfb3ea6a4e0` |
| 3 | `20261104114357_payment_inbound_movements.sql` | `ef5895232c1b87830d07c4749760d7ae7079e77a1614e03b7e6cae8286821aa1` |

1. Pre-apply checkpoint/hash/history; exact apply само на липсващите кандидати в този
   ред; post-apply schema/grants/constraints проверка. Unknown result → inspect преди
   повторение. Без редакция на приложени миграции/история.
2. Недемо marker + manifest/baseline преди writes. Съществуващи ordinary QA sessions,
   минимални временни explicit rights. Separate registry/charges/accounts/receipts
   fixtures; persistent demo/лични записи и предходни snapshots са защитени.
3. Ordinary API: whole receipt/inbound, partial/full allocation и аванс; exact totals,
   scope/rights/config/method/currency, immutable versions, direct/old-path откази,
   same-key replay, stale409, same-JWT revoke. Success преди deny; конфигурационна
   грешка не е authorization PASS. Контролирано fault/rollback доказателство без
   промени на общи hosted функции или чужди ресурси.
4. Historical inactive compensation и new-account replacement с reason/date;
   duplicate reversal, stale revisions и no implicit allocations; legacy read и no
   automatic posting. Всяка операция запазва оригиналния и новите точни IDs.
5. Независими PostgreSQL holder/contender/observer connections, TLS с официалния CA,
   deadlines/finally. Всяка бариера се освобождава след **наблюдаван waiter**:
   same-key duplicate receipt; account edit/deactivate vs receipt; two allocations за
   един остатък; allocation vs reverse; duplicate reverse/replacement; payment/coverage
   vs unpaid full-batch charge correction. Допустим е сериализиран успех или конкретен
   своевременен конфликт, без double posting/overcoverage/orphans/mixed snapshot.
   Fake connections, произволна паралелност и PGlite не заменят тези проверки.
6. Тесен local frontend→hosted UI на отделен port/profile: същият процес и четимост,
   без user preview/demo. Статуси/IDs/headers са secret-safe; няма JWT/пароли в артефакти.
7. Reconcile exact receipts при прекъсване; не повтаряй unknown correction на сляпо.
   Cleanup оттегля само run assignments/връзки/sessions/transactions; финансовите
   postings, account versions, snapshots и audit се пазят в retained-ID manifest.
   Временните operator credentials се изчистват след употреба. Няма destructive
   „празна база“ cleanup или автоматичен legacy cutover.

[Manual договор](MANUAL_PAYMENTS.md) · [Сметки и права](CASH_ACCOUNTS.md) ·
[Setup](../../supabase/README.md)
