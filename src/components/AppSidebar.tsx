"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { name: "Home", href: "/home" },
  { name: "Tasks", href: "/tasks" },
  { name: "Lists", href: "/lists" },
  { name: "Capture", href: "/capture" },
  { name: "Profile", href: "/profile" },
];

export default function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex lg:flex-col lg:fixed lg:left-0 lg:top-0 lg:h-screen lg:w-64 lg:border-r lg:border-border lg:bg-card">
      <div className="p-6 shrink-0">
        <Link href="/home" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
            L
          </div>
          <span className="font-semibold text-lg tracking-tight text-foreground">
            Laya
          </span>
        </Link>
      </div>
      <nav className="flex-1 px-4">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href === "/home" && (pathname === "/" || pathname === "/app")) ||
              (item.href === "/lists" && pathname?.startsWith("/lists"));
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 h-11 px-3 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-primary/10 text-primary hover:bg-primary/15"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  aria-label={`Navigate to ${item.name}`}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span className="w-5 h-5 flex items-center justify-center shrink-0">
                    {item.name === "Home" && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        <polyline points="9 22 9 12 15 12 15 22" />
                      </svg>
                    )}
                    {item.name === "Tasks" && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                        <polyline points="9 11 12 14 22 4" />
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                      </svg>
                    )}
                    {item.name === "Lists" && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                        <line x1="8" y1="6" x2="21" y2="6" />
                        <line x1="8" y1="12" x2="21" y2="12" />
                        <line x1="8" y1="18" x2="21" y2="18" />
                        <line x1="3" y1="6" x2="3.01" y2="6" />
                        <line x1="3" y1="12" x2="3.01" y2="12" />
                        <line x1="3" y1="18" x2="3.01" y2="18" />
                      </svg>
                    )}
                    {item.name === "Capture" && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                        <path d="M12 5v14" />
                        <path d="M5 12h14" />
                      </svg>
                    )}
                    {item.name === "Profile" && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                        <circle cx="12" cy="8" r="4" />
                        <path d="M20 21a8 8 0 0 0-16 0" />
                      </svg>
                    )}
                  </span>
                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
