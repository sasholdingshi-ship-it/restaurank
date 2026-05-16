import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

const PUBLIC_PATHS = ['/login', '/auth/callback']

export async function proxy(request: NextRequest) {
  const { user, supabaseResponse } = await updateSession(request)
  const { pathname } = request.nextUrl

  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p))

  // Authenticated user hitting login → send to home
  if (user && isPublic) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Unauthenticated user hitting protected route → send to login
  if (!user && !isPublic) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static, _next/image (Next.js internals)
     * - favicon.ico, icons/, manifest.json, sw.js (PWA assets)
     * - *.png, *.svg, *.jpg (static images)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|icons|manifest\\.json|sw\\.js|.*\\.(?:png|svg|jpg)$).*)',
  ],
}
