import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";
import ConditionalNav from "@/components/ConditionalNav";
import ShellWrapper from "@/components/ShellWrapper";
import { ToastProvider } from "@/context/ToastContext";
import { ToastViewport } from "@/components/ui/Toast";
import { PostHogProvider } from "@/components/PostHogProvider";
import { ThemeProvider } from "@/context/ThemeContext";
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
  const appearanceInitScript = `
(function(){
  var K='laya-appearance';
  function parse(v){
    if(v==='light'||v==='dark'||v==='system')return v;
    return 'system';
  }
  try{
    var a=parse(localStorage.getItem(K));
    var eff=a==='light'?'light':a==='dark'?'dark':(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
    var r=document.documentElement;
    r.classList.remove('light','dark');
    r.classList.add(eff);
  }catch(e){}
})();`;

  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceInitScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} bg-background text-foreground antialiased transition-colors duration-300`}
      >
        <ThemeProvider>
          <PostHogProvider>
        <AuthProvider>
              <ToastProvider>
                <GlobalErrorHandler />
            <ShellWrapper>{children}</ShellWrapper>
            <ConditionalNav />
                <ToastViewport />
          </ToastProvider>
        </AuthProvider>
          </PostHogProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}