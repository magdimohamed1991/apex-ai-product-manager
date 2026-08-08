import React, { createContext, useContext } from 'react'

export type ColorScheme = 'light' | 'dark' | 'system'

export interface ThemeContextValue {
  colorScheme: ColorScheme
  setColorScheme: (scheme: ColorScheme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export interface ThemeProviderProps {
  colorScheme?: ColorScheme
  onColorSchemeChange?: (scheme: ColorScheme) => void
  children: React.ReactNode
}

/**
 * ThemeProvider supplies color scheme context to all descendant components.
 * Wrap your app root with this provider to enable theme-aware components.
 */
export function ThemeProvider({
  colorScheme = 'system',
  onColorSchemeChange,
  children,
}: ThemeProviderProps): React.JSX.Element {
  const setColorScheme = (scheme: ColorScheme): void => {
    onColorSchemeChange?.(scheme)
  }

  return (
    <ThemeContext.Provider value={{ colorScheme, setColorScheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

/**
 * Returns the current theme context.
 * Must be used inside a ThemeProvider.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return ctx
}
