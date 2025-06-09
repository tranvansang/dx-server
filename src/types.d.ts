/// <reference types="urlpattern-polyfill" />

declare global {
  // Make URLPattern available globally
  const URLPattern: typeof import('urlpattern-polyfill').URLPattern
  type URLPatternResult = import('urlpattern-polyfill').URLPatternResult
  type URLPatternComponentResult = import('urlpattern-polyfill').URLPatternComponentResult
}

export {}