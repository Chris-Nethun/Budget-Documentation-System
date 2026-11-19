import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

/**
 * Searchable select. `options` are { value, label, hint?, depth? }.
 */
export default function Combobox({
  options, value, onChange, placeholder = 'Select…', disabled, emptyText = 'No matches', invalid,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.value} ${o.label}`.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    const close = (e) => !rootRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      const idx = options.findIndex((o) => o.value === value);
      setActive(idx >= 0 && !options[idx].disabled ? idx : options.findIndex((o) => !o.disabled));
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (opt) => {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
  };

  const firstSelectable = (items = filtered) => items.findIndex((option) => !option.disabled);
  const moveActive = (current, direction) => {
    let index = current < 0 && direction < 0 ? filtered.length - 1 : current + direction;
    for (; index >= 0 && index < filtered.length; index += direction) {
      if (!filtered[index].disabled) return index;
    }
    return current;
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => moveActive(a, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => moveActive(a, -1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[active] && !filtered[active].disabled) choose(filtered[active]);
    }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className={`combo ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={`input combo-trigger ${invalid ? 'is-invalid' : ''}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selected ? (
          <span className="combo-value">
            <span className="code-pill">{selected.value}</span>
            <span className="truncate">{selected.label}</span>
          </span>
        ) : (
          <span className="placeholder">{placeholder}</span>
        )}
        {selected && !disabled ? (
          <span
            className="combo-clear"
            role="button"
            aria-label="Clear"
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
          >
            <X size={14} />
          </span>
        ) : null}
        <ChevronDown size={16} className="combo-chevron" />
      </button>

      {open && (
        <div className="combo-pop">
          <div className="combo-search">
            <Search size={15} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                const nextQuery = e.target.value;
                const normalizedQuery = nextQuery.trim().toLowerCase();
                const nextOptions = normalizedQuery
                  ? options.filter((option) =>
                    `${option.value} ${option.label}`.toLowerCase().includes(normalizedQuery))
                  : options;
                setQuery(nextQuery);
                setActive(firstSelectable(nextOptions));
              }}
              onKeyDown={onKey}
              placeholder="Type to filter by code or name"
            />
          </div>
          <ul className="combo-list" role="listbox" ref={listRef}>
            {filtered.length === 0 && <li className="combo-empty">{emptyText}</li>}
            {filtered.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                aria-disabled={!!o.disabled}
                className={`combo-option ${i === active && !o.disabled ? 'is-active' : ''} ${o.disabled ? 'is-disabled' : ''}`}
                style={{ paddingLeft: 12 + (o.depth || 0) * 14 }}
                onMouseEnter={() => { if (!o.disabled) setActive(i); }}
                onMouseDown={(e) => { e.preventDefault(); if (!o.disabled) choose(o); }}
              >
                <span className="code-pill">{o.value}</span>
                <span className="truncate">{o.label}</span>
                {o.hint && <small className="combo-option-hint">{o.hint}</small>}
                {o.value === value && <Check size={15} className="combo-check" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
