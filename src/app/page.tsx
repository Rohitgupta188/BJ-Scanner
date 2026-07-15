'use client';

/**
 * Dashboard — reads/writes scanned items from localStorage only.
 * No server session, no DB writes. Same device as the scanner.
 *
 * localStorage key: "bj_items"  →  SessionItem[]
 *
 * Auto-refreshes when:
 *   - Tab comes back into focus (scanner was open in another tab)
 *   - Another tab writes to localStorage (storage event)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SessionItem } from '@/lib/types';

const STORAGE_KEY = 'bj_items';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readStorage(): SessionItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeStorage(items: SessionItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function computeTotals(items: SessionItem[]) {
  return items.reduce(
    (acc, item) => ({
      qty:     acc.qty     + item.qty,
      grossWt: acc.grossWt + item.grossWeight * item.qty,
      netWt:   acc.netWt   + item.netWeight   * item.qty,
      stoneWt: acc.stoneWt + item.stoneWeight * item.qty,
    }),
    { qty: 0, grossWt: 0, netWt: 0, stoneWt: 0 }
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const [items, setItems]           = useState<SessionItem[]>([]);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [toasts, setToasts]         = useState<Toast[]>([]);
  const [qtyEditing, setQtyEditing] = useState<Record<string, number>>({});
  const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean; message: string; onConfirm: () => void } | null>(null);
  const toastId = useRef(0);

  // ── Toast ───────────────────────────────────────────────────────────────────

  const addToast = useCallback((message: string, type: 'success' | 'error') => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2700);
  }, []);

  // ── Load from localStorage ──────────────────────────────────────────────────

  const loadFromStorage = useCallback(() => {
    setItems(readStorage());
  }, []);

  // Mount
  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  // Refresh when this tab regains focus (scanner was in another tab)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadFromStorage();
    };
    // Fires in OTHER tabs when localStorage changes
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) loadFromStorage();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('storage', onStorage);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('storage', onStorage);
    };
  }, [loadFromStorage]);

  // ── Open scanner in same tab ─────────────────────────────────────────────────

  const handleOpenScanner = () => {
    router.push('/scan');
  };

  // ── Clear all scanned items ─────────────────────────────────────────────────

  const handleClear = () => {
    setConfirmDialog({
      isOpen: true,
      message: 'Clear all scanned items?',
      onConfirm: () => {
        localStorage.removeItem(STORAGE_KEY);
        setItems([]);
        setConfirmDialog(null);
      }
    });
  };

  // ── Qty edit ────────────────────────────────────────────────────────────────

  const handleQtyChange = (sku: string, value: string) => {
    if (value === '') {
      setQtyEditing(prev => ({ ...prev, [sku]: '' as any }));
      return;
    }
    const n = parseInt(value, 10);
    if (isNaN(n)) return;
    setQtyEditing(prev => ({ ...prev, [sku]: n }));
  };

  const handleQtyBlur = (sku: string) => {
    if (qtyEditing[sku] === undefined) return;
    const qty = qtyEditing[sku];

    const current = readStorage();
    const updated  = qty <= 0
      ? current.filter(i => i.sku !== sku)
      : current.map(i => i.sku === sku ? { ...i, qty } : i);

    writeStorage(updated);
    setItems(updated);
    setQtyEditing(prev => { const c = { ...prev }; delete c[sku]; return c; });
    addToast(qty <= 0 ? 'Item removed' : 'Qty updated', 'success');
  };

  const handleItemFieldChange = (sku: string, field: 'metalPurity' | 'metalType', value: string | number) => {
    const current = readStorage();
    const updated = current.map(i => i.sku === sku ? { ...i, [field]: value } : i);
    writeStorage(updated);
    setItems(updated);
    addToast('Item updated', 'success');
  };

  const handleRemoveItem = (sku: string) => {
    setConfirmDialog({
      isOpen: true,
      message: 'Remove this item?',
      onConfirm: () => {
        const updated = readStorage().filter(i => i.sku !== sku);
        writeStorage(updated);
        setItems(updated);
        addToast('Item removed', 'success');
        setConfirmDialog(null);
      }
    });
  };

  // ── Generate PDF ────────────────────────────────────────────────────────────

  const handleGeneratePdf = async () => {
    if (!items.length) { addToast('No items scanned yet.', 'error'); return; }
    setPdfLoading(true);
    try {
      const { downloadPdf } = await import('@/lib/generatePdf');
      await downloadPdf(items);
      addToast('PDF downloaded!', 'success');
    } catch {
      addToast('PDF generation failed.', 'error');
    } finally {
      setPdfLoading(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const totals = computeTotals(items);

  return (
    <>
      <div className="bg-mesh" />

      {/* Toasts */}
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>
      ))}

      {/* Confirm Dialog */}
      {confirmDialog?.isOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
          <div className="card fade-in" style={{ width: '100%', maxWidth: '340px', textAlign: 'center', padding: '2rem' }}>
            <div style={{ marginBottom: '1rem', color: 'var(--gold)' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto' }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <h3 style={{ fontSize: '1.15rem', marginBottom: '1.5rem', fontWeight: 600 }}>{confirmDialog.message}</h3>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button className="btn btn-ghost" onClick={() => setConfirmDialog(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmDialog.onConfirm}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

        {/* Header matching Screenshot Design */}
        <header className="portal-header">
          


          <h1 style={{ fontFamily: '"Playfair Display", serif', fontSize: '2.25rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem', letterSpacing: '-0.02em' }}>
            QR Scanner
          </h1>
          

          <button className="btn btn-gold" onClick={handleOpenScanner} style={{ fontSize: '0.95rem', padding: '0.75rem 2rem', borderRadius: '99px', marginTop: '20px' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
              <circle cx="12" cy="13" r="3"/>
            </svg>
            Open Scanner
          </button>
        </header>

        {/* Main */}
        <main style={{ flex: 1, maxWidth: '1400px', margin: '0 auto', width: '100%', padding: '0 1.5rem 3rem' }}>
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            {/* Stat cards + actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <div className="stat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
                {[
                  { label: 'Total Items', value: items.length,                       sub: 'unique SKUs' },
                  { label: 'Total Qty',   value: totals.qty,                         sub: 'pieces'      },
                  { label: 'Gross Wt',    value: `${totals.grossWt.toFixed(2)} g`,   sub: 'total'       },
                  { label: 'Net Wt',      value: `${totals.netWt.toFixed(2)} g`,     sub: 'total'       },
                ].map(s => (
                  <div key={s.label} className="card-sm" style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--gold)' }}>{s.value}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>{s.label}</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>{s.sub}</div>
                  </div>
                ))}
              </div>
              </div>

            {/* Items table */}
            <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: '24px', border: '1px solid var(--border)', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
              <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                {items.length > 0 && <span className="pulse-dot" />}
                <span style={{ fontWeight: 600, fontSize: '1rem', fontFamily: '"Playfair Display", serif' }}>Scanned Items</span>
                
                {/* Actions (Moved from below stat cards) */}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
                  <button className="btn btn-ghost" style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem', border: 'none' }} onClick={handleGeneratePdf} disabled={pdfLoading || items.length === 0} title="Export PDF">
                    {pdfLoading ? <span className="spinner" style={{ width: 20, height: 20 }} /> : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M12 18v-6M9 15l3 3 3-3"/>
                      </svg>
                    )}
                  </button>
                  <button className="btn btn-ghost" style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem', border: 'none' }} onClick={loadFromStorage} title="Refresh">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                    </svg>
                  </button>
                  <button className="btn btn-ghost" style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem', border: 'none', color: 'var(--danger)' }} onClick={handleClear} disabled={items.length === 0} title="Clear All">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/>
                    </svg>
                  </button>
                </div>
              </div>

              {items.length === 0 ? (
                <div className="empty-state">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                    <path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/>
                    <rect x="7" y="7" width="10" height="10" rx="1"/>
                  </svg>
                  <p>No items yet. Click <strong>Open Scanner</strong> to start scanning.</p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="scan-table">
                    <thead>
                      <tr>
                        <th>Sr</th><th>Image</th><th>Design No.</th>
                        <th>KT</th><th>Color</th><th>Gross Wt</th><th>Net Wt</th>
                        <th>S Wt</th><th>Qty</th><th>Total Gross</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, i) => {
                        const editingQty = qtyEditing[item.sku] !== undefined ? qtyEditing[item.sku] : item.qty;
                        return (
                          <tr key={item.sku} className="fade-in">
                            <td style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>{i + 1}</td>
                            <td>
                              {item.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={item.imageUrl} alt={item.designNumber} style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                              ) : (
                                <div style={{ width: 44, height: 44, borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: '0.6rem' }}>—</div>
                              )}
                            </td>
                            <td><span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--gold-dim)' }}>{item.designNumber}</span></td>
                            <td>
                              <select 
                                value={item.metalPurity} 
                                onChange={e => handleItemFieldChange(item.sku, 'metalPurity', parseInt(e.target.value))}
                                style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: '4px', padding: '2px 4px', fontSize: '0.75rem', color: 'var(--text-primary)', outline: 'none' }}
                              >
                                <option value={22}>22K</option>
                                <option value={18}>18K</option>
                                <option value={9}>9K</option>
                              </select>
                            </td>
                            <td>
                              <select 
                                value={item.metalType} 
                                onChange={e => handleItemFieldChange(item.sku, 'metalType', e.target.value)}
                                style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: '4px', padding: '2px 4px', fontSize: '0.75rem', color: 'var(--text-primary)', outline: 'none' }}
                              >
                                <option value="Y">Y</option>
                                <option value="R">R</option>
                                <option value="S">S</option>
                              </select>
                            </td>
                            <td>{item.grossWeight.toFixed(3)}</td>
                            <td>{item.netWeight.toFixed(3)}</td>
                            <td>{item.stoneWeight > 0 ? item.stoneWeight.toFixed(3) : '—'}</td>
                            <td>
                              <input
                                type="number" min={0} className="qty-input"
                                value={editingQty}
                                onChange={e => handleQtyChange(item.sku, e.target.value)}
                                onBlur={() => handleQtyBlur(item.sku)}
                                onKeyDown={e => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
                              />
                            </td>
                            <td style={{ color: 'var(--gold)', fontWeight: 600 }}>{(item.grossWeight * item.qty).toFixed(3)}</td>
                            <td style={{ textAlign: 'center' }}>
                              <button
                                className="btn btn-ghost"
                                style={{ color: 'var(--danger)', padding: '0.4rem', minWidth: 'auto', background: 'rgba(239,68,68,0.1)' }}
                                onClick={() => handleRemoveItem(item.sku)}
                                title="Remove Item"
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                                  <path d="M10 11v6M14 11v6M9 6V4h6v2"/>
                                </svg>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '1px solid var(--border-bright)', background: 'rgba(212,175,55,0.05)' }}>
                        <td colSpan={5} style={{ textAlign: 'right', padding: '0.65rem 0.75rem', fontWeight: 700, color: 'var(--gold-dim)', fontSize: '0.8rem' }}>TOTALS</td>
                        <td style={{ fontWeight: 700, textAlign: 'center', color: 'var(--text-primary)' }}>{totals.grossWt.toFixed(3)}</td>
                        <td style={{ fontWeight: 700, textAlign: 'center', color: 'var(--text-primary)' }}>{totals.netWt.toFixed(3)}</td>
                        <td style={{ fontWeight: 700, textAlign: 'center', color: 'var(--text-primary)' }}>{totals.stoneWt > 0 ? totals.stoneWt.toFixed(3) : '—'}</td>
                        <td style={{ fontWeight: 700, textAlign: 'center', color: 'var(--text-primary)' }}>{totals.qty}</td>
                        <td style={{ fontWeight: 700, textAlign: 'center', color: 'var(--gold)' }}>{totals.grossWt.toFixed(3)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
