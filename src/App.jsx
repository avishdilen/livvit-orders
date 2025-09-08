import React, { useEffect, useMemo, useRef, useState } from "react";

// === DIRECT-TO-SUPABASE UPLOAD HELPERS ===
async function getSignedUpload(orderNo, filename) {
  const r = await fetch("/.netlify/functions/sign-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderNo, filename }),
  });
  const json = await r.json();
  if (!r.ok || json.error) {
    throw new Error(json.error || "sign-upload failed");
  }
  return json; // { signedUrl, path }
}

function makeOrderNo() {
  const d = new Date();
  const ymd = d.toISOString().slice(0,10).replace(/-/g,"");
  const rand = Math.random().toString(36).slice(2,6).toUpperCase();
  return `LIV-${ymd}-${rand}`;
}

async function uploadFileToSignedUrl(signedUrl, file) {
  const put = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!put.ok) throw new Error(`PUT failed: ${put.status}`);
}

// --- UI primitives ---
const Card = ({ className = "", children }) => (
  <div className={`rounded-2xl shadow-sm border border-gray-200 bg-white ${className}`}>{children}</div>
);
const CardHeader = ({ className = "", children }) => (
  <div className={`border-b border-gray-100 px-5 py-4 ${className}`}>{children}</div>
);
const CardTitle = ({ className = "", children }) => (
  <h3 className={`text-lg font-semibold ${className}`}>{children}</h3>
);
const CardContent = ({ className = "", children }) => (
  <div className={`px-5 py-4 ${className}`}>{children}</div>
);
const Button = ({ variant = "primary", className = "", ...props }) => {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed";
  const map = {
    primary: "bg-black text-white hover:bg-gray-900 active:translate-y-[1px] shadow-sm",
    outline: "bg-white border border-gray-300 text-gray-900 hover:bg-gray-50",
    ghost: "text-gray-700 hover:bg-gray-100",
    subtle: "bg-gray-100 text-gray-800 hover:bg-gray-200",
  };
  return <button className={`${base} ${map[variant]} ${className}`} {...props} />;
};
const Badge = ({ children, className = "" }) => (
  <span className={`inline-flex items-center rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 ${className}`}>{children}</span>
);
const Input = ({ className = "", ...props }) => (
  <input className={`w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-black/10 ${className}`} {...props} />
);
const Label = ({ children, htmlFor, className = "" }) => (
  <label htmlFor={htmlFor} className={`text-sm font-medium text-gray-700 ${className}`}>{children}</label>
);
const Switch = ({ checked, onChange }) => (
  <button type="button" onClick={() => onChange(!checked)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${checked ? "bg-black" : "bg-gray-300"}`} aria-pressed={checked}>
    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${checked ? "translate-x-6" : "translate-x-1"}`} />
  </button>
);

// --- helpers ---
const currency = (v) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number.isFinite(v) ? v : 0);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const toFeet = (val, unit) => (unit === "ft" ? val : val / 12);
const toInches = (val, unit) => (unit === "in" ? val : val * 12);
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const exampleSizes = {
  banner: [
    { w: 2, h: 4, unit: "ft" },
    { w: 3, h: 6, unit: "ft" },
    { w: 4, h: 8, unit: "ft" },
  ],
  adhesive: [
    { w: 24, h: 36, unit: "in" },
    { w: 48, h: 24, unit: "in" },
    { w: 60, h: 36, unit: "in" },
  ],
  coroplast: [
    { w: 18, h: 24, unit: "in" },
    { w: 24, h: 36, unit: "in" },
    { w: 36, h: 48, unit: "in" },
  ],
};

