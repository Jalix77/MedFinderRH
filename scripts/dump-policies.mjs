import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'
import WS from 'ws'

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = WS
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

const { data, error } = await admin.rpc('debug_dump_all_policies')
if (error) {
  console.error('ERROR', error)
  process.exit(1)
}
console.log(`Total policies: ${data.length}`)
writeFileSync('scripts/.policies-dump.json', JSON.stringify(data, null, 2))
console.log('Written to scripts/.policies-dump.json')
