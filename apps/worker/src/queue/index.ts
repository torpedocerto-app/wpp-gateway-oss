// Re-exporta do pacote compartilhado + os processadores que vivem só no worker.
export {
  QUEUE_NAMES,
  OUTBOUND_PRIORITY,
  outboundQueue,
  enqueueOutbound,
  webhookQueue,
  enqueueWebhook,
  closeQueues,
  createAndEnqueue,
  dispatchWebhook,
  type OutboundJobData,
  type WebhookJobData,
  type CreateAndEnqueueInput,
  type EnqueueResult,
} from '@wpp/queue';
export { startOutboundWorker } from './worker.js';
export { startWebhookWorker } from './webhook-worker.js';
export { processOutbound } from './process-outbound.js';
export { processWebhook } from './process-webhook.js';
export { buildAccountSnapshots } from './snapshot.js';
