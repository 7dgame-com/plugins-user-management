export function isIdentityEnabled(): boolean {
  const runtime = (window as unknown as { __ENV__?: Record<string, string> })
    .__ENV__
  return (
    (runtime?.AUTH_PROVIDER || import.meta.env.VITE_AUTH_PROVIDER || 'legacy')
      .trim()
      .toLowerCase() === 'identity'
  )
}
