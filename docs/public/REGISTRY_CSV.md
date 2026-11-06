# CSV обекти — ограничен P6a

Пакетът е в отделен feature клон, зависим от финансовия клон. Ограниченото
**corrective hosted/API/native PostgreSQL/UI приемане е PASS, 06.11.2026**.
Първоначалният FAIL и последващите локални проверки са запазени по-долу като история.
Няма production приемане, merge или deployment на P6a.

Точната `20261106170356_registry_units_csv.sql` е приложена еднократно след свежа
38-version история и single-candidate dry-run. След отделно разрешения corrective
single-candidate apply са потвърдени **40** версии, точните function bodies/volatility,
RLS/grants и непроменени съществуващи клиентски функции. P2 е applied; CALC-04 е
изключен и остава неприложен, блокиран от октомврийския fixture. CSV не решава този blocker.

## Текущо corrective hosted приемане

Свежата история съдържа точно 39 приложени версии преди корекцията. Изолираната
CLI история включва тези точни файлове плюс единствен кандидат
`20261106185945_registry_csv_current_rights.sql`, SHA256
`7d4cc5204d7c58812a6413fdafb386acb3e51149fe1a21f47a99e7e607c78623`.
Dry-run показва само него; apply е еднократен. Отделен read-only inspect потвърждава
40 версии, exact private function bodies, `VOLATILE` live-time guard и непроменени
public signatures/grants/RLS. Няма нови DB роли/допълнителни GRANT или Auth акаунти.
Предишните read-only връзки са проверени по точните run идентификатори и липсват.

Пет ordinary-JWT групи са PASS: липса на admin inheritance и четири тесни групи за
разрешени stage/commit/идентично повторение, prepare+read и commit+manage зависимости,
same-JWT revoke на replay/detail и export+read/revoke. Старият цялостен API набор не
е повторен. Четири native случая използват независими holder/contender/observer:

| Случай | Доказан ред и committed резултат |
|---|---|
| Waiting commit + revoke | Contender чака точния job row lock; независим ordinary-JWT revoke commit-ва; observer вижда отнетото право и все още блокирания contender; след release — `42501 / registry_csv_commit_revoked`, job остава ready/revision 1 без commit receipt и без units/periods/links |
| Staging replay + revoke | Ordinary holder държи точния actor/request advisory lock чрез replay; след committed revoke observer още вижда waiter; след release — `42501 / registry_csv_prepare_revoked`, без връщане на защитения payload, втори job или domain записи |
| Waiting commit със запазени права | Същият job barrier, разрешен commit и точно едно създаване; идентично повторение връща същия committed receipt |
| Staging replay със запазени права | Наблюдаван advisory waiter; еднакъв разрешен резултат след release, без нови domain записи |

Job бариерата е само `SELECT FOR UPDATE` върху собствения маркиран staged job чрез
наличната operator връзка; contender и revoke са с ordinary-session права. Няма
директен domain DML или промяна на права заради теста. Един по-ранен QA опит със scope
бариера блокира revoke audit FK и изтича по timeout; exact read-only reconciliation
потвърждава rollback на holder/contender/revoke и липса на частични записи преди
новия опит. Той не е отчетен като продуктова FAIL или native PASS. Старите осем
native PASS случая не са повторени. Двете реални корекции вече имат native доказателство.

Отделен изолиран build/Edge profile на QA порт изпълнява реален local frontend →
hosted backend: шаблон, грешки в невалиден CSV без загуба на файла, валиден preview,
изричен commit, inspect/reload, export и role/revoke UI. Проверени са действителните
download bytes за UTF-8/BOM, BG текст, quoting и embedded newlines. Отделен raw-input
fixture доказва, че базата и server projection съдържат `=…`, а сваленият CSV добавя
защитния апостроф; предварително sanitised input не се приема за това доказателство.
Прегледани са осем актуални screenshots: 375/1440 px, светла/тъмна тема, четима
хоризонтално превъртаща се preview таблица, без page overflow. Това не е production UI.

Cleanup е потвърден с отделна read-only сверка: 10 собствени назначения са оттеглени,
11 собствени сесии са затворени, няма останали собствени native връзки, membership
baseline е възстановен, protected records и 7 Auth акаунта са непроменени. Новият run
пази **6 units/6 периода/6 external links, 10 jobs (5 committed, 4 ready, 1 invalid),
12 import rows и 41 audit записа**. Exact IDs/statuses са в игнорирания journal.
Units остават маркирани active/needs_review; няма guarded archive_unit и не е
използван direct-SQL lifecycle обход. Временните operator credentials са изчистени.
Старият run cleanup не е повторен; PH-DEMO-V1, лични записи, CALC bindings и preview4173
са запазени. Няма Netlify проверка, merge или deployment.

