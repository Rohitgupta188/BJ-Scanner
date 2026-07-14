/**
 * generatePdf.ts — Client-side PDF builder using jspdf + jspdf-autotable.
 *
 * Produces a two-section PDF in the Brahammand Jewels format:
 *   Section 1: Summary table (grouped by itemType)
 *   Section 2: Detail table (one row per item, with thumbnail)
 *
 * Images are fetched via /api/image-proxy to avoid CORS blocks from ImageKit.
 * Called from the browser only — NOT imported in any server file.
 */

import type { SessionItem } from './types';

// ─── Colours ──────────────────────────────────────────────────────────────────

const DARK_R = 26,  DARK_G = 26,  DARK_B = 46;   // #1a1a2e
const GOLD_R = 197, GOLD_G = 160, GOLD_B = 89;    // #C5A059
const ALT_R  = 249, ALT_G  = 246, ALT_B  = 240;   // #f9f6f0 alternating row

// ─── Image → base64 (via proxy to avoid CORS) ────────────────────────────────

async function toBase64(url: string): Promise<string | null> {
  if (!url) return null;
  try {
    const proxyUrl = `/api/image-proxy?url=${encodeURIComponent(url)}`;
    const resp = await fetch(proxyUrl);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function downloadPdf(items: SessionItem[]): Promise<void> {
  if (!items.length) throw new Error('NO_ITEMS');

  // Dynamic imports — large libs, only load when needed
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PAGE_W = 210;
  const MARGIN  = 10;

  // ── Section 1: Summary ──────────────────────────────────────────────────────

  doc.setFontSize(11);
  doc.setTextColor(DARK_R, DARK_G, DARK_B);
  doc.setFont('helvetica', 'bold');
  doc.text('Summary', MARGIN, 16);

  // Group by itemType
  const groups = new Map<string, { qty: number; grossWt: number; netWt: number }>();
  for (const item of items) {
    const g = groups.get(item.itemType) ?? { qty: 0, grossWt: 0, netWt: 0 };
    g.qty     += item.qty;
    g.grossWt += item.grossWeight * item.qty;
    g.netWt   += item.netWeight   * item.qty;
    groups.set(item.itemType, g);
  }

  let totalQty = 0, totalGross = 0, totalNet = 0;
  const summaryRows: (string | number)[][] = [];
  let sr = 1;

  for (const [type, g] of groups) {
    totalQty   += g.qty;
    totalGross += g.grossWt;
    totalNet   += g.netWt;
    summaryRows.push([sr++, type, g.qty, g.grossWt.toFixed(3), g.netWt.toFixed(3)]);
  }

  summaryRows.push([
    '',
    `Total — Approx. ${totalGross.toFixed(2)} gms`,
    totalQty,
    totalGross.toFixed(3),
    totalNet.toFixed(3),
  ]);

  autoTable(doc, {
    startY: 20,
    head: [['Sr.', 'Item Type', 'Qty', 'Gross Wt (g)', 'Net Wt (g)']],
    body: summaryRows,
    margin: { left: MARGIN, right: MARGIN },
    tableWidth: PAGE_W - MARGIN * 2,
    theme: 'grid',
    styles: { fontSize: 8, halign: 'center', cellPadding: 2, lineWidth: 0.2, lineColor: [0, 0, 0] },
    headStyles: {
      fillColor: [DARK_R, DARK_G, DARK_B],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: { fillColor: [ALT_R, ALT_G, ALT_B] },
    didParseCell(data) {
      if (data.row.index === summaryRows.length - 1 && data.section === 'body') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [232, 223, 200];
      }
    },
  });

  // ── Section 2: Detail ───────────────────────────────────────────────────────

  // @ts-expect-error — jspdf-autotable attaches lastAutoTable at runtime
  const afterSummary = (doc.lastAutoTable?.finalY ?? 60) + 10;

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(DARK_R, DARK_G, DARK_B);
  doc.text('Detail', MARGIN, afterSummary);

  // Pre-fetch all images in parallel
  const images = await Promise.all(items.map((item) => toBase64(item.imageUrl)));

  const detailRows = items.map((item, idx) => [
    idx + 1,
    '',
    item.designNumber,
    item.metalPurity,
    item.metalType,
    (item.grossWeight * item.qty).toFixed(3),
    (item.netWeight   * item.qty).toFixed(3),
    item.stoneWeight > 0 ? (item.stoneWeight * item.qty).toFixed(3) : '—',
    item.qty,
  ]);

  const IMAGE_COL = 1;
  const ROW_H     = 45;

  autoTable(doc, {
    startY: afterSummary + 4,
    head: [['Sr', 'Image', 'Design No', 'KT', 'Color', 'Gross Wt', 'Net Wt', 'S Wt', 'Qty']],
    body: detailRows,
    margin: { left: MARGIN, right: MARGIN },
    tableWidth: PAGE_W - MARGIN * 2,
    columnStyles: { [IMAGE_COL]: { cellWidth: 45 } },
    theme: 'grid',
    styles: { fontSize: 8, halign: 'center', valign: 'middle', cellPadding: 2, lineWidth: 0.2, lineColor: [0, 0, 0] },
    bodyStyles: { minCellHeight: ROW_H },
    headStyles: {
      fillColor: [DARK_R, DARK_G, DARK_B],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      valign: 'middle',
    },
    alternateRowStyles: { fillColor: [ALT_R, ALT_G, ALT_B] },
    didDrawCell(data) {
      if (data.section !== 'body' || data.column.index !== IMAGE_COL) return;
      const b64 = images[data.row.index];
      if (!b64) return;
      const { x, y, width, height } = data.cell;
      const pad = 3;
      const size = Math.min(width - pad * 2, height - pad * 2);
      const imgX = x + (width - size) / 2;
      const imgY = y + (height - size) / 2;
      try {
        doc.addImage(b64, 'JPEG', imgX, imgY, size, size);
      } catch {
        // Image decode failed — leave cell blank
      }
    },
  });

  const fileName = `BJ_Scan_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(fileName);
}