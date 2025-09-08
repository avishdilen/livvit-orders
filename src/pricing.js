// Pricing + product catalog (final)
//
// - “13oz Vinyl Banner” → "Banner" (same pricing)
// - Adhesive renamed to “Adhesive Vinyl (Sticker)”
// - PVC 3mm removed; PVC 6/9/12/15 mm added
// - Dibond is 4mm only
// - Stand Up Banner fixed-size 33"x80"
// - A-Frame double-sided, white/black, 24x36"
// - Foam StandUp removed
//
// To attach an image: set `image: '/assets/yourfile.jpg'` (public or CDN URL).

export const PRODUCTS = [
  {
    code: 'banner',
    name: 'Banner',
    kind: 'flex',
    rateSqft: 6.75,
    minPrice: 0,
    quick: [[2,4],[3,6],[4,8],[8,3]],
    includes: { hems: true, grommets: true },
    dsMultiplier: 1.8,
    image: '',
  },
  {
    code: 'adhesive',
    name: 'Adhesive Vinyl (Sticker)',
    kind: 'flex',
    rateSqft: 7.50,
    minPrice: 0,
    quick: [[2,4],[3,6],[4,8]],
    lamination: { Matte: 2.0, Gloss: 2.0 },
    image: '',
  },

  // PVC rigid sheets (6/9/12/15mm)
  { code: 'pvc6',  name: 'PVC 6mm',  kind: 'rigid', rateSqft: 14.00, minPrice: 0,
    quick: [[18/12,24/12],[24/12,36/12],[36/12,48/12]], image: '' },
  { code: 'pvc9',  name: 'PVC 9mm',  kind: 'rigid', rateSqft: 17.00, minPrice: 0,
    quick: [[18/12,24/12],[24/12,36/12],[36/12,48/12]], image: '' },
  { code: 'pvc12', name: 'PVC 12mm', kind: 'rigid', rateSqft: 20.00, minPrice: 0,
    quick: [[18/12,24/12],[24/12,36/12],[36/12,48/12]], image: '' },
  { code: 'pvc15', name: 'PVC 15mm', kind: 'rigid', rateSqft: 24.00, minPrice: 0,
    quick: [[18/12,24/12],[24/12,36/12],[36/12,48/12]], image: '' },

  // Dibond (ACM) 4mm only
  { code: 'dibond4', name: 'Dibond 4mm', kind: 'rigid', rateSqft: 22.00, minPrice: 0,
    quick: [[24/12,36/12],[36/12,48/12]], image: '' },

  // Stand Up Banner (roll-up) — fixed size 33"x80", flat price
  {
    code: 'standup',
    name: 'Stand Up Banner (33" × 80")',
    kind: 'package',
    fixedPrice: 180.00, // set your real price
    fixedDims: { widthIn: 33, heightIn: 80 },
    note: 'Includes hardware & print. Fixed size.',
    image: '',
  },

  // A-Frame (double-sided white/black), 24x36", flat price
  {
    code: 'aframe',
    name: 'A-Frame Sign (Double-Sided 24" × 36")',
    kind: 'package',
    fixedPrice: 225.00, // set your real price
    options: { Color: ['White','Black'] }, // informational; not price-affecting
    fixedDims: { widthIn: 24, heightIn: 36 },
    note: 'Includes frame & two 24×36" inserts. Choose white or black frame.',
    image: '',
  },
]

export const VOLUME_BRACKETS = [
  { minQty: 50, pct: 0.15 },
  { minQty: 25, pct: 0.10 },
  { minQty: 10, pct: 0.05 },
]

export function ft(val, unit){ return unit==='in' ? (val/12) : val }
export function sqft(w, h){ return Math.max(0, w*h) }

export function discountPct(qty){
  for (const b of VOLUME_BRACKETS) if (qty>=b.minQty) return b.pct
  return 0
}

export function grommetEstimate(widthFt, heightFt){
  const perimIn = (widthFt + heightFt) * 2 * 12
  const est = Math.max(4, Math.ceil(perimIn/24))
  return est
}

export function calcLineTotal(line){
  const product = PRODUCTS.find(p=>p.code===line.product) || PRODUCTS[0]
  const wft = ft(line.width, line.unit)
  const hft = ft(line.height, line.unit)
  const area = sqft(wft, hft)

  let base = 0
  let breakdown = { baseRate: 0, area, addOns: [], volume: 0, ds: false, dsMult: 1, lam: null }

  if (product.kind==='package'){
    base = product.fixedPrice
    breakdown.baseRate = product.fixedPrice
  } else {
    const rate = product.rateSqft || 0
    breakdown.baseRate = rate
    base = area * rate
    if (product.minPrice) base = Math.max(product.minPrice, base)

    if (product.lamination && line.lam){
      const lamRate = product.lamination[line.lam] || 0
      const lamCost = area * lamRate
      base += lamCost
      breakdown.lam = { type: line.lam, lamRate, lamCost }
    }

    if (product.kind==='flex' && line.doubleSided){
      breakdown.ds = true
      breakdown.dsMult = product.dsMultiplier || 1.8
      base = base * breakdown.dsMult
    }
  }

  const pct = discountPct(line.qty||1)
  const discount = base * pct
  breakdown.volume = pct

  const perItem = Math.max(0, base - discount)
  const lineTotal = perItem * (line.qty||1)

  return { perItem, lineTotal, breakdown }
}
