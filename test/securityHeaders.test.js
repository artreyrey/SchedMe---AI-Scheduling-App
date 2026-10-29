import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('declares production browser security headers without inline scripts', async () => {
  const deployment = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'))
  const headers = Object.fromEntries(deployment.headers[0].headers.map(({ key, value }) => [key, value]))
  const document = await readFile(new URL('../index.html', import.meta.url), 'utf8')

  assert.match(headers['Content-Security-Policy'], /default-src 'self'/)
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/)
  assert.match(headers['Content-Security-Policy'], /firebasevertexai|\*\.googleapis\.com/)
  assert.equal(headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(headers['X-Frame-Options'], 'DENY')
  assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin')
  assert.match(headers['Permissions-Policy'], /microphone=\(\)/)
  assert.doesNotMatch(document, /<script>(.|\s)*<\/script>/)
})
