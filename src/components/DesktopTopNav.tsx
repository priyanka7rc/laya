"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { name: "Tasks",   href: "/tasks" },
  { name: "Lists",   href: "/lists" },
  { name: "Unload", href: "/capture" },
  { name: "Profile", href: "/profile" },
];

export default function DesktopTopNav() {
  const pathname = usePathname();

  return (
    <header className="hidden lg:flex fixed top-0 left-0 right-0 z-50 h-18 items-center justify-between px-6 bg-card border-b border-border" style={{ height: '72px' }}>
      {/* Logo — routes to Home */}
      <Link
        href="/home"
        className="flex items-center gap-2.5 shrink-0"
        aria-label="Go to Home"
      >
        <div className="w-8 h-8 rounded-md bg-primary/20 flex items-center justify-center text-primary font-bold text-base select-none">
          L
        </div>
        <span className="font-semibold text-2xl tracking-tight text-foreground">
          Laya
        </span>
      </Link>

      {/* Nav items — no Home */}
      <nav>
        <ul className="flex items-center gap-1">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href === "/lists" && pathname?.startsWith("/lists"));
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-label={`Navigate to ${item.name}`}
                  aria-current={isActive ? "page" : undefined}
                  className={`relative flex items-center h-10 px-4 rounded-md text-xl font-medium transition-colors ${
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {item.name}
                  {isActive && (
                    <span className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-primary" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
