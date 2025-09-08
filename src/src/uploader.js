import { createClient } from '@supabase/supabase-js'

const supa = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)

export async function uploadFiles(draftId, files){
  const results = []
  for (const file of files){
    const r = await fetch('/.netlify/functions/sign-upload', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ draftId, filename: file.name })
    })
    if(!r.ok){ throw new Error('Failed to sign upload') }
    const { path, token, bucket } = await r.json()
    const { error } = await supa.storage.from(bucket).uploadToSignedUrl(path, token, file)
    if(error){ throw error }
    results.push({ bucket, path, name: file.name, size: file.size, type: file.type })
  }
  return results
}
