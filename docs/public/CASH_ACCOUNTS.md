# Парични сметки — DB-21

Локален кандидат, 04.11.2026. Конфигурация на каси и банкови сметки, отделна от
фондове, категории, наличности и плащания. Няма банкови интеграции или credentials.
Операторският setup не е нормалният клиентски процес.

## Права и назначаване

- `manage_cash_accounts`: отделно, изрично scoped право за manager/cashier.
  Каталожният role/permission pair не назначава никого автоматично.
- Настоящ org admin с `manage_members` назначава конкретния потвърден получател
  чрез съществуващия `assign_staff_role`, само в собствената активна организация
  и управляван scope. „Екип и права“ предлага account-only manager/cashier пакети.
  Съществуващо различно назначение не се разширява тихо: изисква изрично отнемане
  и ново назначение. Отнемането използва съществуващия защитен lifecycle.
- Четене: текущо `manage_cash_accounts`, `read_payments` или `record_payments`
  в същия scope. Последните две дават необходимия преглед на конфигурацията и
  историята, **без** управление на сметките.
- Admin роля, `read_rules`, owner достъп или `correct_finance` сами не дават достъп.
  Управлението на сметки не дава запис на плащания, начисления или регистър.
  Изричното съвместяване на роли следва съществуващия access договор; няма ново
  изискване за втори човек. Само scoped manager не може да си назначава права.

## Данни и неизменност

Създаване: изричен scope, вид `cash|bank`, име, EUR, предназначение и основание.
За банка са задължителни титуляр и банков реквизит според документа. За каса
банковите полета са null. Няма автоматичен избор по начина на плащане.

Име/титуляр/реквизит: до 160 знака; предназначение: до 500; причина: до 1000.
Allowlist отказва неизвестни полета, контролни символи и URL в банковите данни.
Това е структурна проверка на служебен текст, **не** проверка на IBAN, съществуване
на банка, право върху сметката, получени пари или нормативна пригодност за фонд.
Не се въвеждат пароли, tokens, API ключове или адреси за банков вход.

Идентичността (`id`, scope, вид, EUR, титуляр, реквизит, създател/дата) е неизменима
още от създаването. Контролираната редакция променя само име/предназначение с
причина и точна revision. Промяна на икономическата идентичност изисква нова
сметка и деактивиране на старата; не пренаписва историческия ID.

Всяка операция добавя неизменима версия и audit с actor, време, причина и
before/after. Деактивирането е еднопосочно, пази четенето/историята и не позволява
редакция или реактивиране. Няма DELETE. Локалният [inbound posting кандидат](PAYMENT_INBOUND.md)
атомарно отказва ново първично използване на неактивна сметка; историческата компенсация
остава по original account/version според отделно приетия договор.

## Server/API

Нова [миграция 20261104110007](../../supabase/migrations/20261104110007_scoped_cash_accounts.sql),
SHA-256 `8d62ba590b6c1c970bf87e27b9e9c0c1539412446fd1d709c8de9cfb3ea6a4e0`.
Тя е **неприложена**, не променя предходни SQL или payment/charge snapshots.

- `cash_account_feed()`: само текущите разрешени scopes, accounts и versions.
- `save_cash_account(scope,target,expected_revision,request_key,payload,note)`:
  target=null/revision=0 създава; иначе редактира label/purpose.
- `deactivate_cash_account(scope,target,expected_revision,request_key,note)`.

RLS дава само scoped SELECT; клиентският DML е забранен. Guarded RPC извежда actor,
време, identity/version/history и проверява текущото право. Actor/key receipt пази
exact replay; същият ключ с различен вход или stale revision връща `PT409`/HTTP409,
без автоматичен retry. Scope advisory lock и row lock ограничават конкурентните
редакции. Това не е доказателство за hosted MVCC до реалното приемане.

## Приемане и следваща зависимост

```powershell
npm.cmd run check:cash-accounts
npm.cmd run check:cash-accounts-browser
```

Осем локални domain/DB/RLS групи и реален изолиран Vite/Edge/service/SDK/HTTP
процес с disposable PGlite са проверени: разрешено управление, read-only,
admin/read_rules/owner отказ, чужд scope, невалидни данни, replay/stale,
неизменност, история, деактивиране и отнемане в същата симулирана сесия.
Браузърният набор включва изрично назначаване/отнемане, mobile/desktop,
две теми, reload/navigation и отделни loading/empty/no-access/no-context/error.
Това **не е hosted Auth/PostgreSQL/MVCC PASS**. Fixtures не използват постоянния demo.

Атомарната [payment↔movement интеграция](PAYMENT_INBOUND.md) вече е локален кандидат20261104114357. Новото първично постъпление изисква explicit ACTIVE account ID/version. Приетата пълна еднократна историческа compensation използва account ID/version/snapshot от original movement, включително след деактивиране, без activation; current record_payments+correct_finance и explicit date/reason. Replacement изисква отделно избрана ACTIVE account и конкретна причина при друга account ID, не трансфер/refund. Няма automatic backfill.

Общото бъдещо hosted приемане изисква fresh project/history/hash/dry-run и отделно
разрешение за apply. Първо manual payment `20261104080554`, после account config
`20261104110007`, после inbound20261104114357. И трите остават НЕПРИЛОЖЕНИ; [общият точен план и hashes](PAYMENT_INBOUND.md#общ-hostedmvcc-acceptance-план--не-е-изпълнен).
Проверяват се ordinary-session rights/UI, same-JWT revoke и независими PostgreSQL
sessions с наблюдавани waiters: edit/edit и edit/deactivate дават един допустим
резултат и stale409 без изгубена версия; posting/deactivate, duplicate receipt,
compensation/allocation и unpaid-correction races пазят точните суми/история.
Cleanup оттегля само собствените временни права/сесии; пази финансовите версии,
audit и отделните demo/лични записи. Няма hosted операции в текущия пакет.
