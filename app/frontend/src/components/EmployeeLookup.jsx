import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, CreditCard, Loader2, MapPin, Search, UserRound, IdCard } from 'lucide-react';
import { initials } from '../api.js';

export default function EmployeeLookup({ employees, employee, loading, onLookup, invalid }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees.slice(0, 8);
    return employees
      .filter((e) => e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [employees, query]);

  useEffect(() => {
    const close = (e) => !rootRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => { if (!employee) setQuery(''); }, [employee]);

  const pick = (id) => {
    setQuery(id);
    setOpen(false);
    onLookup(id);
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && suggestions[active]) pick(suggestions[active].id);
      else if (query.trim()) pick(query.trim());
    } else if (e.key === 'Escape') setOpen(false);
  };

  const bank = employee
    ? [employee.bankName, employee.accountNumber].filter(Boolean).join(' · ')
    : '';

  return (
    <section className="card">
      <header className="card-head">
        <span className="step">1</span>
        <div>
          <h2>Employee</h2>
          <p>Search by employee ID or name. Details come from the Employees sheet.</p>
        </div>
      </header>

      <div className="lookup" ref={rootRef}>
        <div className={`search-box ${invalid ? 'is-invalid' : ''}`}>
          <Search size={18} />
          <input
            value={query}
            placeholder="e.g. E001 or Alice Smith"
            onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKey}
            aria-label="Employee ID or name"
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!query.trim() || loading}
            onClick={() => pick(query.trim())}
          >
            {loading ? <Loader2 size={16} className="spin" /> : 'Find'}
          </button>
        </div>
        {open && suggestions.length > 0 && (
          <ul className="suggest">
            {suggestions.map((s, i) => (
              <li
                key={s.id}
                className={i === active ? 'is-active' : ''}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(s.id); }}
              >
                <span className="avatar sm">{initials(s.name)}</span>
                <span className="suggest-main">
                  <strong>{s.name}</strong>
                  <small>{s.department || '—'}</small>
                </span>
                <span className="code-pill">{s.id}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {loading && !employee && <div className="profile skeleton" />}

      {employee && (
        <div className={`profile ${loading ? 'is-dim' : ''}`} key={employee.id}>
          <div className="profile-top">
            <span className="avatar">{initials(employee.name)}</span>
            <div>
              <h3>{employee.name}</h3>
              <p className="muted">{employee.department || 'No department'}</p>
            </div>
            <span className="code-pill lg">{employee.id}</span>
          </div>
          <dl className="profile-grid">
            <Detail icon={IdCard} label="NIC" value={employee.nic} />
            <Detail icon={Building2} label="Department" value={employee.department} />
            <Detail icon={CreditCard} label="Bank details" value={bank} mono />
            <Detail icon={MapPin} label="Address" value={employee.address} />
          </dl>
        </div>
      )}

      {!employee && !loading && (
        <div className="empty">
          <UserRound size={28} />
          <p>No employee selected yet</p>
        </div>
      )}
    </section>
  );
}

function Detail({ icon: Icon, label, value, mono }) {
  return (
    <div className="detail">
      <dt><Icon size={14} /> {label}</dt>
      <dd className={mono ? 'mono' : ''}>{value || <span className="muted">Not recorded</span>}</dd>
    </div>
  );
}
