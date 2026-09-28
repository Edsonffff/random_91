import type { CalculatedOutcome, ResultColor, ResultSize } from '../types/result';

/**
 * Deterministic business logic calculation for lottery numbers 0-9.
 * Mapping specifications:
 * 0 = Small + Red + Violet
 * 1 = Small + Green
 * 2 = Small + Red
 * 3 = Small + Green
 * 4 = Small + Red
 * 5 = Big + Green + Violet
 * 6 = Big + Red
 * 7 = Big + Green
 * 8 = Big + Red
 * 9 = Big + Green
 */
export function calculateResult(winningNumber: number): CalculatedOutcome {
  if (winningNumber < 0 || winningNumber > 9 || !Number.isInteger(winningNumber)) {
    throw new Error(`Winning number must be an integer between 0 and 9. Received: ${winningNumber}`);
  }

  // Size definition: 0-4 = Small, 5-9 = Big
  const size: ResultSize = winningNumber >= 5 ? 'Big' : 'Small';

  // Color definition:
  // 0: Red + Violet
  // 5: Green + Violet
  // Even numbers (2, 4, 6, 8): Red
  // Odd numbers (1, 3, 7, 9): Green
  let colors: ResultColor[];
  if (winningNumber === 0) {
    colors = ['red', 'violet'];
  } else if (winningNumber === 5) {
    colors = ['green', 'violet'];
  } else if (winningNumber % 2 === 0) {
    colors = ['red'];
  } else {
    colors = ['green'];
  }

  return {
    number: winningNumber,
    size,
    colors,
  };
}

/**
 * Helper to get primary display color for quick styling
 */
export function getPrimaryDisplayColor(number: number): 'red' | 'green' | 'violet' {
  if (number === 0 || number === 2 || number === 4 || number === 6 || number === 8) {
    return 'red';
  }
  return 'green';
}
