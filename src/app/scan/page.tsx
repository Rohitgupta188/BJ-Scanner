'use client';

/**
 * Scanner page — opens on the same device as the dashboard.
 * URL: /scan
 *
 * On every successful decode:
 *   1. POST /api/scan  → server looks up SKU in catalog, returns product details
 *   2. Read localStorage("bj_items"), add/increment, write back
 *   3. Dashboard tab auto-updates via the "storage" event
 *
 * Barcode detection:
 *   Method A — BarcodeDetector (Chrome/Android, hardware-accelerated)
 *   Method B — jsQR fallback (Safari iOS, all other browsers)
 *
 * Dedup: same SKU ignored within 2 seconds to prevent double-scans.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SessionItem } from '@/lib/types';

const STORAGE_KEY = 'bj_items';

type ScanStatus = 'idle' | 'scanning' | 'success' | 'incremented' | 'not_found' | 'error';

interface Toast {
  key: number;
  message: string;
  status: 'success' | 'incremented' | 'not_found' | 'error';
}

// ─── localStorage helpers ────────────────────────────────────────────────────

function readItems(): SessionItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveItem(incoming: SessionItem) {
  const items = readItems();
  const idx   = items.findIndex(i => i.sku === incoming.sku);
  if (idx !== -1) {
    items[idx].qty += 1;
  } else {
    items.push(incoming);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  return idx !== -1 ? items[idx] : incoming;
}

// ─── Scanner page ─────────────────────────────────────────────────────────────

export default function ScannerPage() {
  const router = useRouter();
  const videoRef      = useRef<HTMLVideoElement>(null);
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const animFrameRef  = useRef<number | null>(null);
  const lastScannedRef = useRef<{ sku: string; time: number } | null>(null);
  const detectorRef   = useRef<any>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [facingMode, setFacingMode]   = useState<'environment' | 'user'>('environment');
  const [status, setStatus]           = useState<ScanStatus>('idle');
  const [toasts, setToasts]           = useState<Toast[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const toastKey = useRef(0);

  // ── Toast ──────────────────────────────────────────────────────────────────

  const addToast = useCallback((message: string, toastStatus: Toast['status']) => {
    const key = ++toastKey.current;
    setToasts(t => [...t, { key, message, status: toastStatus }]);
    setTimeout(() => setToasts(t => t.filter(x => x.key !== key)), 2500);
  }, []);

  // ── Submit SKU ─────────────────────────────────────────────────────────────

  const submitSku = useCallback(async (sku: string) => {
    setStatus('scanning');
    try {
      const res  = await fetch('/api/scan', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sku }),
      });
      const data = await res.json();

      if (data.action === 'not_found') {
        setStatus('not_found');
        addToast(`SKU not found: ${sku}`, 'not_found');
        return;
      }

      // Save to localStorage (increments qty if already exists)
      const saved    = saveItem(data.item as SessionItem);
      const isNewSku = saved.qty === 1;

      if (isNewSku) {
        setStatus('success');
        addToast(`Added: ${saved.designNumber} — ${saved.itemType}`, 'success');
      } else {
        setStatus('incremented');
        addToast(`Qty +1 → ${saved.designNumber} (×${saved.qty})`, 'incremented');
      }
    } catch {
      setStatus('error');
      addToast('Network error. Check connection.', 'error');
    } finally {
      setTimeout(() => setStatus('idle'), 1000);
    }
  }, [addToast]);

  // ── Scan loop ──────────────────────────────────────────────────────────────

  const startScanLoop = useCallback(async () => {
    if (!videoRef.current) return;

    // Try to init BarcodeDetector once
    if ('BarcodeDetector' in window && !detectorRef.current) {
      try {
        const formats = await (window as any).BarcodeDetector.getSupportedFormats();
        detectorRef.current = new (window as any).BarcodeDetector({
          formats: formats.length > 0 ? formats : ['qr_code', 'code_128', 'code_39', 'ean_13', 'upc_a'],
        });
      } catch {
        detectorRef.current = null;
      }
    }

    const tick = async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        animFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      let sku: string | null = null;

      // Method A: BarcodeDetector
      if (detectorRef.current) {
        try {
          const results = await detectorRef.current.detect(video);
          if (results.length > 0) sku = results[0].rawValue;
        } catch {
          detectorRef.current = null;
        }
      }

      // Method B: jsQR fallback
      if (!sku && canvasRef.current) {
        const canvas = canvasRef.current;
        const ctx    = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          canvas.width  = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          try {
            const jsQR  = (await import('jsqr')).default;
            const result = jsQR(imageData.data, imageData.width, imageData.height);
            if (result) sku = result.data;
          } catch { /* jsQR not available */ }
        }
      }

      // Dedup & submit
      if (sku) {
        const now  = Date.now();
        const last = lastScannedRef.current;
        if (!last || last.sku !== sku || now - last.time >= 2000) {
          lastScannedRef.current = { sku, time: now };
          await submitSku(sku);
        }
      }

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
  }, [submitSku]);

  // ── Camera init ────────────────────────────────────────────────────────────

  useEffect(() => {
    let stream: MediaStream | null = null;
    let mounted = true;

    async function initCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });

        if (!mounted) return;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          
          if (!mounted) return;
          setCameraReady(true);
          startScanLoop();
        }
      } catch (err: any) {
        if (!mounted || err.name === 'AbortError') return;
        
        if (err.name === 'NotAllowedError')  setCameraError('Camera permission denied. Please allow and reload.');
        else if (err.name === 'NotFoundError') setCameraError('No camera found on this device.');
        else setCameraError(`Camera error: ${err.message}`);
      }
    }

    initCamera();
    return () => {
      mounted = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [startScanLoop, facingMode]);

  // ── Flash colour ───────────────────────────────────────────────────────────

  const flashColor =
    status === 'success'     ? 'rgba(34,197,94,0.3)'  :
    status === 'incremented' ? 'rgba(96,165,250,0.3)'  :
    status === 'not_found' || status === 'error' ? 'rgba(239,68,68,0.3)' :
    'transparent';

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden' }}>
      {/* Camera feed */}
      <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

      {/* Hidden canvas for jsQR */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Scan flash overlay */}
      <div style={{ position: 'absolute', inset: 0, background: flashColor, transition: 'background 0.15s ease', pointerEvents: 'none' }} />

      {/* Dark gradient top/bottom */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.65) 0%, transparent 25%, transparent 72%, rgba(0,0,0,0.75) 100%)', pointerEvents: 'none' }} />

      {/* Viewfinder corners + scan line */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div className="corner corner-tl" />
        <div className="corner corner-tr" />
        <div className="corner corner-bl" />
        <div className="corner corner-br" />
        {cameraReady && <div className="scan-line" />}
      </div>

      {/* Header */}
      <div className="scan-header" style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <div style={{ fontWeight: 700, color: '#ffffff', fontSize: '1rem', textShadow: '0 1px 8px rgba(0,0,0,0.8)' }}>QR Scanner</div>
          <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.6)', marginTop: '1px' }}>Point camera at product QR code</div>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(0,0,0,0.45)', borderRadius: '99px', padding: '0.3rem 0.75rem', backdropFilter: 'blur(8px)' }}>
            {cameraReady && <span className="pulse-dot" />}
            <span style={{ fontSize: '0.72rem', color: '#fff' }}>{cameraReady ? 'Live' : 'Starting…'}</span>
          </div>
          <button
            onClick={() => setFacingMode(prev => prev === 'environment' ? 'user' : 'environment')}
            style={{ background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '99px', color: '#fff', fontSize: '0.72rem', padding: '0.3rem 0.75rem', cursor: 'pointer', backdropFilter: 'blur(8px)' }}
            title="Switch Camera"
          >
            🔄 Flip
          </button>
          <button
            onClick={() => router.push('/')}
            style={{ background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '99px', color: '#fff', fontSize: '0.72rem', padding: '0.3rem 0.75rem', cursor: 'pointer', backdropFilter: 'blur(8px)' }}
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>

      {/* Camera error */}
      {cameraError && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', background: 'rgba(0,0,0,0.85)' }}>
          <div className="card" style={{ maxWidth: '320px', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📷</div>
            <h2 style={{ fontWeight: 700, marginBottom: '0.5rem', color: 'var(--danger)' }}>Camera Error</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{cameraError}</p>
          </div>
        </div>
      )}

      {/* Bottom hint */}
      <div style={{ position: 'absolute', bottom: '2rem', left: 0, right: 0, textAlign: 'center', fontSize: '0.8rem', color: 'rgba(255,255,255,0.55)', textShadow: '0 1px 6px rgba(0,0,0,0.8)' }}>
        {status === 'scanning' ? '⏳ Processing…' : 'Scan automatically — no button needed'}
      </div>

      {/* Toasts */}
      <div style={{ position: 'absolute', bottom: '4.5rem', left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', zIndex: 100, width: '90%', maxWidth: '340px' }}>
        {toasts.map(t => (
          <div key={t.key} className="fade-in" style={{
            background: t.status === 'success' ? 'rgba(34,197,94,0.92)' : t.status === 'incremented' ? 'rgba(96,165,250,0.92)' : 'rgba(239,68,68,0.92)',
            color: '#fff', borderRadius: '10px', padding: '0.65rem 1.1rem', fontSize: '0.85rem', fontWeight: 500, width: '100%', textAlign: 'center', backdropFilter: 'blur(8px)', boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          }}>
            {t.status === 'success' ? '✅ ' : t.status === 'incremented' ? '🔄 ' : '❌ '}
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
