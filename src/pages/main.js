import 'bootstrap/dist/css/bootstrap.min.css';
import '../styles/main.css';
import { initializeShell } from '../ui/shell.js';
import { modules } from '../domain/modules.js';
import { getBackendStatus } from '../services/config.js';

initializeShell();
const status = document.querySelector('#backend-status');
if (status) status.textContent = getBackendStatus();
const catalog = document.querySelector('#module-catalog');
if (catalog) {
  for (const module of modules) {
    const item = document.createElement('li');
    item.className = 'list-group-item d-flex justify-content-between align-items-center gap-3';
    const label = document.createElement(module.available ? 'a' : 'span');
    label.textContent = module.label;
    if (module.available) label.href = import.meta.env.BASE_URL + module.href;
    const state = document.createElement('span');
    state.className = 'badge text-bg-secondary';
    state.textContent = module.available ? 'Основа' : 'Предстои';
    item.append(label, state);
    catalog.append(item);
  }
}
