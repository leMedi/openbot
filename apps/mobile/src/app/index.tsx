import { Redirect } from 'expo-router'
import { useServerUrl } from '#/state/server'

// Entry: no server yet → connect screen, otherwise straight to the list.
export default function Index() {
  const serverUrl = useServerUrl()
  return <Redirect href={serverUrl ? '/conversations' : '/connect'} />
}
