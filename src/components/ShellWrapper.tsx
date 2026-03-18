"use client";

import { useAuth } from "./AuthProvider";
import { usePathname } from "next/navigation";

const MAIN_APP_PATHS = [
  "/",
  "/home",
  "/app",
  "/tasks",
  "/lists",
  "/capture",
  "/profile",
];

function isMainAppRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  if (MAIN_APP_PATHS.includes(pathname)) return true;
  if (pathname.startsWith("/lists/")) return true;
  return false;
}

export default function ShellWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  const showShellPadding =
    !loading && user && isMainAppRoute(pathname);

  if (!showShellPadding) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen pb-24 lg:pb-8 lg:pt-[72px]">
      {children}
    </div>
  );
}