## История на двата проблема и корекцията

Независими holder/contender/observer сесии доказват: holder прави scoped staging
и отнема точното временно B назначение в една транзакция; B commit чака scope lock;
observer вижда holder като blocker; holder commit освобождава бариерата. B заявката
не отказва с очакваното `42501 / registry_csv_commit_revoked`, а създава един обект
и exact receipt. Последващата read-only сверка потвърждава committed job/unit/link
и отнетото право. Няма сляпо повторение или изтриване на този резултат.

Причината е употребата на transaction-stable `now()` в общия scoped predicate:
изтекъл след началото на чакащата транзакция grant още изглежда валиден спрямо
нейния начален момент. [PostgreSQL current-time semantics](https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT)
и [function snapshot semantics](https://www.postgresql.org/docs/current/xfunc-volatility.html)
подкрепят локалното възпроизвеждане на проблема.

**Приложена точна корекция след отделно разрешение:**
`20261106185945_registry_csv_current_rights.sql`, LF SHA256
`7d4cc5204d7c58812a6413fdafb386acb3e51149fe1a21f47a99e7e607c78623`.
Завършилата read-only hosted сверка потвърждава 39 версии и отсъствие на тази
миграция **преди** редакцията ѝ; новият run я прилага еднократно с окончателния hash.
Зависимостите са приложената първоначална P6a
миграция и съществуващите registry/access функции. CALC остава изключен.
Разрешението за предишния hash `8152525c…acf8` **не важи** за променения кандидат.

Корекцията добавя затворен private live-time predicate само за CSV stage/commit
проверките преди/след locks. `VOLATILE` PL/pgSQL helper получава нов snapshot за
своя SELECT и сравнява правата с действителен `clock_timestamp()` при всяко извикване;
самото повторение на стария transaction-clock helper не решава проблема.
Не променя общия финансов/registry guard, публичните RPC подписи, права, snapshots
или вече приложен SQL. Няма директен authenticated/anon EXECUTE на новия helper.
Отделно е установен **локален staging replay пропуск** в първия вариант на
корекцията: след advisory wait съществуващият job се връща преди post-scope guard.
Контролирана локална проба с реалния predicate и изтичане на правото след entry
проверките връща job при вече false live permission; new-job контролата отказва.
Това не е hosted/native MVCC доказателство за втория проблем.

Окончателният кандидат проверява prepare+read отново **веднага след advisory lock**,
преди replay return и request-mismatch branch. Новият staging път пази и проверката
след scope lock. Commit проверява след advisory/job/scope locks преди връщане на
committed receipt, stale/conflict откази и всички записи. Read-only staging
list/detail/request и export остават с текущите си explicit права; signatures,
grants и RLS са неизменени. Не се прави общ access refactor.

Локално са PASS: 8 wait-exit групи за разрешени/отказани replay, mismatch, нов
staging и commit; 4 current-rights групи за стария clock дефект/helper ACL; 13
засегнати P6a DB/RLS групи. Локалните expiry hooks са само в disposable fixture,
без реални независими сесии или наблюдаван waiter. Това **не е** hosted/MVCC PASS.

Cleanup на **първоначалния FAIL run** е PASS с отделна read-only проверка: 9 временни назначения са оттеглени,
6 собствени сесии са затворени, защитеният baseline и 7 Auth акаунта са непроменени.
Запазени са 14 ясно маркирани synthetic units/14 текущи периода, 11 external links
и 26 import jobs (12 committed, 8 ready, 6 invalid), плюс audit историята. Няма
защитен unit archive RPC; обектите остават active, без direct-SQL lifecycle обход.
Exact IDs/receipts са само в игнорирания run journal. Временните operator credentials
са изчистени. PH-DEMO-V1, личните записи и preview4173 са запазени.

Предходното read-only corrective продължение е спряно **преди apply** при локалния review. Read-only
сверката е завършила, клиентският процес е приключил след rollback/end; няма отделен
по-късен server-observer receipt за връзката. Няма нов setup, application записи,
назначения или Auth сесии. Предоставените временни credentials са изчистени отново;
старият run cleanup не е повторен. Нов hosted UI/export процес не е започвал.

## Поддържан процес

„Табло“ → „Импорт и експорт“ → разрешен обхват → изтегляне на фиксиран шаблон →
локално прочитане → сървърен staging/грешки по запис и колона → четим preview →
изрично потвърждение на целия набор → потвърден резултат. Разрешен служител с право
за commit може да отвори последните 50 staging прегледа в същия обхват, включително
подготвени от колега. Един човек може да подготвя и потвърждава, ако има всички права.

Само самостоятелни обекти: без сгради/входове, лица, ownership/occupancy, идеални
части, начални салда, финансови записи или файлови attachments. Родителят е избран
извън CSV и се проверява сървърно. Няма универсален mapping редактор или свободни
scope/actor/unit IDs за импорт. Старите units не получават външни ключове автоматично.

## Шаблон units-v1

UTF-8 с допустим BOM, разделител запетая, кавички с удвояване на вътрешните кавички;
quoted клетки може да съдържат запетаи и нови редове. До 200 записа, до 256 KiB файл
и до 256 KiB сериализиран server packet. Нулев байт е невалиден. Няма отгатване на
кодировка/разделител, trim на стойности, тихо закръгляне или изхвърляне на празни редове.
„Запис 2“ означава първия data record след header; quoted нов ред не създава нов запис.

| Колона | Правило |
|---|---|
| source_system | Изрично име на източниковата система, 1–80 ASCII букви/цифри и . _ : -, започва с буква/цифра |
| external_key | Устойчив case-sensitive ключ, 1–120 знака, без контролни символи/външни интервали |
| unit_number | Текст 1–40 знака; водещите нули се запазват |
| unit_type | apartment, shop, office, garage, other |
| floor | Текст до 40 знака или празно |
| area | Празно или положителна площ m² с точка, до 8 цели и 4 десетични знака, без exponent/групиране/закръгляне |
| source_kind | declaration или document |
| source_reference | Основание/референция 1–200 знака; без излишни лични данни |
| known_from | YYYY-MM-DD, валидна дата не в бъдещето |

Празната площ/етаж остава неизвестна, не нула. Текстовите полета не допускат външни
интервали. За приемане се използват съществуващите unit/provenance validators.
Принадлежността към scope започва от текущия ден на commit чрез съществуващия
`create_unit`, не от known_from. Данните остават needs_review; CSV не доказва
пълнота, собственост, придобивна дата или финансова готовност.

## Права и authorization

| Операция | Текущи изрични права в scope |
|---|---|
| Подготовка | prepare_registry_import + read_registry |
| Staging списък/детайл | (prepare_registry_import OR commit_registry_import) + read_registry |
| Потвърждение | commit_registry_import + manage_registry |
| Експорт | export_registry + read_registry |

prepare/commit са eligible за manager; export — manager/controller. Назначаването
е през съществуващия защитен org-admin процес. Admin, име на роля, read/manage_registry
или owner link сами не дават CSV право. Самите import права не включват export или
финансови права; комбинираният UI пакет назовава export изрично. Няма задължителен втори човек. Server actor идва от валидната сесия;
profile/member/org/assignment/scope periods се проверяват от каноничния guard.

Public invoker wrappers извикват guarded private definer операции. Новите
import_jobs/import_rows/external_record_links имат RLS и нямат пряк client SELECT/DML.
Authenticated EXECUTE има само за guarded endpoints; anon/PUBLIC/helper grants са
затворени. UI скриването не е authorization.

## Snapshot, ключове, retry и атомарност

Stage пази действително подадените parsed strings; source_hash е server SHA256 на
JSONB packet-а, не недоказан клиентски file hash. Различен BOM/CSV quoting може да
даде същия parsed packet; разместването на записите може да промени packet hash.
Browser fingerprint служи само за локално запазване на request key, не за права.

Preview е immutable staging revision 1 с source_hash и server context fingerprint.
Commit получава exact job/revision/hash/request key; препроверява текущите права
преди и след locks, fingerprint и всички редове преди първия domain write. Job lock,
request-key advisory lock и scope row lock сериализират повторенията и текущия
`create_unit`. При успех job става committed/revision 2 с exact result receipt.
Файл с един грешен ред не създава частични units/periods/links/audit commit.

Идентичност: `(scope, source_system, 'unit', external_key)`. Същите текстови входни
стойности и неизменен target са unchanged; различни стойности, включително различна
текстова форма, са конфликт за преглед. Не се слива по сходно обозначение. Нов key
върху вече съществуваща physical identity също е конфликт — няма автоматично свързване
или overwrite. Пренареден идентичен CSV не създава дубликати.

Същият stage request key връща точния job или PT409 при различен packet/scope.
Същият commit key/job/revision/hash връща оригиналния резултат след нова проверка на
правата; различен commit key върху приключен job отказва. Нов job със същите external
keys потвърждава unchanged, без второ създаване. След неизвестен отговор UI проверява
job/request receipt; няма автоматичен retry или фалшив успех. Поправим отказ запазва
избрания файл. Новият изричен preview използва нов ключ, старите прегледи се пазят.

Commit прозорецът на staging е 7 дни. Това **не е автоматично изтриване** на raw
staging: job/rows/mapping/audit историята се запазва; отделна контролирана retention
операция и пълният import lifecycle остават непокрити. Не се въвежда scheduler тук.

## Експорт units-export-v1

Server връща само текущите обекти в избрания разрешен scope: `unit_id` плюс деветте
поддържани колони, UTF-8 BOM, запетая/CRLF и quoting на всички клетки. Няма hidden
recorded_by/verification notes, лица, чужд scope или исторически периоди. Липсващ
external key/provenance при стар запис остава празен; няма backfill при четене.

Клетка с потенциална spreadsheet формула получава защитен апостроф **преди** CSV
quoting, включително при водещи whitespace/control символи. CSV няма типове:
при отваряне в spreadsheet номерата/ключовете трябва да се зададат като текст, за
да не бъдат загубени водещите нули от програмата. Export е справка, не import
шаблон; unit_id не е право за запис, а защитният апостроф не се премахва сляпо.

## Проверки и следваща интеграция

Проверки: `check:registry-csv-domain`, `check:registry-csv-db`,
`check:registry-csv-browser`; isolated offline install/build/navigation, targeted
workspace/assignment service regression и public review. PGlite/симулирани identities,
HTTP request interception и локално последователни competing requests **не са**
Supabase hosted Auth/RLS или PostgreSQL MVCC доказателство.

Двете P6a миграции вече са приложени. Не ги прилагай повторно и не използвай старите
QA ключове за нов setup. Приетият P6a е интегриран с нормален merge във финансовия
клон; production публикацията остава отделен gate. Последните 40 приложени версии
са запазено доказателство, не свеж release preflight. CALC миграцията е неприложена;
не се прилагат автоматично всички локални pending файлове.

Ограниченият последващ source review установи сходни authorization рискове извън CSV:
transaction-clock проверки след изчакване, staff grant authority само преди lock и
metadata/preview replay преди повторна проверка. Те са отделни от двата поправени CSV
дефекта и изискват собствен corrective пакет; статичният преглед и локалните проби не
са hosted/MVCC приемане. Пълният import/export MVP не е завършен само с unit CSV.

Първоначалният план по-долу е запазена история/обхват, а не команда за повторение:

Първоначален приемателен план:

1. Fresh project/history/hash/grants/client compatibility baseline. Последните 38
   версии са историческо доказателство. Изолиран CLI history съдържа точните actual
   applied версии плюс само `20261106170356_registry_units_csv.sql`; CALC-04 е изключен,
   P2 вече е applied. Exact single-candidate dry-run преди евентуален apply. P6a SQL
   няма зависимост от CALC; локалната fixture го проверява без CALC миграцията.
2. Отделен маркиран nondemo context, baseline преди write, exact IDs/request receipts,
   само временни app grants на съществуващи QA identities. Не се използват лични или
   PH-DEMO-V1 записи; няма исторически backdating за CALC fixture.
3. Ordinary JWT API: матрицата prepare/commit/export/read-only/admin/owner, foreign
   scope/job, direct DML/helper refusal, source/actor/unit/status spoof, всеки format
   gate, all-row rollback, exact source hash/revision, reorder/replay/changed key и
   same-JWT revoke. Unknown stage/commit се inspect-ват по точните receipts.
4. Native independent holder/contender/observer: duplicate commit same key и different
   keys; два jobs за един external key; import срещу current create_unit в двете
   подреждания; scope/config/revoke writer срещу чакащ commit. Действително observed
   waiter преди release, срокове/finally само за собствените връзки; проверка на
   committed units/periods/links/jobs/audits, без double/partial резултат. Не се
   инжектира изкуствен trigger failure в споделената база — той е local-only.
5. Реален local frontend→hosted process на отделен port/profile: template, row errors,
   preview, explicit confirmation, colleague staging, reload/inspect/replay, export
   bytes/formula safety и mobile/desktop/две теми. Не се повтарят старите finance набори.
6. Exact own grants/sessions cleanup, read-only protected baseline verification;
   retained unit/job/link/audit IDs/statuses се записват. Няма изтриване на mapping
   или история заради QA cleanup; временните operator credentials се изчистват.

Следващи import подстъпки остават persons/ownership/occupancy/shares, контролирани
корекции/свързване на стар регистър, opening balances, XLSX/TSV адаптери и разрешен
owner/financial export. Те не са реализирани или премахнати от приетия MVP с P6a.
