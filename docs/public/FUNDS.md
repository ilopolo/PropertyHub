# Фондове и аналитично отнасяне — P4a

## Статус

Ограничено **hosted API/UI/native PostgreSQL MVCC приемане PASS на05.11.2026** върху
финансовия draft PR #9. `20261104221711_scoped_fund_analytics.sql` е приложена точно
веднъж след fresh35-version preflight и exact single-candidate dry-run. Потвърдени са
36версии; P2 `20261104212948` остава неприложена и изисква отделен frontend cutover.
Frontend още не е в main/production. Предходните SQL и старите payment/charge/account
snapshots са неизменни. P4b има отделно ограничено hosted API/UI/MVCC приемане с 37 backend версии: [разходи](EXPENSES.md). P4a PASS не е използван като заместител на новия P4b gate.

## Приети права и граници

Изрични scoped `read_funds` за manager/cashier/controller и `manage_funds` за
manager/cashier; последното включва необходимата конфигурация, без платежни/разходни
права. Назначават се през съществуващия guarded org-admin assign/revoke процес,
проверени получател/организация/управляван scope и whitelist subset. Няма автоматично
предоставяне по role label или admin наследяване. Добавени са само отделните
фондови пакети в „Екип и права“; няма нов общ редактор на финансови права.

Отнасяне на existing inbound изисква текущо `record_payments`; аналитична корекция и
пълна компенсация — също `correct_finance`. Минималният фондов selector за операцията
не дава общ фондов history SELECT. Контрольорът с read-only право не записва.
`manage_funds` не дава cash-account/payment/expense SELECT или posting. P4a не добавя
планираните `read_expenses`/`record_expenses` права от бъдещия разходен пакет.

## Конфигурация

Устойчиви id/scope/code/kind/EUR; label/purpose/basis reference, изрично account
ограничение и точна версия, reason/revision/history и деактивиране без изтриване.
Техническите kind стойности `general` и `repair_renewal` обозначават конфигурационното
ограничение, не правна квалификация на произволен ремонт или нов глобален каталог.
General допуска изрично „без ограничение до една сметка“ в EUR/scope; изборът не се
прави автоматично. Repair/renewal изисква конкретна банкова сметка/версия и основание.
Използват се съществуващите immutable account identity/versions.

Проверяват се текущи права, формат, scope/EUR/bank type/current config и източникови
референции. Това **не доказва** банков титуляр, специално предназначение, наличност
или законосъобразно решение; съответните доказателства/приложимост се установяват от
оправомощения представител. Празно основание отказва; при неуточнено предназначение
постъплението остава неотнесено. Фондът, сметката, категорията и бюджетът са различни.

`funds` пази текуща revision; `fund_versions` е immutable history. Промяна на основание/
account restriction създава версия с причина; не пренасочва стари движения. Един scoped
code е постоянен; повторно създаване с друг ключ отказва HTTP409. Деактивирането е
еднопосочно, без reactivate/delete на използвана идентичност.

## Цялостна аналитичност

`fund_classifications` и `fund_movement_lines` пазят immutable версии на цялата
разбивка. Източникът е server-derived `money_movements`: id/scope/положителна точна
сума/EUR/direction/date и исторически account id/revision. Client payload е само
`scope,movement,expected_revision,request_key,lines,note`, без доверен actor, payment
snapshot, оригинална сума, payer или избран длъжник. Всяка line има exact fund id/
revision и положителна EUR string сума; duplicate fund/mismatch/partial сбор отказват.

Една текуща потвърдена версия; sum(lines)=movement.amount. Direction дава знака.
Точните helpers `paymentAmount`/`moneyClaim` и BigInt се използват повторно; няма float
междинни изчисления. Нов набор заменя аналитичната версия с immutable previous link,
без нови пари или редакция на личните allocations. Каса/банка и фонд не се сумират.

100 EUR receipt с лично покритие80 и неразнесени20 може изрично да има fund60+40;
сборът е100, не80 и не120. Това не приписва личен beneficiary на аванс. Без пълен
разрез и opening данни UI не твърди пълен фондов баланс/средства за харчене. Липсата е
видима „Неразпределено по фонд“, без частично потвърдена версия или фиктивен фонд.
Няма задължителен нов fund selector при всяко payment create или автоматичен backfill.

## Компенсация и конкуренция

Нов AFTER INSERT trigger върху immutable money-movement boundary обхваща успешните
`payment_reversal` записи от всички съществуващи guarded correction пътища. В същата
транзакция се фиксира exact действащата потвърдена версия на оригинала и се създава
linked mirror към съществуващото out движение. Копират се само server-derived суми/
фондове/версии; деактивиран фонд не се активира и не блокира историческата компенсация.
При отказ на mirror целият payment/reversal/allocations пакет се връща назад.

