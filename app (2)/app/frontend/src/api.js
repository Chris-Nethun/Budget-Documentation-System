async function request(action, payload = {}) {
  if (!window.budgetDesktop) {
    throw new Error('The desktop bridge is unavailable. Restart the Windows app.');
  }
  const result = await window.budgetDesktop.request({ action, payload });
  if (result.status === 'error') throw new Error(result.message || 'Request failed');
  return result;
}

export const api = {
  budgets: () => request('budgets').then((r) => r.data),
  employees: () => request('employees').then((r) => r.data),
  employee: (employeeId) => request('employee', { employeeId }).then((r) => r.data),
  balance: (budgetCode) => request('balance', { budgetCode }).then((r) => r.data),
  vouchers: () => request('vouchers').then((r) => r.data),
  process: (payload) => request('process', payload),
};

export const openFile = (name, reveal = false) => {
  if (!window.budgetDesktop) {
    return Promise.reject(new Error('The desktop file service is unavailable.'));
  }
  return window.budgetDesktop.openFile(name, reveal);
};

export const showDatabase = () => {
  if (!window.budgetDesktop) {
    return Promise.reject(new Error('The desktop file service is unavailable.'));
  }
  return window.budgetDesktop.showDatabase();
};

export const formatAmount = (value) => {
  const n = Number(value);
  return Number.isFinite(n)
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00';
};

export const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

// Parses budgets_extracted.json ({ main: [...], sub: { "B. Name": [...] } }).
export const normaliseBudgets = (data) =>
  (data?.main || []).map((m) => ({
    ...m,
    subs: data.sub?.[`${m.code}. ${m.name}`] || [],
  }));
