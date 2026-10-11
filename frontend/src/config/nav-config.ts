import { NavGroup } from '@/types';

/**
 * Sidebar and Cmd+K navigation. Every page shows the project selected in
 * the header's project switcher.
 */
export const navGroups: NavGroup[] = [
  {
    label: 'Parsim',
    items: [
      {
        title: 'Overview',
        url: '/dashboard/overview',
        icon: 'dashboard',
        shortcut: ['o', 'o'],
        isActive: false,
        items: []
      },
      {
        title: 'Agent sessions',
        url: '/dashboard/sessions',
        icon: 'sessions',
        shortcut: ['s', 's'],
        isActive: false,
        items: []
      }
    ]
  },
  {
    label: 'Project',
    items: [
      {
        title: 'API keys',
        url: '/dashboard/api-keys',
        icon: 'key',
        shortcut: ['k', 'k'],
        isActive: false,
        items: []
      },
      {
        title: 'Settings',
        url: '/dashboard/settings',
        icon: 'settings',
        shortcut: ['g', 'g'],
        isActive: false,
        items: []
      },
      {
        title: 'Setup',
        url: '/dashboard/setup',
        icon: 'setup',
        shortcut: ['u', 'u'],
        isActive: false,
        items: []
      }
    ]
  }
];
