import { calendarLabel } from '../domain/registry.js';
import { dateTime } from './provenance.js';

export function unitDetails(unit) {
  const details = document.createElement('details');
  const summary = document.createElement('summary'); summary.textContent = 'Период и произход';
  const list = document.createElement('dl'); list.className = 'row mt-3 mb-0';
  const source = { declaration: 'Декларирани сведения', document: 'Документ', legacy_unknown: 'Неустановен стар източник' };
  const period = unit.scope_period;
  const entries = [
    ['Принадлежност към обхвата', `${calendarLabel(period.valid_from)} — ${period.valid_to ? calendarLabel(period.valid_to) + ' (краят не е включен)' : 'без посочен край'}`],
    ['Източник на принадлежността', `${source[period.source_kind] || 'Неустановен източник'} · ${period.source_reference || 'без референция'}`],
    ['Сведения за принадлежността от', calendarLabel(period.known_from)],
    ['Източник за обекта', `${source[unit.source_kind] || 'Неустановен източник'} · ${unit.source_reference || 'без референция'}`],
    ['Сведения за обекта от', calendarLabel(unit.known_from)],
    [unit.source_kind === 'legacy_unknown' ? 'Регистрирано при миграцията' : 'Въведено в системата', unit.recorded_at ? dateTime(unit.recorded_at) : 'неустановено време'],
    ['Проверка на обекта', unit.verified_at ? `${dateTime(unit.verified_at)} · ${unit.verification_note || 'без допълнителна бележка'}` : 'Няма записана проверка'],
    ['Проверка на принадлежността', period.verification_status === 'verified' ? 'Проверени въведени стойности' : 'Нужен преглед'],
  ];
  for (const [label, value] of entries) {
    const term = document.createElement('dt'); term.className = 'col-sm-4'; term.textContent = label;
    const text = document.createElement('dd'); text.className = 'col-sm-8 text-break'; text.textContent = value;
    list.append(term, text);
  }
  const note = document.createElement('p'); note.className = 'small mt-2'; note.textContent = 'Показани са текущите записани стойности за обекта. Датата филтрира принадлежността към обхвата, а не стари версии на полетата. Това не е дата на придобиване. Известно от и въведено в системата са отделни дати. Проверка на реда не попълва липсващата площ и не доказва пълен регистър или финансова готовност.';
  details.append(summary, list, note);
  return details;
}
