export function provenanceFields(prefix) {
  // Callers supply static internal prefixes, never user input.
  return `<fieldset class="row g-3 mt-1"><legend class="h6">Произход на въведените данни</legend>
  <div class="col-sm-6"><label for="${prefix}-source" class="form-label">Източник</label><select id="${prefix}-source" name="source_kind" class="form-select"><option value="declaration">Декларирани сведения</option><option value="document">Документ</option></select></div>
  <div class="col-sm-6"><label for="${prefix}-known" class="form-label">Данните са известни от</label><input id="${prefix}-known" name="known_from" type="date" class="form-control" required></div>
  <div class="col-12"><label for="${prefix}-reference" class="form-label">Кратко основание / референция</label><input id="${prefix}-reference" name="source_reference" class="form-control" required maxlength="200"><p class="small mt-2">Без излишни лични данни. Датата не е дата на придобиване и не създава предходна история. Записът остава непроверен до отделен преглед; неизвестните полета остават празни.</p></div></fieldset>`;
}
export function readProvenance(data) {
  return { source_kind: String(data.get('source_kind')), source_reference: String(data.get('source_reference') || '').trim(), known_from: String(data.get('known_from')) };
}
export function dateTime(value) { return new Intl.DateTimeFormat('bg-BG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Sofia' }).format(new Date(value)); }
