export { readCounters, incrCounters, markLastSend, readLastSend } from './counters.js';
export {
  acquireAccountLock,
  releaseAccountLock,
  renewAccountLock,
  isAccountLocked,
  type AccountLock,
} from './lock.js';
export { getWaExistence, setWaExistence, type WaExistence } from './wa-cache.js';
export { setCooldown, isInCooldown, isQuarantined } from './cooldown.js';
