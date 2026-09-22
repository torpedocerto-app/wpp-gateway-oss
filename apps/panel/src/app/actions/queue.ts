'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth';
import { workerApi } from '@/lib/worker-client';

export async function pauseQueueAction(): Promise<void> {
  await requireSession();
  await workerApi.queuePause();
  revalidatePath('/queue');
}

export async function resumeQueueAction(): Promise<void> {
  await requireSession();
  await workerApi.queueResume();
  revalidatePath('/queue');
}

export async function retryFailedAction(): Promise<{ retried: number }> {
  await requireSession();
  const r = await workerApi.queueRetryFailed();
  revalidatePath('/queue');
  return r;
}

export async function cleanCompletedAction(): Promise<{ removed: number }> {
  await requireSession();
  const r = await workerApi.queueCleanCompleted();
  revalidatePath('/queue');
  return r;
}
