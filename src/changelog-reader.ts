export function readChangelogFile(): Promise<string> {
  return Bun.file(new URL('../CHANGELOG.md', import.meta.url)).text()
}
