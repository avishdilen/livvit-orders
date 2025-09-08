import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const bucket = process.env.ORDERS_BUCKET || 'orders'

const supa = createClient(url, serviceKey, { auth: { persistSession:false } })

export async function handler(event){
  if (event.httpMethod !== 'POST'){
    return { statusCode: 405, body: 'Method not allowed' }
  }
  try{
    const { filename, draftId } = JSON.parse(event.body||'{}')
    if (!filename || !draftId) return { statusCode: 400, body: 'filename and draftId required' }

    const clean = filename.toLowerCase().replace(/[^a-z0-9.\-_]+/g, '-').slice(0,120) || 'file'
    const path = `tmp/${draftId}/${Date.now()}-${clean}`

    const { data, error } = await supa.storage.from(bucket).createSignedUploadUrl(path)
    if (error) throw error

    return { statusCode: 200, body: JSON.stringify({ bucket, path: data.path, token: data.token }) }
  }catch(ex){
    return { statusCode: 500, body: String(ex.message || ex) }
  }
}
