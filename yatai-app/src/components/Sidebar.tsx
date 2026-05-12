"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const NAV = [
  { href: "/", label: "Dashboard", icon: "📊" },
  { href: "/commandes", label: "Commandes", icon: "📝" },
  { href: "/mercurial", label: "Mercurial", icon: "📦" },
  { href: "/produits", label: "Produits", icon: "💰" },
  { href: "/recettes", label: "Recettes", icon: "📋" },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-56 bg-gray-900 text-white flex flex-col shrink-0">
      <div className="p-4 border-b border-gray-700">
        <h1 className="text-xl font-bold tracking-tight">
          <span className="text-orange-400">Y</span>atai
        </h1>
        <p className="text-xs text-gray-400 mt-0.5">Gestion franchise</p>
      </div>
      <nav className="flex-1 py-4">
        {NAV.map(item => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                active
                  ? "bg-gray-800 text-white border-r-2 border-orange-400"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white"
              }`}
            >
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
  )
}