const PRODUCTS = {
  banner: {
    label: "13oz Vinyl Banner",
    basePerSqft: 5.5,
    allowLamination: false,
    allowDoubleSided: true,
    allowPolePockets: true,
    notes: "Outdoor promos. Hem + grommets optional.",
  },
  adhesive: {
    label: "Adhesive Vinyl (Print/Cut)",
    basePerSqft: 8.0,
    allowLamination: true,
    allowDoubleSided: false,
    allowPolePockets: false,
    notes: "Windows/walls/vehicles. Lamination optional.",
  },
  coroplast: {
    label: "Coroplast Sign 4mm",
    basePerSqft: 9.0,
    allowLamination: true,
    allowDoubleSided: true,
    allowPolePockets: false,
    notes: "Rigid yard signs. Double-sided supported.",
  },
};

function grommetEstimate(width, height, unit, spacingInches = 24) {
  const wIn = toInches(width, unit);
  const hIn = toInches(height, unit);
  const acrossW = Math.max(2, Math.ceil(wIn / spacingInches) + 1);
  const acrossH = Math.max(2, Math.ceil(hIn / spacingInches) + 1);
  const total = acrossW * 2 + acrossH * 2 - 4;
  return total;
}
function perimeterFeet(width, height, unit) {
  return 2 * (toFeet(width, unit) + toFeet(height, unit));
}
function polePocketFeet(width, height, unit, sides) {
  const len = {
    top: toFeet(width, unit),
    bottom: toFeet(width, unit),
    left: toFeet(height, unit),
    right: toFeet(height, unit),
  };
  return Object.entries(sides).reduce((acc, [k, v]) => (v ? acc + len[k] : acc), 0);
}

function buildPrice(config) {
  const {
    product, unit, width, height, quantity,
    opts: { hems, grommets, lamination, doubleSided, pocketSides, pocketSizeIn },
  } = config;

  const spec = PRODUCTS[product];
  const area = toFeet(width, unit) * toFeet(height, unit);
  const base = area * (spec?.basePerSqft || 0);

  const costs = {};
  if (hems && spec) costs.hems = perimeterFeet(width, height, unit) * 0.5; // $/lf
  if (grommets && spec) {
    const count = grommetEstimate(width, height, unit, 24);
    costs.grommets = count * 0.35; // each
    costs._grommetCount = count;
  }
  if (spec?.allowLamination && lamination) costs.lamination = area * 2.0;  // $/sqft

  if (spec?.allowPolePockets && Object.values(pocketSides).some(Boolean)) {
    const lf = polePocketFeet(width, height, unit, pocketSides);
    const sizeFactor = pocketSizeIn >= 3 ? 1 : 0.85;
    costs.polePockets = lf * 2.0 * sizeFactor; // $/lf
  }

  let itemSubtotal = base + Object.values(costs).filter((v) => typeof v === "number").reduce((a, b) => a + b, 0);

  if (spec?.allowDoubleSided && doubleSided) {
    const baseUp = base * 0.6; // ~1.6x base
    itemSubtotal += baseUp;
    costs.doubleSidedUpcharge = baseUp;
  }

  const minChargePerItem = 15;
  const perItem = Math.max(itemSubtotal, minChargePerItem);
  let subtotal = perItem * quantity;

  let discountRate = 0;
  if (quantity >= 50) discountRate = 0.12;
  else if (quantity >= 25) discountRate = 0.08;
  else if (quantity >= 10) discountRate = 0.05;

  const discount = subtotal * discountRate;
  const total = subtotal - discount;

  return { area, base, perItem, subtotal, discountRate, discount, total, costs };
}

const FilePreview = ({ file }) => {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (!file) return;
    if (file.type?.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setSrc(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setSrc(null);
    }
  }, [file]);
  const isImg = file?.type?.startsWith("image/");
  const ext = file?.name?.split(".").pop()?.toUpperCase();
  if (!file) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 p-3">
      <div className="h-14 w-14 overflow-hidden rounded-lg bg-gray-50 grid place-items-center">
        {isImg && src ? (
          <img src={src} alt={file.name} className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs text-gray-500">{ext || file.type || "FILE"}</span>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{file.name}</p>
        <p className="text-xs text-gray-500">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
      </div>
    </div>
  );
};

