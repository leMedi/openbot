import { QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useState } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { createQueryClient } from '#/lib/query'
import { ThemeProvider, useTheme } from '#/theme'

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient)
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <ThemeProvider name="dark">
            <QueryClientProvider client={queryClient}>
              <Navigation />
            </QueryClientProvider>
          </ThemeProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

function Navigation() {
  const t = useTheme()
  return (
    <>
      <StatusBar style={t.name === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.palette.bg },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="connect" options={{ animation: 'fade' }} />
        <Stack.Screen name="conversations/index" />
        <Stack.Screen name="conversations/[id]" />
      </Stack>
    </>
  )
}
