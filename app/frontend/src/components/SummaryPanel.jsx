import { CheckCircle2, Circle, FileText, Loader2, RotateCcw, Send } from 'lucide-react';
import { formatAmount } from '../api.js';

export default function SummaryPanel({ form, employee, budgets, checklist, canSubmit, processing, onSubmit, onReset }) {
  const main = budgets.find((b) => b.code === form.mainBudget);
  const sub = main?.subs.find((s) => s.code === form.subBudget);
  const done = checklist.filter((c) => c.done).length;
  const pct = Math.round((done / checklist.length) * 100);

  return (
    <aside className="summary">
      <div className="card voucher">
        <div className="voucher-head">
          <span className="eyebrow"><FileText size={14} /> Voucher preview</span>
          <span className="date">{new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
        </div>

        <div className="voucher-amount">
          <small>Amount payable</small>
          <strong>Rs. {formatAmount(form.amount || 0)}</strong>
        </div>

        <dl className="voucher-rows">
          <Row label="Payable to" value={employee ? `${employee.name} (${employee.id})` : null} />
          <Row label="Method" value={form.paymentMethod} />
          <Row label="Main budget" value={main ? `${main.code} · ${main.name}` : null} />
          <Row label="Sub budget" value={sub ? `${sub.code} · ${sub.name}` : null} />
          <Row label="Description" value={form.description} />
          <Row label="Prepared by" value={form.preparedBy} />
        </dl>

        <div className="progress">
          <div className="progress-label">
            <span>Ready to submit</span>
            <span>{done}/{checklist.length}</span>
          </div>
          <div className="progress-track"><div style={{ width: `${pct}%` }} /></div>
          <ul className="checklist">
            {checklist.map((c) => (
              <li key={c.label} className={c.done ? 'is-done' : ''}>
                {c.done ? <CheckCircle2 size={15} /> : <Circle size={15} />}
                {c.label}
                {!c.required && <small>optional</small>}
              </li>
            ))}
          </ul>
        </div>

        <button type="button" className="btn btn-primary btn-lg" disabled={!canSubmit || processing} onClick={onSubmit}>
          {processing ? <><Loader2 size={18} className="spin" /> Generating documents…</> : <><Send size={18} /> Process transaction</>}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onReset} disabled={processing}>
          <RotateCcw size={16} /> Reset form
        </button>
        <p className="kbd-hint">Press <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to submit</p>
      </div>
    </aside>
  );
}

function Row({ label, value }) {
  return (
    <div className="voucher-row">
      <dt>{label}</dt>
      <dd className={value ? '' : 'muted'}>{value || '—'}</dd>
    </div>
  );
}
