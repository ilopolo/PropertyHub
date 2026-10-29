# PropertyHub

Следвай [AGENTS.md](../AGENTS.md), [README](../README.md) и [публичната архитектура](../docs/public/ARCHITECTURE.md).
HTML/CSS/vanilla JavaScript/Bootstrap; Node/npm/Vite с отделни HTML входове; Supabase DB/Auth/Storage. Без React, Vue, TypeScript.
Текущият пакет е DEV-01: навигация, теми и build; няма реализирани Auth/CRUD/финанси.
Локално, ако са налични, прочети docs/HANDOFF.md, IDE_START.md, ACCEPTANCE_MATRIX.md и относимите MVP_SCOPE/DECISIONS/MIGRATION_PLAN. Те са вътрешни, игнорирани и не трябва да се публикуват.
Запазвай съществуващия код и Git история. Не използвай git add . или force push. Не публикувай assignment/references/history или пълния планов пакет.
UI и service/domain модулите са отделни. Каталогът на модули не е authorization. Server/RLS проверки са задължителни при бъдещите операции.
Никакви тайни, service-role ключове или реални лични данни в frontend/Git; всички VITE_* стойности са публични.
Проверявай build, реална навигация и responsive/light/dark преди checkpoint. Документирай само действително провереното; отговаряй на български.
