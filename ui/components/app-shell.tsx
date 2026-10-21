'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Inbox, LayoutDashboard, Library, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const links = [
  { href: '/', label: 'Board', icon: LayoutDashboard },
  { href: '/inbox/', label: 'Inbox', icon: Inbox },
  { href: '/team/', label: 'Team', icon: Users },
  { href: '/memory/', label: 'Memory', icon: Library },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { theme, setTheme } = useTheme();
  return <div className="flex min-h-screen">
    <aside className="flex w-52 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="border-b p-6 text-xl font-semibold tracking-tight">Crew</div>
      <ScrollArea className="flex-1 p-3">
        <nav aria-label="Main navigation" className="space-y-1">
          {links.map(({ href, label, icon: Icon }) => <Button key={href} asChild variant={path === href || `${path}/` === href ? 'secondary' : 'ghost'} className="w-full justify-start">
            <Link href={href} aria-current={path === href || `${path}/` === href ? 'page' : undefined}><Icon />{label}</Link>
          </Button>)}
        </nav>
      </ScrollArea>
      <p className="p-5 text-xs text-muted-foreground">Local workspace</p>
    </aside>
    <div className="min-w-0 flex-1">
      <header className="flex h-20 items-center justify-between gap-4 border-b px-8">
        <Tooltip><TooltipTrigger asChild><Badge variant="outline">Authenticated</Badge></TooltipTrigger><TooltipContent>Board stream connections appear beside each board.</TooltipContent></Tooltip>
        <Select value={theme ?? 'system'} onValueChange={setTheme}>
          <SelectTrigger aria-label="Color theme" className="w-36"><SelectValue placeholder="System" /></SelectTrigger>
          <SelectContent><SelectItem value="light">Light</SelectItem><SelectItem value="dark">Dark</SelectItem><SelectItem value="system">System</SelectItem></SelectContent>
        </Select>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 p-8">{children}</main>
    </div>
  </div>;
}
