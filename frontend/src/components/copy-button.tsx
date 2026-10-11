'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { toast } from 'sonner';

/** Copies text to the clipboard and confirms it briefly. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy. Select the text and copy it manually.');
    }
  };
  return (
    <Button
      type='button'
      variant='outline'
      size='sm'
      onClick={() => void copy()}
      aria-label={label}
    >
      {copied ? <Icons.check className='size-4' /> : <Icons.copy className='size-4' />}
      {copied ? 'Copied' : label}
    </Button>
  );
}
