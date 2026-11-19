import { Banknote, Landmark } from 'lucide-react';
import Combobox from './Combobox.jsx';
import { formatAmount } from '../api.js';

const METHODS = [
  { value: 'Transfer', icon: Landmark, hint: 'Bank transfer' },
  { value: 'Cash', icon: Banknote, hint: 'Paid in cash' },
];

const depthOf = (code) => Math.max(0, code.split('.').length - 2);

export default function PaymentForm({
  form, setField, budgets, errors, balance, balanceLoading, balanceError,
}) {
  const main = budgets.find((b) => b.code === form.mainBudget);
  const mainOptions = budgets.map((b) => ({ value: b.code, label: b.name }));
  const subOptions = (main?.subs || []).map((s) => ({
    value: s.code,
    label: `- ${s.name}`,
    hint: `(Rs. ${formatAmount(s.remaining)} left)`,
    disabled: Number(s.remaining) <= 0,
    depth: depthOf(s.code),
  }));
  const amount = Number(form.amount) || 0;
  const overBudget = !!balance && amount > Number(balance.remaining);
  const projectedRemaining = balance ? Number(balance.remaining) - amount : 0;
  const utilization = balance && Number(balance.allocated) > 0
    ? Math.max(0, Math.min(100, ((Number(balance.spent) + amount) / Number(balance.allocated)) * 100))
    : 0;

  return (
    <section className="card">
      <header className="card-head">
        <span className="step">2</span>
        <div>
          <h2>Payment details</h2>
          <p>Choose a budget line and describe the payment.</p>
        </div>
      </header>

      <div className="grid-2">
        <Field label="Payment method" full>
          <div className="segmented" role="radiogroup">
            {METHODS.map(({ value, icon: Icon, hint }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={form.paymentMethod === value}
                className={form.paymentMethod === value ? 'is-on' : ''}
                onClick={() => setField('paymentMethod', value)}
              >
                <Icon size={18} />
                <span>
                  <strong>{value}</strong>
                  <small>{hint}</small>
                </span>
              </button>
            ))}
          </div>
        </Field>

        <Field label="Main budget code">
          <Combobox
            options={mainOptions}
            value={form.mainBudget}
            onChange={(v) => { setField('mainBudget', v); setField('subBudget', ''); }}
            placeholder="Select main budget"
          />
        </Field>

        <Field
          label="Sub budget code"
          hint={main && subOptions.length === 0 ? 'This budget has no sub codes' : undefined}
        >
          <Combobox
            options={subOptions}
            value={form.subBudget}
            onChange={(v) => setField('subBudget', v)}
            disabled={!main || subOptions.length === 0}
            placeholder={main ? 'Select sub budget' : 'Choose a main budget first'}
          />
          {(form.subBudget || form.mainBudget) && (
            <div className={`budget-balance ${overBudget || balanceError ? 'is-over-budget' : ''}`} aria-live="polite">
              {balanceLoading && <span className="field-hint">Loading budget balance…</span>}
              {balanceError && <span className="field-error">{balanceError}</span>}
              {balance && (
                <>
                  <div className="balance-values">
                    <span>Allocated <strong>Rs. {formatAmount(balance.allocated)}</strong></span>
                    <span>Spent <strong>Rs. {formatAmount(balance.spent)}</strong></span>
                    <span>Remaining <strong>Rs. {formatAmount(projectedRemaining)}</strong></span>
                  </div>
                  <div className="balance-track">
                    <div className="balance-fill" style={{ width: `${utilization}%` }} />
                  </div>
                  {overBudget && (
                    <span className="field-error">
                      Amount exceeds the available balance by Rs. {formatAmount(-projectedRemaining)}.
                    </span>
                  )}
                  {!overBudget && !balanceError && (
                    <span className="field-hint">Remaining after this transaction</span>
                  )}
                </>
              )}
            </div>
          )}
        </Field>

        <Field label="Amount" required error={errors.amount}>
          <div className={`input-affix ${errors.amount ? 'is-invalid' : ''}`}>
            <span className="affix">Rs.</span>
            <input
              inputMode="decimal"
              value={form.amount}
              placeholder="0.00"
              onChange={(e) => setField('amount', e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'))}
            />
          </div>
        </Field>

        <Field label="Prepared by">
          <input
            className="input"
            value={form.preparedBy}
            placeholder="Your name"
            onChange={(e) => setField('preparedBy', e.target.value)}
          />
        </Field>

        <Field label="Description" required full error={errors.description} counter={`${form.description.length}/200`}>
          <textarea
            className={`input ${errors.description ? 'is-invalid' : ''}`}
            rows={3}
            maxLength={200}
            value={form.description}
            placeholder="What is this payment for?"
            onChange={(e) => setField('description', e.target.value)}
          />
        </Field>
      </div>
    </section>
  );
}

function Field({ label, required, full, hint, error, counter, children }) {
  return (
    <div className={`field ${full ? 'full' : ''}`}>
      <span className="field-label">
        {label}
        {required && <em>*</em>}
        {counter && <span className="counter">{counter}</span>}
      </span>
      {children}
      {(error || hint) && <span className={error ? 'field-error' : 'field-hint'}>{error || hint}</span>}
    </div>
  );
}
