/** True on phones and tablets (the primary pointer is a finger). Drives lighter graphics and touch controls. */
export const IS_COARSE = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches
