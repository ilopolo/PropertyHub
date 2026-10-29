import './main.js';
import { loadAdministration } from '../services/administration.js';
import { listRequests, activateOrganization, closeRequest } from '../services/access.js';
import { message, bindForm } from '../ui/forms.js';
import { dateTime } from '../ui/provenance.js';
import { authError } from '../i18n/auth-bg.js';

async function refresh() {
  const account = await loadAdministration();
  const allowed = Boolean(account?.platform);
  document.querySelector('#platform').hidden = !allowed;
  document.querySelector('#access-state').textContent = allowed ? 'Показани са текущите чакащи заявки. Сървърът проверява всяко действие.' : 'Няма активно платформено назначение. Влез с упълномощен акаунт.';
  const list = document.querySelector('#pending-requests'); list.replaceChildren();
  if (!allowed) return;
  const requests = (await listRequests()).filter(r => r.status === 'pending');
  if (!requests.length) list.textContent = 'Няма чакащи заявки.';
  requests.forEach((request, index) => {
    const card = document.createElement('article'); card.className = 'card card-body';
    const title = document.createElement('h3'); title.className = 'h5'; title.textContent = request.request_payload.name;
    const details = document.createElement('p'); details.textContent = `${request.request_payload.organization_kind === 'self_managed' ? 'Самоуправляващ се вход' : 'Професионален управител'} · ${dateTime(request.created_at)} (Europe/Sofia) · редакция ${request.revision}`;
    const identity = document.createElement('p'); identity.className = 'small text-break'; identity.textContent = `Профил: ${request.requester_profile_id} · Заявка: ${request.id}`;
    const form = document.createElement('form'); form.id = `review-${index}`;
    form.innerHTML = `<label class="form-label" for="note-${index}">Основание за проверката / отказа</label><textarea id="note-${index}" class="form-control mb-3" name="note" maxlength="300" required></textarea><div class="d-flex flex-wrap gap-2"><button class="btn btn-success" name="decision" value="activate">Активирай проверената организация</button><button class="btn btn-outline-danger" name="decision" value="reject">Откажи заявката</button></div>`;
    card.append(title, details, identity, form); list.append(card);
    let decision;
    form.addEventListener('submit', event => { decision = event.submitter?.value; });
    bindForm(`#${form.id}`, async data => {
      const note = String(data.get('note')).trim();
      if (decision === 'activate') await activateOrganization(request, note);
      else if (decision === 'reject') await closeRequest(request, 'rejected', note);
      else throw new Error('Decision required');
      await refresh(); message(decision === 'activate' ? 'Организацията и отделното org admin назначение са записани.' : 'Заявката е отказана.');
    });
  });
}
try { await refresh(); } catch (error) { message(authError(error), true); }
