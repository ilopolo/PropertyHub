# Разходен документ и отчетено изходящо плащане — P4b

## Статус

P4b има ограничено **hosted API/UI/native PostgreSQL MVCC приемане PASS на 05.11.2026**. Exact `20261105094824_expense_outbound.sql` е приложена еднократно след fresh36-version preflight и изолиран single-candidate dry-run; SHA256 `41808df5ade89a89ecb6c4ed873170f5f95e4c3b6ce22698ebcef1de7f7cef78`. Actual post-apply/final history е **37 версии**, без P2 `20261104212948`. Предходните SQL не са редактирани. Frontend е draft PR #9, извън main/production; main/live остава b5d9409, PR #8 отделен/unmerged.

Доказани са 8 P4b ordinary-JWT API групи, 2 setup/rights проверки и 1 тясна source/account regression група, с 22 очаквани отказа; 11 native случая с независими holder/contender/observer връзки и наблюдаван waiter **преди** освобождаване на бариерата; реален отделен frontend→hosted UI и четири визуално прегледани 375/1440 light/dark снимки. Предходните 15 DB/domain/RLS и 9 локални UI/service групи са запазени без повторение. Local/PGlite/simulated Auth не са използвани като native MVCC доказателство.

Exact cleanup и отделна read-only baseline сверка са PASS: 5 собствени сметки и 5 фонда са деактивирани със запазени версии; 6 временни роли са оттеглени, точната B membership е възстановена, 17 собствени Auth сесии са затворени и няма останали native връзки. Старите payment/charge/party/account/fund snapshots, allocations, PH-DEMO-V1, личните записи и 7-те Auth акаунта са запазени. Временните operator CLI token/DB URI са изчистени; ordinary QA credentials не са променяни.

Запазени са ясно маркирани синтетични 13 документа/15 версии, 21 settlement/reversal записа, 21 движения, 21 фондови набора/25 линии и 7 огледала. Статуси: 7 действащи settlements, 7 компенсирани originals и 7 reversal записа. Това не са реални клиентски пари или банкови операции; exact IDs/receipts/statuses са в частния run manifest и не се публикуват.

Attachment остава изрично непокрита MVP подстъпка; metadata/reference не доказва качен/проверен файл. Няма банков превод/refund, начални салда, доказан пълен account/fund баланс или завършен financial MVP. Изкуствен trigger fault не е инжектиран в shared DB; fault-injection границата остава local-only. P2 е отделен неприложен frontend-cutover blocker и задължителната категория не е отслабена. Няма merge, deployment или Netlify проверка.

Документът, изходящото плащане, паричната сметка, фондовата аналитичност и файлът са
различни понятия. Регистрирането не извършва банков превод и не доказва наличност.

`read_expenses` е изрично scoped четене за manager/cashier/controller.
`record_expenses` е изрично manager/cashier право за документ и плащане, включващо
необходимото четене. Корекция изисква и `correct_finance`. Existing guarded org-admin
assign/revoke се използва без автоматично наследяване или ново изискване за втори човек.
Тези права не дават управление на сметки/фондове или четене на входящи платежни записи.

Документ: supplier_label≤160, document_number≤120 илиNULL, document_date,
amount като положителна точна EUR string, category_label≤160, description≤1000,
source_reference≤500 иbasis_reference≤1000. Category label се въвежда изрично и не е
каталог/формула. Референцията не означава качен/проверен файл; attachment е отделна
непокрита MVP подстъпка, без unit/ticket Storage/Edge достъп.

Current document revision и settlement revision са отделни. Неплатеният документ
няма движение. След reason/exact revisions корекция създава immutable version само
при net paid0; проверката е атомарна спрямо плащане. Историческите платени версии не
се презаписват. Доставчикът/expense snapshot за плащане се извеждат сървърно.

Плащане: положителна exact EUR amount, paid_on≤server Europe/Sofia day, изричен
cash/bank method, payment_reference≤120, active scoped EUR account/current revision
и нов explicit whole fund split. Частично/пълно плащане не надхвърля current remaining.
Payment reference идентифицира отчетената операция в документа; повторното ѝ подаване
не създава второ плащане. Няма автоматична сметка/фонд, нормализация или начисление.