Original без аналитичност няма измислен mirror. Replacement остава неотнесен до нов
изричен набор. След compensation original не допуска ново отнасяне/самостоятелна
аналитична корекция. Отменената двойка няма положителен текущ паричен ефект; датите,
историческите signed flows и старите версии се пазят. Няма допълнително движение,
фондов трансфер или банков refund.

Операциите използват съществуващите scope `charge-publication` →
`cash-account-configuration` locks, после `fund-configuration`, и current source/
version проверки след locks. Конфигурацията използва съвместимия cash→fund ред.
Exact request receipts, canonical UUID-ordered lines и unique movement/revision,
classification/fund и mirror links пазят повторенията. Different-key повторение на
същата непосредствена бизнес операция връща същия набор; stale/different payload е
PT409/HTTP409. Няма SQLSTATE40001 за приложни откази или автоматични retries.

Public invoker wrappers → guarded private functions с празен search_path; auth-only
EXECUTE, RLS/SELECT-only tables, no client DML, immutable histories и deferred whole-
split constraints. Trigger helpers не са пряко изпълними от authenticated/anon.
Feed връща минимални movement полета без payment receipt/payer/bank reference;
bank selector е само id/label/type/currency/revision/status в разрешения scope.

## Локални доказателства и ограничения

- 13 DB/domain/RLS групи: точен сбор, strict input и чужди реално съществуващи scope/
  source/fund откази, full rollback, pinning/history/replay/stale, readonly/revocation,
  inactive fund mirror, unclassified original/replacement и historical-account reversal.
  Charge/party snapshots остават непроменени. Проверена е и standalone миграция след
  старите35версии **без P2**, unchanged pre-existing receipt и no automatic backfill.
- 9 real local frontend/service групи през Vite/Edge/SDK/HTTP с disposable PGlite и
  simulated Auth: роли/навигация, create/edit/split/correct, actual payment reversal UI
  и автоматично показване на mirror, HTTP409, error/empty/no-right/no-context/loading,
  same unchanged local JWT revoke, explicit org-admin assignment и reload.
- Четири реални375/1440 light/dark screenshots са визуално прегледани. Изолиран build
  и production navigation за11HTML/routes/assets преминаха. QA използва собствени5187/
  54347, временен4179, browser contexts/cache/build; всички са затворени.

Това **не е hosted Auth/RLS или native PostgreSQL/MVCC PASS**. Логическите последователни
подреждания/PGlite не доказват конкурентно изчакване. Старите финансови/Storage/signal
набори не са повторени; само необходимата засегната payment-compensation regression.
Preview4173, PH-DEMO-V1 и личните записи/credentials не са засягани.

## Ограничено hosted приемане — 05.11.2026

- Шест ordinary-JWT API групи и14целеви отказа: изрични права без admin наследяване,
  minimal read без receipt/payer, foreign scope/direct DML/spoof и невалидни версии,
  exact100=60+40 при80personal allocation+20unallocated, immutable correction50+50,
  replay/business duplicate/stale HTTP409 и same-JWT revoke. Не се прави второ движение.
- Осем native случая с независими PostgreSQL holder/contender/observer и наблюдаван
  waiter преди release: classify/reversal и analytic-correction/reversal в двете
  подреждания, deactivate/classify в двете подреждания, same-key и different-key duplicate.
  Крайните committed revisions/суми/огледала са проверени без double/partial records.
- Реален отделен local frontend→hosted UI: фондcreate/edit/history, whole2.00split,
  correction1.25+0.75, same-JWT revoke, inactive-fund compensation и exact mirror.
  Четири375/1440light/dark снимки са визуално прегледани; user preview/demo са запазени.
- Actual cleanup:20own фонда и2сметки архивирани,5временни роли оттеглени, точната
  membership възстановена,14own сесии затворени и0native връзки оставени. Baseline
  hashes на старите профили/права/scopes/финансови snapshots/версии и7Auth акаунта
  съвпадат. Временните CLI token/DB URI са изчистени. Няма нови Auth акаунти/DB роли.
- Запазени маркирани синтетични23payments/23movements/2allocations/18classification
  версии, включително6mirrors:7active receipts,8reversed originals и8reversal records.
  Това не са реални клиентски пари, банкови потвърждения или фондов баланс. Exact IDs,
  status/receipts/baseline са в частния run manifest и не се публикуват.

Forced mirror-trigger failure остава **local-only**, без fault injection в hosted.
Hosted line-guard refusal е проверен без частичен classification. P2 missing endpoint
и старият charge-feed fallback не са обща регресия или P4a PASS за други модули.
Плащания/сметки/FND-F05 старите набори не са повторени. P4b има отделно ограничено hosted
приемане; това не е завършен финансов MVP. [Release инструкции](../../supabase/README.md#p4a-funds-hosted).
