export async function readInstalledVersion() {
  const [{ readFile }, { default: path }] = await Promise.all([
    import('node:fs/promises'),
    import('node:path'),
  ])
  for (const file of [
    path.join(process.cwd(), 'VERSION'),
    '/opt/openbot/current/VERSION',
  ]) {
    try { return (await readFile(file, 'utf8')).trim() } catch { /* try next */ }
  }
  return process.env.OPENBOT_VERSION ?? 'development'
}
