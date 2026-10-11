'use client';

import { CopyButton } from '@/components/copy-button';
import { Icons } from '@/components/icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { RelativeTime } from '@/components/time';
import type { CreatedApiKey } from '@/lib/parsim/types';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { createKeyMutation, keysQueryOptions, revokeKeyMutation } from '../api/queries';

export function ApiKeysView({ projectId }: { projectId: string }) {
  const { data: keys } = useSuspenseQuery(keysQueryOptions(projectId));
  const revoke = useMutation({
    ...revokeKeyMutation(projectId),
    onSuccess: () => toast.success('Key revoked. Requests with it are now rejected.'),
    onError: (error) => toast.error(error.message)
  });

  return (
    <div className='rounded-lg border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Last used</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className='text-right'>
              <span className='sr-only'>Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className='text-muted-foreground text-center'>
                No keys yet. Create one to send requests through Parsim.
              </TableCell>
            </TableRow>
          )}
          {keys.map((key) => (
            <TableRow key={key.id}>
              <TableCell>
                {key.name ?? <span className='text-muted-foreground'>unnamed</span>}
              </TableCell>
              <TableCell className='font-mono text-xs'>{key.prefix}...</TableCell>
              <TableCell>
                <RelativeTime date={key.createdAt} />
              </TableCell>
              <TableCell>
                {key.lastUsedAt ? <RelativeTime date={key.lastUsedAt} /> : 'never'}
              </TableCell>
              <TableCell>
                {key.revokedAt ? (
                  <Badge variant='outline'>revoked</Badge>
                ) : (
                  <Badge variant='secondary'>active</Badge>
                )}
              </TableCell>
              <TableCell className='text-right'>
                {!key.revokedAt && (
                  <AlertDialog>
                    <AlertDialogTrigger render={<Button variant='ghost' size='sm' />}>
                      Revoke
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Revoke {key.prefix}...?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Every agent using this key will get 401 errors right away. This cannot be
                          undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          variant='destructive'
                          onClick={() => revoke.mutate(key.id)}
                        >
                          Revoke key
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Creates a key and shows it once, with a copy button. */
export function CreateKeyButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const create = useMutation({
    ...createKeyMutation(projectId),
    onSuccess: (key) => setCreated(key),
    onError: (error) => toast.error(error.message)
  });

  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setCreated(null);
      setName('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger render={<Button size='sm' />}>
        <Icons.add className='size-4' /> Create key
      </DialogTrigger>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Your new Parsim key</DialogTitle>
              <DialogDescription>Copy it now. It will not be shown again.</DialogDescription>
            </DialogHeader>
            <div className='flex items-center gap-2'>
              <code className='bg-muted flex-1 rounded px-2 py-2 font-mono text-xs break-all'>
                {created.key}
              </code>
              <CopyButton text={created.key} />
            </div>
            <Alert>
              <Icons.lock />
              <AlertTitle>Store it like a password</AlertTitle>
              <AlertDescription>
                Anyone with this key can send requests through your project and spend your provider
                budget. Revoke it here if it leaks.
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate(name.trim());
            }}
            className='flex flex-col gap-4'
          >
            <DialogHeader>
              <DialogTitle>Create a Parsim key</DialogTitle>
              <DialogDescription>
                Agents send it as x-parsim-key, or as their API key.
              </DialogDescription>
            </DialogHeader>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='key-name'>Name (optional)</Label>
              <Input
                id='key-name'
                value={name}
                maxLength={100}
                placeholder='research agent, production'
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type='submit' disabled={create.isPending}>
                {create.isPending && <Icons.spinner className='size-4 animate-spin' />}
                Create key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
