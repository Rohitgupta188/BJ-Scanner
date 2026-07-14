/**
 * POST /api/scan
 * Body: { sku: string }
 *
 * Looks up the SKU in the catalog (read-only).
 * Returns the product details — the client stores them in localStorage.
 * No session, no token, no DB writes.
 *
 * Response:
 *   200 — { action: "found", item: SessionItem }
 *   404 — { action: "not_found", sku }
 *   400 — missing sku
 *   500 — server error
 */

import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { Product } from '@/models/Product.model';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sku: string = (body?.sku ?? '').trim();

    if (!sku) {
      return NextResponse.json({ error: 'sku is required' }, { status: 400 });
    }

    await connectDB();

    // 1. First, extract the SKU if it happens to be a URL
    let cleanSku = sku.trim();
    if (cleanSku.includes('/scan/')) {
      cleanSku = cleanSku.split('/scan/').pop() || cleanSku;
    }
    if (cleanSku.includes('?')) {
      cleanSku = cleanSku.split('?')[0];
    }

    // 2. Now escape it for safe Regex searching
    const escaped = cleanSku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 3. Do your safe case-insensitive search
    const product = await Product.findOne({
      $or: [
        { sku: { $regex: `^${escaped}$`, $options: 'i' } },
        { designNumber: { $regex: `^${escaped}$`, $options: 'i' } },
        { rfid: { $regex: `^${escaped}$`, $options: 'i' } },
      ],
    }).lean();



    if (!product) {
      return NextResponse.json({ action: 'not_found', sku }, { status: 404 });
    }

    const grossWeight = product.grossWeight ?? 0;
    const netWeight = product.netWeight ?? 0;

    return NextResponse.json({
      action: 'found',
      item: {
        sku: product.sku || sku,
        designNumber: product.designNumber || sku,
        itemType: product.itemType || 'Unknown',
        metalPurity: product.metalPurity || '',
        metalType: product.metalType || '',
        grossWeight,
        netWeight,
        stoneWeight: product.stoneWeight ?? Math.max(0, grossWeight - netWeight),
        imageUrl: product.imageUrl || '',
        qty: 1,
      },
    });
  } catch (err) {
    console.error('[POST /api/scan]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
