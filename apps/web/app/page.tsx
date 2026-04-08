import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'

// Root route — authenticated users go to dashboard, everyone else sees marketing homepage
export default async function RootPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect('/dashboard')
  } else {
    redirect('/home.html')
  }
}
