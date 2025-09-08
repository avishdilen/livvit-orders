import React, { useMemo, useState, useEffect } from 'react'
import { nanoid } from 'nanoid'
import { PRODUCTS, VOLUME_BRACKETS, calcLineTotal, grommetEstimate, ft } from './pricing.js'
import { uploadFiles } from './uploader.js'

const CURRENCY = import.meta.env.VITE_CURRENCY || 'USD'
const currency = n => new Intl.NumberFormat(undefined, { style:'currency', currency: CURRENCY }).format(n)

function makeOrderNo(){
  const d = new Date()
  const pad = n => String(n).padStart(2,'0')
  return `LIV-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${Math.random().toString(36).slice(2,6).toUpperCase()}`
}

const emptyLine = (p=PRODUCTS[0]) => ({
  id: nanoid(6),
  product: p.code,
  width: p.fixedDims ? (p.fixedDims.widthIn/12) : 6,
  height: p.fixedDims ? (p.fixedDims.heightIn/12) : 3,
  unit: 'ft',
  hems: p.includes?.hems ?? false,
  grommets: p.includes?.grommets ?? false,
  polePockets: { top:false, bottom:false, left:false, right:false, sizeIn:3 },
  doubleSided: false,
  lam: null,
  opts: {},      // generic product options (e.g., color)
  qty: 1,
  uploads: []
})

const LOCAL_KEY = 'livvitt:order-draft'

export default function App(){
  const [contact, setContact] = useState({ name:'', email:'', phone:'' })
  const [items, setItems] = useState([ emptyLine() ])
  const [note, setNote] = useState('')
  const [draftId, setDraftId] = useState(nanoid(10))
  const [placing, setPlacing] = useState(false)
  const [placed, setPlaced] = useState(null) // orderNo

  // Load draft
  useEffect(()=>{
    try{
      const raw = localStorage.getItem(LOCAL_KEY)
      if(raw){
        const v = JSON.parse(raw)
        if(v.contact) setContact(v.contact)
        if(v.items?.length) setItems(v.items)
        if(v.draftId) setDraftId(v.draftId)
        if(v.note) setNote(v.note)
      }
    }catch{}
  },[])

  useEffect(()=>{
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ contact, items, draftId, note }))
  }, [contact, items, draftId, note])

  const totals = useMemo(()=>{
    let subtotal = 0
    const perLine = items.map(line=>{
      const res = calcLineTotal(line)
      subtotal += res.lineTotal
      return res
    })
    return { perLine, subtotal, total: subtotal }
  }, [items])

  if(placed){
    return <ThankYou orderNo={placed} total={totals.total} />
  }

  return (
    <div>
      <header className="border-b bg-white">
        <div className="mx-auto max-w-6xl px-5 py-6">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-black grid place-items-center text-white font-bold">L</div>
            <div>
              <h1 className="text-2xl font-bold">Livvitt — Custom Print Ordering</h1>
              <p className="text-sm text-gray-600">Multi-item banners & signs configurator</p>
            </div>
            <div className="ml-auto flex gap-2">
              <span className="pill">Netlify</span>
              <span className="pill">Instant Pricing</span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6 grid lg:grid-cols-[1fr_380px] gap-6">
        <section className="space-y-4">
          <h2 className="text-2xl font-bold">Order custom <span className="underline decoration-yellow-400">banners & signs</span> online</h2>
          <p className="text-gray-600">Add multiple line items with different sizes, quantities, and finishing.
            Upload separate files per line and get live pricing.</p>

          <div className="flex gap-2 flex-wrap">
            <span className="chip">Mix products per order</span>
            <span className="chip">Per-line volume discounts</span>
            <span className="chip">Bank transfer checkout</span>
          </div>

          <div className="space-y-6">
            {items.map((line, idx)=>(
              <ItemCard key={line.id} idx={idx} line={line}
                onChange={(v)=>setItems(items.map((x,i)=>i===idx?v:x))}
                onDuplicate={()=>setItems([...items.slice(0,idx+1), {...line, id:nanoid(6)}, ...items.slice(idx+1)])}
                onRemove={()=>setItems(items.length===1?items:[...items.slice(0,idx), ...items.slice(idx+1)])}
                draftId={draftId}
              />
            ))}
            <button className="btn" onClick={()=>setItems([...items, emptyLine()])}>+ Add another item</button>
          </div>

          <ContactBlock contact={contact} setContact={setContact} />
          <div className="panel p-4">
            <label className="block text-sm font-semibold mb-1">Order notes</label>
            <textarea className="w-full border rounded-md p-2" rows={3} placeholder="E.g., add stakes/hardware or deadline info" value={note} onChange={e=>setNote(e.target.value)} />
          </div>
        </section>

        <aside>
          <OrderSummary items={items} totals={totals} />
          <CheckoutBox
            items={items} totals={totals} contact={contact} note={note}
            onPlaced={(no)=>setPlaced(no)} placing={placing} setPlacing={setPlacing}
            draftId={draftId}
          />
          <div className="text-center mt-2">
            <button className="text-xs text-gray-500 underline" onClick={()=>{
              setContact({name:'',email:'',phone:''})
            }}>Reset Contact</button>
          </div>
        </aside>
      </main>

      <footer className="border-t text-xs text-gray-600">
        <div className="mx-auto max-w-6xl px-5 py-8 sm:flex-row sm:items-center sm:justify-between flex flex-col gap-3">
          <p>© {new Date().getFullYear()} Livvitt</p>
          <p>Deployed on Netlify, uses Supabase storage for orders.</p>
        </div>
      </footer>
    </div>
  )
}

