# CSV обекти — ограничен P6a

Пакетът е в отделен feature клон, зависим от финансовия клон. Hosted приемането на
06.11.2026 е **FAIL / release blocked**: 7 ordinary-JWT API групи и 8 native случая
са PASS, но деветият native случай доказва commit след отнемане на право, докато
заявката чака scope lock. Реалният hosted UI/export процес е **непроверен** и е спрян
след дефекта. Няма production приемане или deployment на P6a.

Точната `20261106170356_registry_units_csv.sql` е приложена еднократно след свежа
38-version история и single-candidate dry-run. След нея са потвърдени **39** версии,
RLS/grants и непроменени съществуващи клиентски функции. P2 е applied; CALC-04 е
изключен и остава неприложен, блокиран от октомврийския fixture. CSV не решава този blocker.

## Блокер и локална корекция

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

Нова **НЕПРИЛОЖЕНА** `20261106185945_registry_csv_current_rights.sql` добавя затворен
private live-time predicate само за CSV stage/commit проверките преди/след locks.
Не променя общия финансов/registry guard, публичните RPC подписи, права, snapshots
или вече приложен SQL. Няма директен authenticated/anon EXECUTE на новия helper.
Четири целеви локални групи възпроизвеждат стария дефект, проверяват expired
prepare/commit refusal без частичен запис, helper ACL и валиден commit/replay.
13-те засегнати P6a DB/RLS групи са повторени успешно с корекцията. Това **не е**
hosted/MVCC доказателство за поправката.

Cleanup е PASS с отделна read-only проверка: 9 временни назначения са оттеглени,
6 собствени сесии са затворени, защитеният baseline и 7 Auth акаунта са непроменени.
Запазени са 14 ясно маркирани synthetic units/14 текущи периода, 11 external links
и 26 import jobs (12 committed, 8 ready, 6 invalid), плюс audit историята. Няма
защитен unit archive RPC; обектите остават active, без direct-SQL lifecycle обход.
Exact IDs/receipts са само в игнорирания run journal. Временните operator credentials
са изчистени. PH-DEMO-V1, личните записи и preview4173 са запазени.

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

## Локални проверки и следващо hosted приемане

Проверки: `check:registry-csv-domain`, `check:registry-csv-db`,
`check:registry-csv-browser`; isolated offline install/build/navigation, targeted
workspace/assignment service regression и public review. PGlite/симулирани identities,
HTTP request interception и локално последователни competing requests **не са**
Supabase hosted Auth/RLS или PostgreSQL MVCC доказателство.

Първоначалният план по-долу остава история/обхват, а не инструкция за повторение на
успешния apply или осемте PASS races. Точната следваща задача след отделно разрешение:
fresh 39-version history/hash/compatibility gate → изолирана история с **единствен**
candidate `20261106185945_registry_csv_current_rights.sql` (P6a вече applied, CALC
изключен) → exact dry-run/apply/inspect → fresh nondemo baseline/own grants →
повторение само на проваления revoke/waiting-commit native случай и тясната засегната
ordinary-JWT regression → реален UI/export-byte/mobile/desktop/light/dark процес →
exact cleanup. Старите request keys/committed резултати не се replay-ват като setup;
новият run има нов marker. Допълнителният hosted apply не е разрешен в приключилия run.

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
