import { useMemo, useState } from 'react';
import { Download, FileText, Inbox, RefreshCw, Search } from 'lucide-react';
import { formatAmount, openFile } from '../api.js';

function openDesktopFile(name, reveal = false) {
  openFile(name, reveal).catch((error) => window.alert(error.message));
}

export default function RecentVouchers({ vouchers, loading, onRefresh, highlight }) {
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vouchers;
    return vouchers.filter((v) =>
      [v.voucherId, v.employeeId, v.mainBudget, v.subBudget, v.preparedBy, v.paymentMethod]
        .join(' ').toLowerCase().includes(q));
  }, [vouchers, query]);

  return (
    <section className="card">
      <header className="card-head row">
        <div>
          <h2>Recent vouchers</h2>
          <p>Latest entries in the Vouchers sheet, with their generated documents.</p>
        </div>
        <div className="head-actions">
          <div className="search-box compact">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter…" aria-label="Filter vouchers" />
          </div>
          <button type="button" className="btn btn-icon" onClick={onRefresh} title="Refresh" aria-label="Refresh">
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="empty">
          <Inbox size={28} />
          <p>{loading ? 'Loading…' : query ? 'No vouchers match that filter' : 'No vouchers yet'}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Voucher</th>
                <th>Date</th>
                <th>Employee</th>
                <th>Budget</th>
                <th>Method</th>
                <th className="num">Amount</th>
                <th>Documents</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.voucherId} className={v.voucherId === highlight ? 'is-new' : ''}>
                  <td><span className="code-pill">{v.voucherId}</span></td>
                  <td className="nowrap">{v.date}</td>
                  <td>{v.employeeId}</td>
                  <td className="nowrap">{[v.mainBudget, v.subBudget].filter(Boolean).join(' / ') || '—'}</td>
                  <td>{v.paymentMethod && <span className={`badge ${v.paymentMethod.toLowerCase()}`}>{v.paymentMethod}</span>}</td>
                  <td className="num mono">{formatAmount(v.amount)}</td>
                  <td>
                    <div className="doc-links">
                      {v.files.filter((f) => f.endsWith('.pdf')).map((f) => (
                        <button key={f} type="button" title={f} onClick={() => openDesktopFile(f)}>
                          <FileText size={14} /> {f.includes('_cover_') ? 'Cover' : 'Voucher'}
                        </button>
                      ))}
                      {v.files.length === 0 && <span className="muted">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function FileList({ files }) {
  return (
    <ul className="file-list">
      {files.map((f) => (
        <li key={f}>
          <FileText size={18} />
          <span className="truncate" title={f}>{f}</span>
          <button type="button" className="btn btn-icon" title="Open"
            onClick={() => openDesktopFile(f)}>Open</button>
          <button type="button" className="btn btn-icon" title="Show in folder" aria-label="Show in folder"
            onClick={() => openDesktopFile(f, true)}><Download size={15} /></button>
        </li>
      ))}
    </ul>
  );
}
