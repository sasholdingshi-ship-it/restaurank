"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ReactNode } from "react"

const NAV = [
  { href: "/", label: "Dashboard", icon: "📊" },
  { href: "/commandes", label: "Commandes", icon: "📝" },
  { href: "/mercurial", label: "Mercurial", icon: "📦" },
  { href: "/produits", label: "Produits", icon: "💰" },
  { href: "/recettes", label: "Recettes", icon: "📋" },
]

export function MobileShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()

  return (
    <>
      {/* Desktop: sidebar */}
      <div className="hidden md:flex h-full">
        <aside className="w-56 bg-gray-900 text-white flex flex-col shrink-0">
          <div className="p-4 border-b border-gray-700 flex items-center gap-3">
            <Image src="/icons/logo.png" alt="Yatai" width={40} height={40} className="rounded" />
            <div>
              <h1 className="text-lg font-bold tracking-tight">Yatai</h1>
              <p className="text-xs text-gray-400">Gestion franchise</p>
            </div>
          </div>
          <nav className="flex-1 py-4">
            {NAV.map(item => {
              const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))
              return (
                <Link key={item.href} href={item.href}
                  className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${active ? "bg-gray-800 text-white border-r-2 border-orange-400" : "text-gray-300 hover:bg-gray-800 hover:text-white"}`}>
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </nav>
          <div className="p-4 border-t border-gray-700 text-xs text-gray-500">
            5 restaurants &bull; Paris
          </div>
        </aside>
        <main className="flex-1 overflow-auto">
          <div className="p-6 max-w-7xl mx-auto">{children}</div>
        </main>
      </div>

      {/* Mobile: content + bottom tab bar */}
      <div className="md:hidden flex flex-col" style={{ height: "100dvh" }}>
        <main className="flex-1 overflow-auto min-h-0">
          <div className="p-4 pb-2">{children}</div>
        </main>
        <nav className="shrink-0 bg-gray-900 border-t border-gray-700 flex justify-around items-center z-50"
          style={{ padding: "8px 0 calc(8px + env(safe-area-inset-bottom, 0px))" }}>
          {NAV.map(item => {
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))
            return (
              <Link key={item.href} href={item.href}
                className={`flex flex-col items-center gap-0.5 px-3 text-[10px] transition-colors ${active ? "text-orange-400" : "text-gray-400"}`}>
                <span className="text-xl">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
      </div>
    </>
  )
}