const ProductPills = ({ value, onChange }) => (
  <div className="inline-flex rounded-xl border border-gray-300 p-1">
    {Object.entries(PRODUCTS).map(([key, val]) => (
      <button
        key={key}
        onClick={() => onChange(key)}
        className={`px-3 py-1 text-xs sm:text-sm rounded-lg ${value === key ? "bg-black text-white" : "text-gray-700 hover:bg-gray-100"}`}
        title={val.label}
      >
        {val.label.split(" ")[0]}
      </button>
    ))}
  </div>
);

const UnitToggle = ({ value, onChange }) => (
  <div className="inline-flex rounded-xl border border-gray-300 p-1">
    {[
      { id: "ft", label: "ft" },
      { id: "in", label: "in" },
    ].map((u) => (
      <button
        key={u.id}
        onClick={() => onChange(u.id)}
        className={`px-3 py-1 text-sm rounded-lg ${value === u.id ? "bg-black text-white" : "text-gray-700 hover:bg-gray-100"}`}
      >
        {u.label}
      </button>
    ))}
  </div>
);

function LineItemCard({ idx, item, price, onChange, onRemove, onDuplicate, uploadRef, onOpenFile, onFileInputChange, onDropZone }) {
  const spec = PRODUCTS[item.product] || { label: item.product };
  const exSizes = exampleSizes[item.product] || []; // <-- safety default

  const toggleOpt = (key, val) => onChange({ opts: { ...item.opts, [key]: val } });
  const togglePocketSide = (side) => onChange({ opts: { ...item.opts, pocketSides: { ...item.opts.pocketSides, [side]: !item.opts.pocketSides[side] } } });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Item {idx + 1}</CardTitle>
            <p className="mt-1 text-sm text-gray-600">{spec.label}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="subtle" onClick={onDuplicate}>Duplicate</Button>
            <Button variant="outline" onClick={onRemove}>Remove</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6">
          <div className="grid items-end gap-4 lg:grid-cols-[auto_1fr_1fr_auto]">
            <div className="flex flex-col gap-2">
              <Label>Product</Label>
              <ProductPills
                value={item.product}
                onChange={(p) => {
                  const allow = PRODUCTS[p];
                  const next = { ...item, product: p };
                  next.unit = p === "banner" ? "ft" : item.unit;
                  next.opts = {
                    ...item.opts,
                    lamination: allow?.allowLamination ? item.opts.lamination : false,
                    doubleSided: allow?.allowDoubleSided ? item.opts.doubleSided : false,
                    pocketSides: allow?.allowPolePockets ? item.opts.pocketSides : { top: false, bottom: false, left: false, right: false },
                  };
                  onChange(next);
                }}
              />
            </div>
            <div>
              <Label htmlFor={`w-${item.id}`}>Width</Label>
              <Input id={`w-${item.id}`} type="number" min={item.unit === "in" ? 1 : 0.1} step="any" value={item.width}
                onChange={(e) => onChange({ width: clamp(parseFloat(e.target.value || 0), 0, item.unit === "in" ? 1000 : 100) })}
              />
            </div>
            <div>
              <Label htmlFor={`h-${item.id}`}>Height</Label>
              <Input id={`h-${item.id}`} type="number" min={item.unit === "in" ? 1 : 0.1} step="any" value={item.height}
                onChange={(e) => onChange({ height: clamp(parseFloat(e.target.value || 0), 0, item.unit === "in" ? 1000 : 100) })}
              />
            </div>
            <div className="flex items-center gap-3">
              <Label className="sr-only">Units</Label>
              <UnitToggle value={item.unit} onChange={(u) => onChange({ unit: u })} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-500">Quick sizes:</span>
            {exSizes.map((ex, i) => (
              <Button key={i} variant="subtle" onClick={() => onChange({ unit: ex.unit, width: ex.w, height: ex.h })} className="!py-1">
                {ex.w}{ex.unit} × {ex.h}{ex.unit}
              </Button>
            ))}
            <span className="ml-auto text-xs text-gray-500">Area per item: <strong>{price.area.toFixed(2)}</strong> sq ft</span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Hems</p>
                  <p className="text-xs text-gray-500">Reinforced edges for durability.</p>
                </div>
                <Switch checked={item.opts.hems} onChange={(v) => toggleOpt("hems", v)} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Grommets</p>
                  <p className="text-xs text-gray-500">Estimated every ~24” around edges.</p>
                </div>
                <Switch checked={item.opts.grommets} onChange={(v) => toggleOpt("grommets", v)} />
              </div>
              {PRODUCTS[item.product]?.allowLamination && (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Lamination</p>
                    <p className="text-xs text-gray-500">Adds scratch/UV resistance.</p>
                  </div>
                  <Switch checked={item.opts.lamination} onChange={(v) => toggleOpt("lamination", v)} />
                </div>
              )}
              {PRODUCTS[item.product]?.allowDoubleSided && (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Double-Sided Print</p>
                    <p className="text-xs text-gray-500">Two-way visibility.</p>
                  </div>
                  <Switch checked={item.opts.doubleSided} onChange={(v) => toggleOpt("doubleSided", v)} />
                </div>
              )}
            </div>

            {PRODUCTS[item.product]?.allowPolePockets && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Pole Pockets</p>
                    <p className="text-xs text-gray-500">Select sides & pocket size.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {["top", "bottom", "left", "right"].map((side) => (
                      <button key={side} onClick={() => onChange({ opts: { ...item.opts, pocketSides: { ...item.opts.pocketSides, [side]: !item.opts.pocketSides[side] } } })} className={`rounded-xl border px-2.5 py-1 text-xs capitalize ${item.opts.pocketSides[side] ? "bg-black text-white border-black" : "border-gray-300 hover:bg-gray-50"}`}>
                        {side}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <div>
                    <Label htmlFor={`pocket-${item.id}`}>Pocket Size (in)</Label>
                    <Input id={`pocket-${item.id}`} type="number" min={1} max={6} value={item.opts.pocketSizeIn}
                      onChange={(e) => onChange({ opts: { ...item.opts, pocketSizeIn: clamp(parseInt(e.target.value || 0), 1, 6) } })} />
                  </div>
                  <div className="pt-6"><Badge>{Object.values(item.opts.pocketSides).filter(Boolean).length || 0} side(s)</Badge></div>
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor={`qty-${item.id}`}>Quantity</Label>
              <Input id={`qty-${item.id}`} type="number" min={1} value={item.quantity} onChange={(e) => onChange({ quantity: clamp(parseInt(e.target.value || 1), 1, 9999) })} />
              <p className="mt-2 text-xs text-gray-500">Volume discounts apply per line (10/25/50+).</p>
            </div>
            <div>
              <Label>Upload Design (max 5 files)</Label>
              <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDropZone(e)} className="mt-1 grid place-items-center rounded-2xl border-2 border-dashed border-gray-300 p-6 text-center hover:border-gray-400">
                <p className="text-sm text-gray-600">Drag & drop files here</p>
                <p className="text-xs text-gray-500">PDF, AI, EPS, SVG, PNG, JPG up to ~50MB each</p>
                <Button variant="outline" className="mt-3" onClick={onOpenFile}>Browse files</Button>
                <input ref={uploadRef} type="file" hidden multiple accept="application/pdf,application/postscript,application/illustrator,.ai,.eps,.svg,image/*" onChange={onFileInputChange} />
              </div>
              {item.files?.length > 0 && (
                <div className="mt-3 grid gap-2">
                  {item.files.map((f, i) => (
                    <div key={i} className="flex items-center justify-between gap-3">
                      <FilePreview file={f} />
                      <Button variant="ghost" onClick={() => onChange({ files: item.files.filter((_, idx) => idx !== i) })}>Remove</Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:gap-3">
                <span>Per item: <strong>{currency(price.perItem)}</strong></span>
                <span className="text-gray-500">Base {currency(price.base)}{price.costs?._grommetCount ? ` • ${price.costs._grommetCount} grommets est.` : ""}</span>
              </div>
              <div className="text-right">
                {price.discount > 0 && (
                  <div className="text-emerald-700">Discount ({Math.round(price.discountRate * 100)}%): -{currency(price.discount)}</div>
                )}
                <div className="font-semibold">Line total: {currency(price.total)}</div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function App() {
  const makeDefaultItem = (product = "banner") => ({
    id: uid(),
    product,
    unit: product === "banner" ? "ft" : "in",
    width: product === "banner" ? 6 : 24,
    height: product === "banner" ? 3 : 36,
    quantity: 1,
    opts: {
      hems: true,
      grommets: true,
      lamination: PRODUCTS[product].allowLamination ? false : false,
      doubleSided: PRODUCTS[product].allowDoubleSided ? false : false,
      pocketSides: { top: false, bottom: false, left: false, right: false },
      pocketSizeIn: 3,
    },
    files: [],
  });

  const [items, setItems] = useState([makeDefaultItem("banner")]);
  const [customer, setCustomer] = useState({ name: "", email: "", phone: "" });
  const [showCheckout, setShowCheckout] = useState(false);
  const [orderNo, setOrderNo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState("");

  // Bank transfer details — EDIT THESE
  const BANK = {
    beneficiary: "Livvitt Plus N.V.",
    bankName: "Your Bank Name",
    account: "0000000000",
    iban: "",
    swift: "",
    currency: "USD",
    note: "Use the ORDER NUMBER as the payment reference.",
  };

  const uploadRefs = useRef({});

  const setItem = (idx, patch) => {
    setItems((prev) =>
      prev.map((it, i) =>
        i !== idx
          ? it
          : typeof patch === "function"
          ? patch(it)
          : {
              ...it,
              ...patch,
              ...(patch?.opts ? { opts: { ...it.opts, ...patch.opts } } : {}),
            }
      )
    );
  };

  const addItem = () => setItems((prev) => [...prev, makeDefaultItem(prev[prev.length - 1]?.product || "banner")]);
  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));
  const duplicateItem = (idx) => setItems((prev) => {
    const copy = JSON.parse(JSON.stringify(prev[idx]));
    copy.id = uid();
    return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
  });

  const onFileInputChange = (idx, e) => {
    const list = Array.from(e.target.files || []);
    if (list.length) setItem(idx, (it) => ({ ...it, files: [list[0]] })); // keep 1
  };
  const onDrop = (idx, e) => {
    e.preventDefault();
    const list = Array.from(e.dataTransfer.files || []);
    if (list.length) setItem(idx, (it) => ({ ...it, files: [list[0]] })); // keep 1
  };

  const itemPrices = useMemo(() => items.map((it) => buildPrice(it)), [items]);
  const orderSubtotal = itemPrices.reduce((a, p) => a + p.subtotal, 0);
  const orderDiscount = itemPrices.reduce((a, p) => a + p.discount, 0);
  const orderTotal = itemPrices.reduce((a, p) => a + p.total, 0);

  const valid = items.length > 0 && items.every((it) => it.width > 0 && it.height > 0 && it.quantity >= 1) && customer.email && customer.name;

  const downloadOrder = () => {
    const data = {
      timestamp: new Date().toISOString(),
      orderNo: orderNo || makeOrderNo(),
      customer,
      items: items.map((it, i) => ({
        ...it,
        productLabel: PRODUCTS[it.product].label,
        areaSqFtPerItem: itemPrices[i].area,
        priceBreakdown: itemPrices[i],
        files: (it.files || []).map((f) => ({ name: f.name, type: f.type, sizeBytes: f.size })),
      })),
      totals: { orderSubtotal, orderDiscount, orderTotal },
      bank: BANK,
      disclaimer: "Demo only. To email & store files, connect the Netlify Function.",
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = `${customer.name || "order"}`.replace(/[^a-z0-9-_]+/gi, "-");
    a.download = `${safeName}-custom-print-order.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // submit
  const submitOrder = async () => {
    try {
      setSubmitting(true);
      setSubmitMsg("");

      const currentOrderNo = orderNo || makeOrderNo();
      if (!orderNo) setOrderNo(currentOrderNo);

      // direct uploads
      const uploadedPaths = [];
      for (const it of items) {
        for (const file of (it.files || [])) {
          const MAX_MB = 100;
          if (file.size > MAX_MB * 1024 * 1024) throw new Error(`"${file.name}" exceeds ${MAX_MB}MB limit.`);
          const { signedUrl, path } = await getSignedUpload(currentOrderNo, file.name);
          await uploadFileToSignedUrl(signedUrl, file);
          uploadedPaths.push(path);
        }
      }

      const meta = {
        timestamp: new Date().toISOString(),
        orderNo: currentOrderNo,
        customer,
        items: items.map((it, i) => ({
          ...it,
          productLabel: PRODUCTS[it.product].label,
          areaSqFtPerItem: itemPrices[i].area,
          priceBreakdown: itemPrices[i],
        })),
        totals: { orderSubtotal, orderDiscount, orderTotal },
        bank: BANK,
      };

      const res = await fetch("/.netlify/functions/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meta, uploadedPaths }),
      });

      if (!res.ok) throw new Error(`create-order failed: ${await res.text()}`);
      await res.json();
      setSubmitMsg("Order sent! Check your inbox for confirmation.");
    } catch (e) {
      console.warn("Submit error:", e);
      setSubmitMsg(e.message || "Something went wrong while sending your order.");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (showCheckout && !orderNo) setOrderNo(makeOrderNo());
  }, [showCheckout]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white text-gray-900">
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-black text-white font-bold">L</div>
            <div>
              <p className="text-lg font-semibold">Livvitt — Custom Print Ordering</p>
              <p className="text-xs text-gray-500">Multi-item banners & signs configurator</p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2">
            <Badge>Netlify</Badge>
            <Badge>Instant Pricing</Badge>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-5 py-8">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex flex-col justify-center">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              Order custom <span className="underline decoration-amber-400 decoration-4 underline-offset-4">banners</span> & <span className="underline decoration-sky-400 decoration-4 underline-offset-4">signs</span> online
            </h1>
            <p className="mt-3 text-gray-600">Add multiple line items with different sizes, quantities, and finishing. Upload separate files per line and get live pricing.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Badge>Mix products per order</Badge>
              <Badge>Per-line volume discounts</Badge>
              <Badge>Bank transfer checkout</Badge>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-5 pb-16 md:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {items.map((item, idx) => (
            <LineItemCard
              key={item.id}
              idx={idx}
              item={item}
              price={itemPrices[idx]}
              onChange={(patch) => setItem(idx, patch)}
              onRemove={() => removeItem(idx)}
              onDuplicate={() => duplicateItem(idx)}
              uploadRef={(el) => (uploadRefs.current[idx] = el)}
              onOpenFile={() => uploadRefs.current[idx]?.click()}
              onFileInputChange={(e) => onFileInputChange(idx, e)}
              onDropZone={(e) => onDrop(idx, e)}
            />
          ))}

          <div className="flex items-center justify-between gap-3">
            <Button variant="subtle" onClick={addItem}>+ Add another item</Button>
            <p className="text-xs text-gray-500">Need stakes or hardware? Add a note in checkout (demo).</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Contact Details</CardTitle>
              <p className="mt-1 text-sm text-gray-600">We’ll email your confirmation & proof (if needed).</p>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" value={customer.name} onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))} placeholder="Jane Smith" />
                </div>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={customer.email} onChange={(e) => setCustomer((c) => ({ ...c, email: e.target.value }))} placeholder="you@example.com" />
                </div>
                <div>
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" value={customer.phone} onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))} placeholder="(555) 555-5555" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="md:sticky md:top-20 h-max">
          <Card className="overflow-hidden">
            <CardHeader className="bg-gray-50">
              <CardTitle>Order Summary</CardTitle>
              <p className="mt-1 text-sm text-gray-600">{items.length} line item{items.length !== 1 ? "s" : ""}</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {items.map((it, i) => (
                  <div key={it.id} className="flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{PRODUCTS[it.product]?.label || it.product}</p>
                      <p className="text-gray-500">{it.width}{it.unit} × {it.height}{it.unit} • Qty {it.quantity}</p>
                    </div>
                    <div className="text-right whitespace-nowrap font-semibold">{currency(itemPrices[i].total)}</div>
                  </div>
                ))}

                <div className="my-2 border-t" />
                <div className="flex items-center justify-between text-sm">
                  <span>Subtotal</span>
                  <span className="font-semibold">{currency(orderSubtotal)}</span>
                </div>
                {orderDiscount > 0 && (
                  <div className="flex items-center justify-between text-sm text-emerald-700">
                    <span>Line discounts</span>
                    <span>-{currency(orderDiscount)}</span>
                  </div>
                )}
                <div className="my-2 border-t" />
                <div className="flex items-center justify-between">
                  <span className="text-base font-semibold">Total</span>
                  <span className="text-lg font-bold">{currency(orderTotal)}</span>
                </div>
                <p className="text-xs text-gray-500">Tax & shipping calculated at checkout. Turnaround ETA provided after file review.</p>

                <div className="mt-4 grid gap-2">
                  <Button onClick={() => setShowCheckout(true)} disabled={!valid}>Place Order (Bank Transfer)</Button>
                  <Button variant="outline" onClick={downloadOrder} disabled={!customer.name || !customer.email}>Download Order JSON</Button>
                  <Button variant="ghost" onClick={() => { setCustomer({ name: "", email: "", phone: "" }); }}>Reset Contact</Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="mt-3 text-xs text-gray-500">
            <p>By placing an order you agree to our print guidelines (safe margins, color variance ±10%).</p>
          </div>
        </div>
      </section>

      {showCheckout && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between border-b px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold">Review & Pay by Bank Transfer</h3>
                <p className="text-xs text-gray-500">Use the order number as your payment reference.</p>
              </div>
              <Button variant="ghost" onClick={() => setShowCheckout(false)} aria-label="Close">✕</Button>
            </div>
            <div className="px-6 py-4 text-sm">
              <div className="rounded-xl bg-gray-50 p-3 mb-3">
                <div className="flex items-center justify-between">
                  <span>Order No.</span>
                  <span className="font-semibold">{orderNo}</span>
                </div>
              </div>

              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={it.id} className="flex items-center justify-between gap-3">
                    <span className="truncate">{PRODUCTS[it.product]?.label || it.product} — {it.width}{it.unit} × {it.height}{it.unit} × {it.quantity}</span>
                    <span className="font-medium">{currency(itemPrices[i].total)}</span>
                  </div>
                ))}
              </div>
              <div className="my-3 border-t" />
              <div className="flex items-center justify-between">
                <span>Order Total</span>
                <span className="text-base font-semibold">{currency(orderTotal)}</span>
              </div>

              {submitMsg && (
                <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">{submitMsg}</div>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <Button variant="outline" onClick={downloadOrder}>Download Order JSON</Button>
                <Button onClick={submitOrder} disabled={submitting}>{submitting ? "Sending..." : "Confirm & Send Order"}</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-gray-200 py-8 mt-10">
        <div className="mx-auto max-w-6xl px-5 text-sm text-gray-600">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} Livvitt — Demo Experience</p>
            <p className="text-xs">Deploy on Netlify, set env vars, and you’re live.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
