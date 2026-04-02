// Jest setup — runs after the test framework is installed in the environment
import '@testing-library/jest-dom'

// Polyfill TextEncoder / TextDecoder — required by Supabase client in jsdom
import { TextEncoder, TextDecoder } from 'util'
global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder as any

// Polyfill fetch — required by Supabase and Next.js server actions in tests
import 'whatwg-fetch'

// Suppress noisy console.error from React in test output (keep console.warn)
const originalConsoleError = console.error
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation((...args: any[]) => {
    // Allow through errors that aren't React "act" warnings
    if (
      typeof args[0] === 'string' &&
      (args[0].includes('Warning: An update to') ||
       args[0].includes('Warning: ReactDOM.render') ||
       args[0].includes('act(...)'))
    ) {
      return
    }
    originalConsoleError(...args)
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})
