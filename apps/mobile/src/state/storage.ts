import Storage from 'expo-sqlite/kv-store'

// Small typed wrapper over Expo's synchronous key-value store (works in Expo
// Go, unlike MMKV). Device-local preferences only: nothing here is domain
// state, that lives on the server.
const PREFIX = 'openbot:'

export const storage = {
  get<T>(key: string): T | null {
    try {
      const raw = Storage.getItemSync(PREFIX + key)
      return raw == null ? null : (JSON.parse(raw) as T)
    } catch {
      return null
    }
  },
  set(key: string, value: unknown) {
    Storage.setItemSync(PREFIX + key, JSON.stringify(value))
  },
  remove(key: string) {
    Storage.removeItemSync(PREFIX + key)
  },
}