Еднократна пълна компенсация: current record_expenses+correct_finance, exact original,
date/reason. Server-derived amount/account-version/original fund lines, включително
inactive configurations; без активиране и client override. Възстановява document
remaining точно веднъж. Огледалото е отчетна корекция, не банков refund или наличност.
Reversal+replacement е една транзакция; replacement избира active account и нови
fund lines изрично, с конкретна причина при друга сметка. Няма частично сторно.

RPC няма actor/payee/source snapshot параметри. Current permissions се проверяват
преди replay и след locks. Exact request receipts и business identity/revisions
отказват конфликти с PT409/HTTP409, без40001 или скрити retries. Scope lock редът е
charge-publication →cash-account-configuration →fund-configuration →expense row.
Един payment има едно movement и цял immutable fund set в същата транзакция.

Прегледът показва „Документ“, „Платено“, „Остава“, версии/история и отделните дати.
Няма as-of/fund balance engine: inbound аналитичност и липсващи начални данни не са
доказани налични средства. Разход от събран фонд не създава повторно лично начисление.

## Server операции

`expense_feed()` извежда само текущите разрешени expense scopes, документи/версии,
settlements/компенсации и минималните account/fund selectors за записващия.
`save_expense` получава scope/target, очаквани document/settlement revisions,
request_key, document payload и причина. `pay_expense` добавя изрични account id/revision
и whole fund lines. `reverse_expense_payment` получава exact settlement target,
очаквани payment/settlement revisions, compensation_date, request_key и причина.
`replace_expense_payment` добавя нов payment payload, изрична active account selection,
нов whole split и account_change_reason при друга сметка. Сървърът не приема trusted
actor, supplier snapshot или original amount/account/fund lines от клиента.

Same-key retry с променено намерение отказва; exact pay business retry с нов key не
създава второ плащане. Нов документ с нов key не се слива тихо със сходен документ:
UI предупреждава за еднакви доставчик/номер/дата/сума, а операторът сверява източника.

## Локално приемане и граници

Проверки: `npm run check:expenses` (15 групи) и `npm run check:expenses-browser` (9 групи). Отделните синтетични fixtures проверяват права/изолация/direct DML, точни суми, partial/full, rollback на невалиден split и atomic replacement, inactive historical compensation, непроменени версии, replay/stale, same-session revoke и standalone прилагане без P2. Тясната засегната regression покрива incoming receipt/classification/mirror/feed и липса на outgoing classification editor; пълните стари набори не са повторени.

Реалният браузър ползва SDK/service/controller и локален HTTP→PGlite adapter със simulated Auth, без hosted сесии. UI показва конкретни loading/no-access/no-context/empty/error състояния; разрешената workspace навигация включва „Разходи“. Корекцията на document е недостъпна при действащо платено покритие.

Attachment е изрично непокрита MVP подстъпка: пазят се данни/референция, без качен/проверен файл или нов Storage/Edge достъп. Няма банков превод/refund, ново начисление, начални салда, доказана наличност, пълен фондов баланс или отчети. Старите SQL, payment/charge snapshots, allocations и демото не се променят; няма автоматичен backfill.

## Запазен acceptance план — изпълнен в ограничения обхват по-горе

Това е история на изпълнените фази, не команда за повторен apply/setup. При бъдещ дефект в applied SQL се подготвя нова локална коригираща миграция; hosted apply изисква отделно изрично разрешение.

