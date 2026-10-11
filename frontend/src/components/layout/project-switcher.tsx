'use client';

import { selectProject } from '@/app/dashboard/actions';
import { Icons } from '@/components/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { GC_MODE_LABELS } from '@/lib/parsim/format';
import type { Project } from '@/lib/parsim/types';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/** Picks the project every dashboard page shows. */
export function ProjectSwitcher({
  projects,
  currentId
}: {
  projects: Pick<Project, 'id' | 'name' | 'gcMode' | 'upstream'>[];
  currentId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const current = projects.find((p) => p.id === currentId);

  const choose = (id: string) =>
    startTransition(async () => {
      await selectProject(id);
      router.refresh();
    });

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size='lg'
                tooltip={current?.name ?? 'No project'}
                className='data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground'
              />
            }
          >
            <div className='flex min-w-0 flex-col text-left group-data-[collapsible=icon]:hidden'>
              <span className='text-muted-foreground text-xs'>Project</span>
              <span className='truncate font-medium'>{current?.name ?? 'No project'}</span>
            </div>
            {pending ? (
              <Icons.spinner className='ml-auto size-4 animate-spin' />
            ) : (
              <Icons.chevronsUpDown className='ml-auto size-4 group-data-[collapsible=icon]:ml-0' />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className='w-(--anchor-width) min-w-56 rounded-lg'
            side='top'
            align='start'
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className='text-muted-foreground text-xs'>
                Projects
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {projects.map((project) => (
                <DropdownMenuItem key={project.id} onClick={() => choose(project.id)}>
                  <div className='flex min-w-0 flex-1 flex-col'>
                    <span className='truncate'>{project.name}</span>
                    <span className='text-muted-foreground text-xs'>
                      {project.upstream}, GC {GC_MODE_LABELS[project.gcMode].toLowerCase()}
                    </span>
                  </div>
                  {project.id === currentId && <Icons.check className='ml-2 size-4' />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