function ItemCard({ line, idx, onChange, onDuplicate, onRemove, draftId }){
  const product = useMemo(()=>PRODUCTS.find(p=>p.code===line.product)||PRODUCTS[0], [line.product])
  const res = useMemo(()=>calcLineTotal(line), [line])
  const perItem = res.perItem
  const area = res.breakdown.area
  const isFixed = !!product.fixedDims
  const estGrommets = useMemo(()=>grommetEstimate(ft(line.width, line.unit), ft(line.height, line.unit)), [line.width, line.height, line.unit])

  const quick = product.quick || []

  const set = (patch)=>onChange({ ...line, ...patch })

  // if switching product, reset to defaults of new product
  function chooseProduct(code){
    const p = PRODUCTS.find(x=>x.code===code) || PRODUCTS[0]
    onChange({
      ...emptyLine(p),
      id: line.id, // keep same card id
      qty: line.qty, // preserve qty when switching
      uploads: line.uploads, // keep uploaded files tied to this line
      opts: line.opts
    })
  }

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          {product.image ? <img src={product.image} alt="" className="w-10 h-10 rounded-md border object-cover" /> : null}
          <div>
            <div className="text-sm text-gray-500">Item {idx+1}</div>
            <div className="font-semibold">{product.name}</div>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="pill" onClick={onDuplicate}>Duplicate</button>
          <button className="pill" onClick={onRemove}>Remove</button>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="space-y-2">
          <label className="block text-sm font-semibold">Product</label>
          <div className="flex flex-wrap gap-1">
            {PRODUCTS.map(p=>(
              <button key={p.code} className={`pill ${p.code===line.product?'ring-1 ring-black':''}`} onClick={()=>chooseProduct(p.code)}>{p.name.split(' ')[0]}</button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold">Width</label>
          <div className="flex gap-2">
            <input className="w-full border rounded-md p-2" type="number" min="0.1" step="0.1"
              value={isFixed ? (line.unit==='in' ? product.fixedDims.widthIn : product.fixedDims.widthIn/12) : line.width}
              onChange={e=>!isFixed && set({width: Number(e.target.value)})}
              readOnly={isFixed}
            />
            <UnitToggle unit={line.unit} setUnit={(u)=>set({unit:u})} />
          </div>
          {!isFixed && (
            <div className="flex flex-wrap gap-2 mt-2">
              {quick.map(([w,h])=>(
                <button key={`${w}x${h}`} className="pill text-sm" onClick={()=>set({width: w, height: h, unit:'ft'})}>
                  {Math.round(w)}ft × {Math.round(h)}ft
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold">Height</label>
          <input className="w-full border rounded-md p-2" type="number" min="0.1" step="0.1"
            value={isFixed ? (line.unit==='in' ? product.fixedDims.heightIn : product.fixedDims.heightIn/12) : line.height}
            onChange={e=>!isFixed && set({height: Number(e.target.value)})}
            readOnly={isFixed}
          />
          {!isFixed && <div className="text-xs text-gray-500 mt-1">Area per item: <strong>{area.toFixed(2)}</strong> sq ft</div>}
        </div>
      </div>

      {product.kind==='flex' && (
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="block text-sm font-semibold">Hems</label>
            <Toggle checked={line.hems} onChange={v=>set({hems:v})} />
            <div className="text-xs text-gray-500">Reinforced edges for durability.</div>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-semibold">Grommets</label>
            <Toggle checked={line.grommets} onChange={v=>set({grommets:v})} />
            <div className="text-xs text-gray-500">Estimated every ~24″. Est: {estGrommets}</div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold">Pole Pockets</label>
            <div className="flex flex-wrap gap-2">
              {['top','bottom','left','right'].map(s=>(
                <label key={s} className="pill text-sm">
                  <input type="checkbox" className="mr-1" checked={line.polePockets[s]} onChange={e=>set({ polePockets: { ...line.polePockets, [s]: e.target.checked } })} />
                  {s[0].toUpperCase()+s.slice(1)}
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">Pocket Size (in)</span>
              <input className="w-24 border rounded-md p-2" type="number" min="1" step="0.5" value={line.polePockets.sizeIn} onChange={e=>set({ polePockets: { ...line.polePockets, sizeIn: Number(e.target.value) }})} />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold">Double‑Sided Print</label>
            <Toggle checked={line.doubleSided} onChange={v=>set({doubleSided:v})} />
            <div className="text-xs text-gray-500">Two‑way visibility.</div>
          </div>
        </div>
      )}

      {product.lamination && (
        <div className="mt-4 space-y-2">
          <label className="block text-sm font-semibold">Lamination</label>
          <div className="flex gap-2">
            {Object.keys(product.lamination).map(k=>(
              <label key={k} className="pill text-sm">
                <input type="radio" name={`lam-${line.id}`} className="mr-1" checked={line.lam===k} onChange={()=>set({lam:k})} />
                {k}
              </label>
            ))}
            <label className="pill text-sm">
              <input type="radio" name={`lam-${line.id}`} className="mr-1" checked={!line.lam} onChange={()=>set({lam:null})} />
              None
            </label>
          </div>
        </div>
      )}

      {/* Generic options (e.g., A-frame Color) */}
      {PRODUCTS.find(p=>p.code===line.product)?.options && (
        <div className="mt-4 space-y-2">
          <label className="block text-sm font-semibold">Options</label>
          {Object.entries(PRODUCTS.find(p=>p.code===line.product).options).map(([k, vals])=>(
            <div key={k} className="flex gap-2 flex-wrap items-center">
              <span className="text-sm">{k}:</span>
              {vals.map(v=>(
                <label key={v} className="pill text-sm">
                  <input type="radio" name={`${k}-${line.id}`} className="mr-1"
                    checked={line.opts?.[k]===v}
                    onChange={()=>set({ opts: { ...(line.opts||{}), [k]: v } })}
                  />
                  {v}
                </label>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 grid sm:grid-cols-2 gap-3 items-end">
        <div>
          <label className="block text-sm font-semibold">Quantity</label>
          <input className="w-32 border rounded-md p-2" type="number" min="1" value={line.qty} onChange={e=>set({qty: Math.max(1, Number(e.target.value))})} />
          <div className="text-xs text-gray-500 mt-1">Volume discounts per line {`(${VOLUME_BRACKETS.map(b=>`${b.minQty}+ ${b.pct*100}%`).join(' / ')})`}</div>
        </div>

        <div>
          <label className="block text-sm font-semibold">Upload Design (max 5 files)</label>
          <UploadBox current={line.uploads} onUploaded={(files)=>set({uploads:[...line.uploads, ...files].slice(0,5)})} draftId={draftId} />
        </div>
      </div>

      <div className="mt-4 border-t pt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="text-sm">
          <span className="font-semibold">Per item:</span> {currency(perItem)}{' '}
          {PRODUCTS.find(p=>p.code===line.product)?.kind!=='package' && (
            <span className="text-gray-500">— {res.breakdown.area.toFixed(2)} sq ft</span>
          )}
          {line.grommets && <span className="text-gray-500"> • {estGrommets} grommets est.</span>}
        </div>
        <div className="font-semibold">Line total: {currency(perItem * line.qty)}</div>
      </div>
    </div>
  )
}

function UnitToggle({ unit, setUnit }){
  return (
    <div className="flex gap-1">
      {['ft','in'].map(u=>(
        <button key={u} className={`pill ${unit===u?'ring-1 ring-black':''}`} onClick={()=>setUnit(u)}>{u}</button>
      ))}
    </div>
  )
}

function Toggle({ checked, onChange }){
  return (
    <button className={`pill ${checked?'ring-1 ring-black':''}`} onClick={()=>onChange(!checked)} aria-pressed={checked}>
      <span className="sr-only">toggle</span>{checked?'On':'Off'}
    </button>
  )
}

function UploadBox({ current, onUploaded, draftId }){
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function handleInput(e){
    const files = [...e.target.files].slice(0, Math.max(0, 5-(current?.length||0)))
    if(!files.length) return
    setErr(''); setBusy(true)
    try{
      const uploaded = await uploadFiles(draftId, files)
      onUploaded(uploaded)
    }catch(ex){
      setErr(ex.message || 'Upload failed')
    }finally{
      setBusy(false)
      e.target.value = ''
    }
  }

  return (
    <div className="drop">
      <input type="file" multiple accept=".pdf,.ai,.eps,.svg,.png,.jpg,.jpeg" onChange={handleInput} />
      {busy && <div className="text-sm">Uploading…</div>}
      {!!err && <div className="text-sm text-red-600">{err}</div>}
      <div className="mt-2 flex gap-2 flex-wrap">
        {current?.map((f,i)=>(
          <span key={i} className="chip text-xs">{f.name || f.path.split('/').pop()}</span>
        ))}
      </div>
    </div>
  )
}

function ContactBlock({ contact, setContact }){
  return (
    <div className="panel p-4">
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-semibold">Name</label>
          <input className="w-full border rounded-md p-2" value={contact.name} onChange={e=>setContact({...contact, name:e.target.value})} />
        </div>
        <div>
          <label className="block text-sm font-semibold">Email</label>
          <input className="w-full border rounded-md p-2" type="email" value={contact.email} onChange={e=>setContact({...contact, email:e.target.value})} />
        </div>
        <div>
          <label className="block text-sm font-semibold">Phone</label>
          <input className="w-full border rounded-md p-2" value={contact.phone} onChange={e=>setContact({...contact, phone:e.target.value})} />
        </div>
      </div>
    </div>
  )
}

function OrderSummary({ items, totals }){
  return (
    <div className="panel p-4 sticky top-4">
      <h3 className="font-semibold mb-2">Order Summary</h3>
      <div className="text-sm text-gray-600 mb-3">{items.length} line item{items.length>1?'s':''}</div>
      <div className="divide-y">
        {items.map((it,i)=>{
          const res = calcLineTotal(it)
          const p = PRODUCTS.find(p=>p.code===it.product)
          return (
            <div key={i} className="py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {p?.image ? <img src={p.image} alt="" className="w-10 h-10 rounded-md border object-cover" /> : null}
                <div>
                  <div className="font-medium">{p?.name || it.product}</div>
                  <div className="text-xs text-gray-500">{it.width}{it.unit} × {it.height}{it.unit} • Qty {it.qty}</div>
                </div>
              </div>
              <div className="font-medium">{currency(res.perItem * it.qty)}</div>
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="font-medium">Subtotal</div>
        <div className="font-semibold">{currency(totals.subtotal)}</div>
      </div>
      <p className="text-xs text-gray-500 mt-2">Tax & shipping calculated at checkout. Turnaround ETA provided after file review.</p>
    </div>
  )
}

function CheckoutBox({ items, totals, contact, note, onPlaced, placing, setPlacing, draftId }){
  function toOrderJSON(orderNo){
    return {
      orderNo,
      createdAt: new Date().toISOString(),
      contact,
      items: items.map(it=>{
        const p = PRODUCTS.find(p=>p.code===it.product)
        const price = calcLineTotal(it)
        return {
          ...it,
          productName: p?.name || it.product,
          pricing: {
            perItem: price.perItem,
            lineTotal: price.perItem * it.qty,
            breakdown: price.breakdown
          }
        }
      }),
      subtotal: totals.subtotal,
      total: totals.total,
      currency: CURRENCY,
      note,
      payment: {
        method: 'bank_transfer',
        instructions: {
          company: import.meta.env.VITE_BANK_COMPANY || 'Your Company Name',
          bank: import.meta.env.VITE_BANK_NAME || 'Your Bank',
          account: import.meta.env.VITE_BANK_ACCOUNT || '000000000',
          swift: import.meta.env.VITE_BANK_SWIFT || 'XXXXXX',
          currency: CURRENCY
        }
      },
      supabase: {
        bucket: import.meta.env.VITE_ORDERS_BUCKET || 'orders',
        tmpDraft: draftId
      }
    }
  }

  async function place(){
    if(placing) return
    if(!contact.name || !contact.email){
      alert('Enter contact name & email.')
      return
    }
    setPlacing(true)
    try{
      const orderNo = makeOrderNo()
      const order = toOrderJSON(orderNo)
      const res = await fetch('/.netlify/functions/create-order', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(order)
      })
      if(!res.ok){
        const t = await res.text()
        throw new Error(t || 'Order failed')
      }
      onPlaced(orderNo)
      localStorage.removeItem('livvitt:order-draft')
    }catch(ex){
      alert(ex.message || 'Could not place order')
    }finally{
      setPlacing(false)
    }
  }

  function downloadJSON(){
    const orderNo = makeOrderNo()
    const order = {
      ...toOrderJSON(orderNo),
      status: 'downloaded-only'
    }
    const blob = new Blob([JSON.stringify(order, null, 2)], {type:'application/json'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${orderNo}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="panel p-4 mt-4 sticky top-[calc(16px+350px)]">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Total</div>
        <div className="text-2xl font-bold">{currency(totals.total)}</div>
      </div>
      <button className="btn btn-primary w-full mt-3" onClick={place} disabled={placing}>
        {placing ? 'Placing…' : 'Place Order (Bank Transfer)'}
      </button>
      <button className="btn w-full mt-2" onClick={downloadJSON}>Download Order JSON</button>
    </div>
  )
}

function ThankYou({ orderNo, total }){
  const bank = {
    company: import.meta.env.VITE_BANK_COMPANY || 'Your Company Name',
    bank: import.meta.env.VITE_BANK_NAME || 'Your Bank',
    account: import.meta.env.VITE_BANK_ACCOUNT || '000000000',
    swift: import.meta.env.VITE_BANK_SWIFT || 'XXXXXX',
    currency: import.meta.env.VITE_CURRENCY || 'USD'
  }
  return (
    <div className="max-w-xl mx-auto p-6">
      <div className="panel p-6">
        <h2 className="text-2xl font-bold">Thank you!</h2>
        <p className="mt-1">Your order <strong>{orderNo}</strong> has been placed.</p>
        <div className="mt-4">
          <div className="font-semibold">Bank transfer details</div>
          <ul className="text-sm text-gray-700 mt-1 leading-6">
            <li><strong>Company:</strong> {bank.company}</li>
            <li><strong>Bank:</strong> {bank.bank}</li>
            <li><strong>Account:</strong> {bank.account}</li>
            <li><strong>SWIFT:</strong> {bank.swift}</li>
            <li><strong>Currency:</strong> {bank.currency}</li>
          </ul>
          <p className="text-xs text-gray-500 mt-2">Please include your order number in the transfer reference. We’ll email your confirmation & proof (if needed).</p>
        </div>
        <a href="/" className="btn mt-4">Start a new order</a>
        <div className="text-xs text-gray-500 mt-4">Total: <strong>{currency(total)}</strong></div>
      </div>
    </div>
  )
}
