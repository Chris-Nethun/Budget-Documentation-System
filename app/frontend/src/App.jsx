import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FolderOpen, Info, Moon, Sun, Wallet, X } from 'lucide-react';
import { api, normaliseBudgets, showDatabase } from './api.js';
import EmployeeLookup from './components/EmployeeLookup.jsx';
import PaymentForm from './components/PaymentForm.jsx';
import SummaryPanel from './components/SummaryPanel.jsx';
import RecentVouchers, { FileList } from './components/RecentVouchers.jsx';

const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

const emptyForm = () => ({
  paymentMethod: 'Transfer',
  mainBudget: '',
  subBudget: '',
  amount: '',
  description: '',
  preparedBy: store.get('preparedBy', ''),
});

export default function App() {
  const [theme, setTheme] = useState(() => store.get('theme',
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const [budgets, setBudgets] = useState([]);
  const [budgetBalance, setBudgetBalance] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState('');
  const budgetErrorRef = useRef('');
  const [employees, setEmployees] = useState([]);
  const [employee, setEmployee] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [touched, setTouched] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [vouchers, setVouchers] = useState([]);
  const [vouchersLoading, setVouchersLoading] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [result, setResult] = useState(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    store.set('theme', theme);
  }, [theme]);

  const toast = useCallback((message, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 7000 : 4000);
  }, []);

  const loadVouchers = useCallback(() => {
    setVouchersLoading(true);
    return api.vouchers()
      .then(setVouchers)
      .catch((e) => toast(`Could not load vouchers: ${e.message}`, 'error'))
      .finally(() => setVouchersLoading(false));
  }, [toast]);

  const refreshBudgets = useCallback(async () => {
    try {
      const nextBudgets = normaliseBudgets(await api.budgets());
      setBudgets(nextBudgets);
      setForm((current) => {
        if (current.mainBudget && !nextBudgets.some((budget) => budget.code === current.mainBudget)) {
          return { ...current, mainBudget: '', subBudget: '' };
        }
        if (current.subBudget && !nextBudgets.some((budget) =>
          budget.subs.some((sub) => sub.code === current.subBudget))) {
          return { ...current, subBudget: '' };
        }
        return current;
      });
      budgetErrorRef.current = '';
    } catch (error) {
      if (budgetErrorRef.current !== error.message) {
        toast(`Unable to load budget codes: ${error.message}`, 'error');
      }
      budgetErrorRef.current = error.message;
    }
  }, [toast]);

  useEffect(() => {
    api.employees().then(setEmployees).catch(() => { /* suggestions are optional */ });
    loadVouchers();
  }, [loadVouchers, toast]);

  useEffect(() => {
    const refresh = () => { refreshBudgets(); };
    refresh();
    const interval = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [refreshBudgets]);

  const selectedBudgetCode = form.subBudget || form.mainBudget;
  useEffect(() => {
    let active = true;
    setBudgetBalance(null);
    setBalanceError('');
    if (!selectedBudgetCode) {
      setBalanceLoading(false);
      return () => { active = false; };
    }

    setBalanceLoading(true);
    api.balance(selectedBudgetCode)
      .then((value) => { if (active) setBudgetBalance(value); })
      .catch((error) => { if (active) setBalanceError(error.message); })
      .finally(() => { if (active) setBalanceLoading(false); });
    return () => { active = false; };
  }, [selectedBudgetCode, budgets]);

  const lookup = async (id) => {
    setLookingUp(true);
    try {
      const emp = await api.employee(id);
      setEmployee(emp);
      toast(`Loaded ${emp.name}`, 'success');
    } catch (e) {
      setEmployee(null);
      toast(e.message, 'error');
    } finally {
      setLookingUp(false);
    }
  };

  const setField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key === 'preparedBy') store.set('preparedBy', value);
  };

  const errors = useMemo(() => {
    const e = {};
    if (!touched) return e;
    if (!(Number(form.amount) > 0)) e.amount = 'Enter an amount greater than zero';
    if (!form.description.trim()) e.description = 'A description is required';
    return e;
  }, [form, touched]);

  const checklist = [
    { label: 'Employee selected', done: !!employee, required: true },
    { label: 'Amount entered', done: Number(form.amount) > 0, required: true },
    { label: 'Description added', done: !!form.description.trim(), required: true },
    { label: 'Budget code chosen', done: !!form.subBudget, required: true },
    { label: 'Prepared by', done: !!form.preparedBy.trim(), required: false },
  ];
  const exceedsBudget = !!budgetBalance && Number(form.amount) > Number(budgetBalance.remaining);
  const canSubmit = checklist.every((c) => !c.required || c.done)
    && !!budgetBalance && !balanceLoading && !balanceError && !exceedsBudget;

  const submit = async () => {
    setTouched(true);
    if (!canSubmit) {
      if (exceedsBudget) {
        toast('Amount exceeds the remaining budget balance.', 'error');
      } else if (balanceError) {
        toast(balanceError, 'error');
      } else {
        toast(employee ? 'Please fill all required fields.' : 'Select an employee first.', 'error');
      }
      return;
    }
    setProcessing(true);
    try {
      const res = await api.process({ employeeId: employee.id, ...form });
      setResult(res);
      setForm((f) => ({ ...f, amount: '', description: '' }));
      setTouched(false);
      await Promise.all([refreshBudgets(), loadVouchers()]);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const reset = () => {
    setEmployee(null);
    setForm(emptyForm());
    setTouched(false);
    toast('Form reset.');
  };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !processing) submit();
      if (e.key === 'Escape') setResult(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Wallet size={20} /></span>
          <div>
            <span className="eyebrow">Budget operations</span>
            <h1>Create a transaction</h1>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => showDatabase().catch((error) => toast(`Could not locate database.xlsx: ${error.message}`, 'error'))}
          title="Show the workbook this app updates"
        >
          <FolderOpen size={16} />
          Show database.xlsx
        </button>
        <button
          type="button"
          className="btn btn-icon theme-toggle"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          aria-label="Toggle theme"
          title={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>

      <main className="layout">
        <div className="col-main">
          <EmployeeLookup
            employees={employees}
            employee={employee}
            loading={lookingUp}
            onLookup={lookup}
            invalid={touched && !employee}
          />
          <PaymentForm
            form={form}
            setField={setField}
            budgets={budgets}
            errors={errors}
            balance={budgetBalance}
            balanceLoading={balanceLoading}
            balanceError={balanceError}
          />
        </div>
        <SummaryPanel
          form={form}
          employee={employee}
          budgets={budgets}
          checklist={checklist}
          canSubmit={canSubmit}
          processing={processing}
          onSubmit={submit}
          onReset={reset}
        />
        <div className="col-full">
          <RecentVouchers
            vouchers={vouchers}
            loading={vouchersLoading}
            onRefresh={loadVouchers}
            highlight={result?.voucher_id}
          />
        </div>
      </main>

      {processing && (
        <div className="overlay">
          <div className="working">
            <div className="spinner" />
            <h3>Preparing documents</h3>
            <p>Filling templates, converting to PDF and updating the workbook. This can take a few seconds.</p>
          </div>
        </div>
      )}

      {result && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setResult(null)}>
          <div className="dialog" role="dialog" aria-modal="true">
            <button type="button" className="btn btn-icon dialog-close" onClick={() => setResult(null)} aria-label="Close">
              <X size={18} />
            </button>
            <div className="success-mark"><CheckCircle2 size={34} /></div>
            <h3>Transaction completed</h3>
            <p className="muted">{result.message}</p>
            {result.files?.length > 0 && <FileList files={result.files} />}
            <button type="button" className="btn btn-primary btn-lg" onClick={() => setResult(null)}>
              Start next transaction
            </button>
          </div>
        </div>
      )}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.type === 'error' ? <AlertCircle size={18} /> : t.type === 'success' ? <CheckCircle2 size={18} /> : <Info size={18} />}
            <span>{t.message}</span>
            <button type="button" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
