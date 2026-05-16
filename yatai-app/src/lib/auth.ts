import { createClient } from '@/lib/supabase/server'

/**
 * Require authentication on API routes.
 * Throws if the user is not authenticated.
 */
export async function requireAuth() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    throw new Error('Unauthorized')
  }
  return user
}