1. Отделно разрешен fresh read-only preflight за qfybswnezdzzahmozikr: действителни history/schema/grants, dependency/source SHA256 и live-client compatibility. Изолиран CLI workdir пази точните вече приложени SQL копия + единствен P4b кандидат; P2 е изключена без преименуване/редакция. Само успешен exact dry-run позволява поискано отделно apply. При неизвестен резултат inspect/history преди retry.
2. Fresh baseline на защитените PH-DEMO-V1/лични/Auth/исторически charge/payment/account/fund snapshots; отделен маркиран недемо scope, без чужд active run. Съществуващи QA акаунти, минимални временни приложни права, записани exact IDs/предходни състояния/намерение преди write. Без нови DB GRANT/роли/Auth акаунти. Credentials само наличие/един grouped request, проверен TLS с официалния CA, без secret изход.
3. Ordinary JWT/API: read/record/correct subsets, no admin inheritance, чужд scope/direct DML/helper отказ, metadata-only unpaid document/no movement, partial/full exact remaining, whole split, spoof/invalid versions/account/fund/replay/business duplicate/stale409; inactive historical compensation once, atomic replacement с нов explicit split/active account/reason при друга сметка, immutable versions и same-JWT revoke. Проверка, че incoming receipts/charge snapshots и allocations не са променени. Forced internal-trigger failure остава само local; не инжектирай дефект в shared DB.
4. Native независими PG holder/contender/observer, контролирана бариера + наблюдаван waiter ПРЕДИ release, deadlines/finally само за собствени транзакции: document edit/payment в двете подреждания; account deactivate/payment и fund deactivate/payment в двете; competing partials с общо над остатъка; same-key/different-key duplicate; reverse/reverse и reverse/replace. След commit провери точните document/settlement revisions, нетно покритие/остатък, unique payment↔movement, whole fund set/mirror и липса на double/partial records. Допустимо е валидно сериализиране или PT409; локалните stale-order tests не са този PASS.
5. Тесен ordinary frontend→hosted UI на отделен QA port/profile/build: document→partial/full→history→historical compensation/explicit replacement, read-only/revoke и error≠empty; 375/1440, две теми, визуален преглед. Пази preview4173/37f00c8 и PH-DEMO-V1.
6. Exact own cleanup по run receipts: оттегля само временните назначения/връзки и собствени сесии, връща разрешените baseline състояния, деактивира само собствените run конфигурации със запазени версии. Пази expenses/versions/settlements/movements/fund lines/audit; опиши retained IDs и effective/reversed/reversal/replacement статуси. Actual inspect потвърждава baseline и cleanup; unknown operation/cleanup остава blocked до inspect, не се повтаря сляпо. Изчисти временните operator token/URI. Без destructive history cleanup.

## Native и UI доказателства

Native случаите покриват same-key и different-key duplicate posting, конкуриращи се частични плащания, document correction/payment в двете подреждания, account и fund deactivation/posting в двете подреждания, reverse/reverse и reverse/replace. Проверени са committed revisions, exact paid/remaining, уникално settlement↔movement, whole fund sets/mirrors и липса на двойни/частични записи. Старите P4a/payment race набори не са повторени.

UI изпълни документ20.00 → partial8.00 (5+3 фонда)/остатък12.00 → historical compensation след деактивирани account/fund → ново6.00 → atomic explicit replacement5.00/остатък15.00, история и same-JWT revoke. При screenshot/reload пауза първо са сверени exact server receipts; продължен е само read-only визуалният преглед. Няма повторно плащане или продуктова SQL поправка.

Историческият локален checkpoint: P4b е локално реализиран и приет на 05.11.2026: 15 DB/domain/RLS и 9 реални UI/service групи PASS, четири визуално прегледани 375/1440 light/dark снимки, изолиран offline npm ci, build и navigation (11 HTML входа) PASS. Disposable PGlite/simulated Auth и localhost HTTP не са hosted/native PostgreSQL MVCC доказателство. Нова НЕПРИЛОЖЕНА `20261105094824_expense_outbound.sql`, SHA256 `41808df5ade89a89ecb6c4ed873170f5f95e4c3b6ce22698ebcef1de7f7cef78`. Последното запазено hosted доказателство остава 36 версии; не е fresh preflight. P2 20261104212948 остава неприложен отделен frontend-cutover blocker. Main/live b5d9409; PR8 отделен/unmerged; P4b е в draft PR9, извън production.
