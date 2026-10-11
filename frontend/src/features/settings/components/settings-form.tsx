'use client';

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
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAppForm } from '@/lib/form';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { settingsQueryOptions, updateSettingsMutation } from '../api/queries';
import {
  settingsSchema,
  type SettingsValues,
  THRESHOLDS,
  toForm,
  toUpdate
} from '../settings-values';

export function SettingsForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions(projectId));
  const [confirm, setConfirm] = useState<SettingsValues | null>(null);
  const save = useMutation({
    ...updateSettingsMutation(projectId),
    onSuccess: () => {
      toast.success('Settings saved');
      router.refresh();
    },
    onError: (error) => toast.error(`Could not save: ${error.message}`)
  });

  const form = useAppForm({
    defaultValues: toForm(settings),
    validators: { onSubmit: settingsSchema },
    onSubmit: ({ value }) => {
      // Turning the GC on changes what the model sees: confirm first.
      if (value.gcMode === 'on' && settings.gcMode !== 'on') setConfirm(value);
      else save.mutate(toUpdate(value));
    }
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      className='flex max-w-3xl flex-col gap-4'
    >
      <Card>
        <CardHeader>
          <CardTitle>GC mode</CardTitle>
          <CardDescription>What Parsim does with this project&apos;s requests.</CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-4'>
          <form.AppField
            name='gcMode'
            children={(field) => (
              <field.RadioGroupField
                label='Mode'
                options={[
                  { value: 'off', label: 'Off: forward requests unchanged, no GC' },
                  {
                    value: 'shadow',
                    label: 'Shadow: forward the original, record what the GC would save'
                  },
                  { value: 'on', label: 'On: forward the request after GC' }
                ]}
              />
            )}
          />
          <form.Subscribe
            selector={(state) => state.values.gcMode}
            children={(mode) =>
              mode === 'on' && settings.gcMode !== 'on' ? (
                <Alert variant='destructive'>
                  <Icons.warning />
                  <AlertTitle>The model will see less context</AlertTitle>
                  <AlertDescription>
                    In On mode Parsim removes duplicate and superseded tool results and archives
                    large old ones before your requests reach the provider. Archived content can be
                    recalled, but check shadow mode&apos;s estimates and your agent&apos;s results
                    first.
                  </AlertDescription>
                </Alert>
              ) : null
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Thresholds</CardTitle>
          <CardDescription>
            Leave a field empty to use the server default shown below it.
          </CardDescription>
        </CardHeader>
        <CardContent className='grid gap-4 sm:grid-cols-2'>
          {THRESHOLDS.map((threshold) => (
            <form.AppField
              key={threshold.key}
              name={threshold.key}
              children={(field) => (
                <field.TextField
                  label={threshold.label}
                  type='number'
                  min={threshold.min}
                  step={1}
                  placeholder={String(settings.thresholds[threshold.key].default)}
                  description={`${threshold.description} Default: ${settings.thresholds[threshold.key].default.toLocaleString('en-US')}.`}
                />
              )}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tools with side effects</CardTitle>
          <CardDescription>
            Their calls and results are never dropped or archived (the action log). Always
            protected: names matching {settings.sideEffectTools.patterns.join(', ')}
            {settings.sideEffectTools.server.length > 0 &&
              `, and the server list: ${settings.sideEffectTools.server.join(', ')}`}
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form.AppField
            name='gcSideEffectTools'
            children={(field) => (
              <field.TagsField
                label='Tool names for this project'
                placeholder='save_note, book_flight... then Enter'
              />
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Content storage</CardTitle>
          <CardDescription>
            Whether Parsim stores prompt and tool content for this project. Hashes and token counts
            are always stored; archived originals are always stored so they can be recalled.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form.AppField
            name='storeContent'
            children={(field) => (
              <field.RadioGroupField
                label='Store content'
                options={[
                  {
                    value: 'default',
                    label: `Server default (${settings.storeContentDefault ? 'store' : 'do not store'})`
                  },
                  { value: 'true', label: 'Store content' },
                  { value: 'false', label: 'Do not store content' }
                ]}
              />
            )}
          />
        </CardContent>
      </Card>

      <div>
        <form.AppForm>
          <form.SubmitButton loading={save.isPending}>Save settings</form.SubmitButton>
        </form.AppForm>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn the GC on?</AlertDialogTitle>
            <AlertDialogDescription>
              From the next request, Parsim forwards smaller requests to your provider. You can
              switch back to shadow mode at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm) save.mutate(toUpdate(confirm));
                setConfirm(null);
              }}
            >
              Turn on
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
