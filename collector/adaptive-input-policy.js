/**
 * Adaptive's required-input contract is intentionally separate from the T7
 * collector contract. T7 remains durable and scored independently, but it is
 * not an Adaptive feature in this mode.
 */
export const ADAPTIVE_INPUT_POLICY = Object.freeze({
  id: 'adaptive-t3-t9-v1',
  requiredSignals: Object.freeze(['T3', 'T9']),
  optionalSignals: Object.freeze(['T7']),
  includeOptionalT7: false,
});

export const LEGACY_T7_REQUIRED_POLICY = Object.freeze({
  id: 'legacy-t3-t7-t9',
  requiredSignals: Object.freeze(['T3', 'T7', 'T9']),
  optionalSignals: Object.freeze([]),
  includeOptionalT7: true,
});

export const MINIMUM_SIGNAL_POLICY = Object.freeze({
  id: 'adaptive-minimum-two-v1',
  requiredSignals: Object.freeze([]),
  optionalSignals: Object.freeze(['T3', 'T7', 'T9']),
  minimumSignals: 2,
  includeOptionalT7: true,
});
