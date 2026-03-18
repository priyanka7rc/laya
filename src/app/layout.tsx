import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";
import ConditionalNav from "@/components/ConditionalNav";
import ShellWrapper from "@/components/ShellWrapper";
import FloatingBrainDump from "@/components/FloatingBrainDump";
import { ToastProvider } from "@/context/ToastContext";
import { ToastViewport } from "@/components/ui/Toast";
import { PostHogProvider } from "@/components/PostHogProvider";
import { ThemeProvider } from "@/context/ThemeContext";
import ThemeToggle from "@/components/ThemeToggle";
import GlobalErrorHandler from "@/components/GlobalErrorHandler";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Laya - Your Personal Assistant",
  description: "Manage tasks, meals, and life",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                document.documentElement.classList.remove('dark');
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} bg-background text-foreground antialiased transition-colors duration-300`}
      >
        <ThemeProvider>
          <PostHogProvider>
        <AuthProvider>
              <ToastProvider>
                <GlobalErrorHandler />
                <ThemeToggle />
            <ShellWrapper>{children}</ShellWrapper>
            <ConditionalNav />
            <FloatingBrainDump />
                <ToastViewport />
          </ToastProvider>
        </AuthProvider>
          </PostHogProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}