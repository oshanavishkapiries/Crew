'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { ThemeProvider } from 'next-themes';
import { establishSession } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

const AuthContext = createContext(false);
export function useAuthenticated() { return useContext(AuthContext); }

export function Providers({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'login'>('loading');
  useEffect(() => {
    let active = true;
    let generation = 0;
    const check = () => {
      const current = ++generation;
      setStatus('loading');
      void establishSession().then(
        () => { if (active && current === generation) setStatus('ready'); },
        () => { if (active && current === generation) setStatus('login'); },
      );
    };
    const unauthorized = () => { generation++; setStatus('login'); };
    const fragmentChanged = () => {
      if (new URLSearchParams(window.location.hash.slice(1)).has('key')) check();
    };
    window.addEventListener('crew:unauthorized', unauthorized);
    window.addEventListener('crew:check-session', check);
    window.addEventListener('hashchange', fragmentChanged);
    check();
    return () => {
      active = false;
      window.removeEventListener('crew:unauthorized', unauthorized);
      window.removeEventListener('crew:check-session', check);
      window.removeEventListener('hashchange', fragmentChanged);
    };
  }, []);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <AuthContext.Provider value={status === 'ready'}>
          {status === 'ready' ? children : (
            <main className="grid min-h-screen place-items-center p-8">
              <Card className="w-full max-w-md">
                <CardHeader><CardTitle>Crew</CardTitle><CardDescription>Your local agent workspace</CardDescription></CardHeader>
                <CardContent className="space-y-4" aria-live="polite">
                  {status === 'loading' ? <><p>Connecting to Crew…</p><Skeleton className="h-6 w-full" /></> : <>
                    <p>Open a fresh login link from your terminal.</p>
                    <p className="text-sm text-muted-foreground">Run <code>crew open</code> and follow the printed URL. If the server has stopped, run <code>crew start</code> first.</p>
                    <Button variant="outline" onClick={() => window.dispatchEvent(new Event('crew:check-session'))}>Check session again</Button>
                  </>}
                </CardContent>
              </Card>
            </main>
          )}
        </AuthContext.Provider>
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}
