import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Тільки довідник ролей — все інше в Redis
export type RoleRow = {
  id: number
  name: 'mafia' | 'sheriff' | 'civilian' | 'doctor' | 'prostitute'
  display_name: string
  description: string
  team: 'mafia' | 'town'
  icon: string
  is_active: boolean
  created_at: string
}

export async function fetchRoles(): Promise<RoleRow[]> {
  const { data, error } = await supabase
    .from('roles')
    .select('*')
    .eq('is_active', true)
  if (error) {
    console.error('fetchRoles error:', error)
    return []
  }
  return data ?? []
}
