# Създаване на сигнал и ticket-only контекст — P2

## Междинен release review, 06.11.2026

Пред-CALC кандидатът `b47ad97` е проверен в отделен release worktree. Повторени са само
тесните P2 интеграции:10 DB/RLS и9 localhost UI/service групи,375/1440 в двете теми,
осем визуално прегледани снимки. Production-chunk smoke допълнително доказва P2 create
и празен ticket-only context заедно с P1/financial read екрани; това е local HTTP/PGlite
със simulated Auth, **не hosted приемане**. P2 остава неприложена до съгласувания
[frontend cutover](../../supabase/README.md#interim-finance-p2-release).

Browser runner-ът използва изрично отделни5187/54366, със забрана за4173/5173.
Локалният HTTP bridge обслужва QA-origin CORS, а pure download handler се извиква без
Origin само в тази bounded attachment проверка. Production Edge/CORS кодът е непроменен;
неговото hosted приемане се пази и не се твърди, че този localhost smoke го повтаря.
Release QA dist използва synthetic public localhost config и не е artifact за deploy.

## Договор преди DDL, 04.11.2026

PR #8 е dependency: exact `4e0e37efbbb223b97ed8ccf9542ecf199de7f65d` е включен чрез
нормален merge `e9a5f29`, с двата parent-а и без промяна на PR8/main. Приетите девет
category codes/BG labels, staff редакция с причина/revision/history и assignee guards
се използват повторно. `20261102080729` е непроменена и вече е приложена; не се дублира.

Потребителско решение: **категорията е задължителна за всеки нов owner сигнал**.
Няма автоматичен избор, свободен текст или нов каталог; „Друго“ е допустима категория.
Старите NULL категории и история остават непроменени. Staff може да коригира/изчисти
категорията на съществуващ сигнал по непроменения PR8 договор с причина и история.

`create_ticket(unit,title,description,category)` извежда caller/scope/current owned unit
със съществуващия owner guard; няма вход за author/status/scope/assignee. Категорията
се сверява с приетия DB allowlist. Един атомарен запис създава ticket+category, created
event с фиксираната начална категория и audit; status=new/revision1/assignee=NULL са
server-derived. При отказ няма частичен ticket/event/audit. Не се променят старите SQL.

Старият триточков RPC без category трябва да отказва, за да няма bypass на задължителния
избор. **Това променя create съвместимостта с main/live b5d9409**: бъдещият hosted apply
не бива да се изпълнява изолирано преди съгласуван frontend cutover/обновяване на старите
клиенти. Read/status/handling/attachment договорите остават; текущият пакет е само локален.
Точният hosted/release compatibility gate се записва след приемането, не се скрива като PASS.

`ticket_contexts()` връща само `{scope_id,scope_label}` за текущо изрично `manage_tickets`
чрез каноничния permission guard (profile/Auth,role/member/org/assignment/scope/periods).
Не изисква registry SELECT, ticket, assignee или owner link. Няма нови права/политики,
адреси, unit/person/staff каталог. Public invoker→guarded private projection, auth-only.
Навигацията използва свежата проекция, а не кеширани роли/стар ticket. При revoke новата
заявка връща без контекст; запазен UI избор не дава право. Owner контекстите са отделно
разрешените `my_owned_units`; директните RPC/RLS продължават да са защита.

UI различава loading, empty в разрешен scope, no-access/неразрешен запазен контекст,
signed-out и техническа грешка. Грешка/липсваща схема не е empty или authorization PASS.
Няма задачи/известия или промяна на финансовия договор. Local/mock/PGlite не е hosted PASS.

## Локално приемане

Нова **неприложена** `20261104212948_owner_ticket_category_contexts.sql`, SHA-256
`1048e7f5fd9d9fe92c7c5ca6a707e8c4af4623e8a7d2c690b3cd5f46df6b396d`.
Предходните SQL, включително exact PR8 версията, са непроменени.

- `npm run check:ticket-creation-db`:10 domain/DB/RLS групи PASS —9 категории/explicit
  choice, legacy NULL/events, atomic success/forced rollback, author/unit/status/scope
  spoof/direct DML, staff reason/history/PT409, empty ticket-only projection/registry
  изолация и same-session role/context revocation. Stale ticket rows/roles не дават nav право.
- `npm run check:ticket-creation-browser`:9 тесни UI/service групи PASS през реални
  Vite/Edge/SDK/HTTP и disposable PGlite със симулиран Auth: pure owner/staff/combined/
  platform-only, navigation/reload, required selection, server denials, history, loading/
  empty/no-access/error/malformed-response и8 прегледани375/1440 light/dark снимки.
- Засегната PR8 regression:4 DB/RLS и3 service групи PASS. Един attachment smoke само
  към нов categorized ticket: upload/download със същите bytes/hash и remove до0objects,
  с retained tombstone в disposable DB. Пълните attachment/financial набори не са повторени.
- QAfrontend е на свободния позволен origin5173 с strictPort и собствен browser/cache;
  API54346. Първият избор5186 правилно беше отказан от съществуващия download CORS guard;
  handler/CORS не са променяни и този configuration отказ не е authorization PASS.
  User preview4173/root37f00c8/demo/лични данни/credentials не са засягани. OwnQA е затворен.

Историческите category-less fixture tickets се създават ПРЕДИ локалния cutover и после
се прилага candidate; няма direct seed bypass след него. Старите signal checks са
адаптирани за explicit category/новия import, без повторение на техните пълни набори.
PGlite/локалната HTTP паралелност не доказват hosted PostgreSQL/MVCC. Няма hosted P2 PASS.

## Бъдещо hosted приемане и release gate

1. Първо **изрично договорен cutover за category-less live клиента**: main/liveb5d9409
   изпраща3аргумента. След този candidate такава create заявка отказва23514, докато
   новият frontend трябва да изпраща изрична category. Няма съвместим fallback с автоматична
   категория. **Standalone hosted apply е блокиран до съгласуван frontend cutover/прозорец**;
   не прилагай candidate само за тестове върху общия backend с действащия стар клиент.
   Тази задача не разрешава deploy или нов staging project/hosting/config/secrets промяна.
2. При отделно разрешение: fresh project/history/hash/dependencies и candidate absence;
   backend последно35applied, localbranch следPR8 има35old+1pendingSQL. Exact dry-run само
   с20261104212948; **без повторно apply на PR8/P1**. Pre-apply checkpoint; при unknown
   outcome първо actual inspect/history/function body/grants, без blind retry.
3. Нов marked NONDEMO baseline/manifest с exact existing synthetic auth IDs, own scope,
   current owner link и ticket-only role безread_registry. Не се ползва PH-DEMO-V1/личен
   акаунт за mutations/revocation. Journal intention преди write и exact receipts след него.
4. Ordinary JWT/API:9categories, empty/unknown/legacy/spoof/foreign denials с unchanged
   ticket/event/audit counts; creation category+snapshot, old NULL rows unchanged; staff
   reason/revision/history; minimal context keys,0tickets/0registry SELECT; same-JWT revoke
   връща без контекст и не позволява write. Config/missing-schema refusal не е deny PASS.
   Тесен localfrontend→hosted UI по приетия cutover план; no-access≠empty≠error, reload.
   Старите financial/Auth/Storage/signal/MVCC набори не се рестартират без засегната промяна.
5. Cleanup само на exact run-owned roles/links/sessions и временно активиран контекст до
   baseline. Сигналната/handling/audit история се пази с marker/IDs; ако има smoke файл,
   bytes се премахват чрез guarded flow с retained tombstone. Protected baseline се сравнява;
   own connections се затварят, временните operator credentials се изчистват. Няма тих SQL
   backfill, destructive cleanup или редакция на приложен migration при дефект.

Изолиран production build в .local/p2-qa/dist и navigation на собствен4179:
PASS за11HTML страници/linked routes/assets, без вътрешни директории в bundle.
npm ci не е повторено: dependency tree не е променено и shared node_modules не се
подменя, за да се запази user preview4173.
