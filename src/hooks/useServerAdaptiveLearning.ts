import { useEffect, useState } from 'react';
import { INITIAL_ADAPTIVE_API_STATE, startAdaptiveLearningPolling } from '../services/adaptiveLearningApi';

/** Subscribes only to the phone's compact result; no history inputs or local model. */
export function useServerAdaptiveLearning() {
  const [state, setState] = useState(INITIAL_ADAPTIVE_API_STATE);
  useEffect(() => startAdaptiveLearningPolling(setState), []);
  return state;
}
