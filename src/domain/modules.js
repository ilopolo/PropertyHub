// Availability describes implementation, never authorization.
export const modules = Object.freeze([
  { id: 'dashboard', label: 'Табло', href: 'pages/dashboard.html', actions: [], available: true },
  { id: 'registry', label: 'Сгради', href: 'pages/buildings.html', actions: ['registry.read', 'registry.write'], available: true },
  { id: 'access', label: 'Достъп и роли', href: 'pages/account.html', actions: ['access.manage'], available: true },
  { id: 'finances', label: 'Финанси', actions: ['charges.publish', 'payments.record'], available: false },
  { id: 'reports', label: 'Отчети', actions: ['reports.read'], available: false },
  { id: 'tickets', label: 'Сигнали', href: 'pages/tickets.html', actions: ['tickets.create'], available: true },
  { id: 'documents', label: 'Документи', actions: ['documents.read'], available: false },
  { id: 'transfer', label: 'Импорт и експорт', actions: ['registry.import'], available: false },
]);
