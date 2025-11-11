"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { name: "Home", href: "/home", icon: "🏠" },
  { name: "Tasks", href: "/tasks", icon: "✅" },
  { name: "Meals", href: "/meals", icon: "🍽️" },
  { name: "Plan", href: "/mealplan", icon: "📅" }, 
  { name: "Activity", href: "/activity", icon: "📊" },
];

export default function BottomNavigation() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-black safe-area-bottom transition-colors">
      <div className="flex h-16 items-center justify-around">
        {navItems.map((item) => {
          // Handle both /home and / as active for the home tab
          const isActive = pathname === item.href || (item.href === "/home" && pathname === "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-1 flex-1 h-full transition-colors ${
                isActive
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-gray-600 dark:text-gray-400"
              }`}
              aria-label={`Navigate to ${item.name}`}
              aria-current={isActive ? "page" : undefined}
            >
              <span className="text-xl">{item.icon}</span>
              <span className="text-xs font-medium">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}