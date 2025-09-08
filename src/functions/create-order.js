import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const bucket = process.env.ORDERS_BUCKET || 'orders'

const supa = createClient(url, serviceKey, { auth: { persistSession: false } })

export async function handler(event){
  if (event.httpMethod !== 'POST'){
    return { statusCode: 405, body: 'Method not allowed' }
  }

  try{
    const order = JSON.parse(event.body||'{}')
    const orderNo = order.orderNo || `LIV-${Date.now()}`

    const folder = `orders/${orderNo}`
    const orderPath = `${folder}/order.json`
    const { error: upErr } = await supa.storage.from(bucket).upload(orderPath, JSON.stringify(order, null, 2), { contentType:'application/json', upsert: true })
    if (upErr) throw upErr

    const draftId = order?.supabase?.tmpDraft
    if (draftId){
      const fromPrefix = `tmp/${draftId}`
      const { data: list, error: listErr } = await supa.storage.from(bucket).list(fromPrefix, { limit: 100, search: '' })
      if (!listErr && list?.length){
        for (const f of list){
          if (f.name === '.empty') continue
          const from = `${fromPrefix}/${f.name}`
          const to = `${folder}/files/${f.name}`
          await supa.storage.from(bucket).move(from, to)
        }
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ok:true, orderNo }) }
  }catch(ex){
    return { statusCode: 500, body: String(ex.message || ex) }
  }
}
