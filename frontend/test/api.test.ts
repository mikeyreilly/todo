import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { listTodos, reorderTodo, updateTodo } from '../src//api'

const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => vi.stubGlobal('fetch', fetchMock.mockReset()))
afterEach(() => vi.unstubAllGlobals())

it.each([
  [{ detail: 'Todo not found' }, 'Todo not found'],
  [{ detail: [{ msg: 'Too short' }, { msg: 'Required' }] }, 'Too short; Required'],
  [{}, 'Request failed (422). Please try again.'],
])('preserves server errors: %j', async (body, message) => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 422 }))
  await expect(listTodos()).rejects.toThrow(message)
})

it('handles non-JSON error pages', async () => {
  fetchMock.mockResolvedValueOnce(new Response('<html>Unavailable</html>', { status: 503 }))
  await expect(listTodos()).rejects.toThrow('Request failed (503). Please try again.')
})

it('distinguishes aborted loads from network failures', async () => {
  const signal = new AbortController().signal
  const aborted = new DOMException('Cancelled', 'AbortError')
  fetchMock.mockRejectedValueOnce(aborted)
  await expect(listTodos(signal)).rejects.toBe(aborted)
  expect(fetchMock).toHaveBeenLastCalledWith('/todos', { signal })
  fetchMock.mockRejectedValueOnce(new TypeError('offline'))
  await expect(listTodos()).rejects.toThrow('Could not reach the server. Check your connection and try again.')
})

it('encodes IDs and shares JSON write setup', async () => {
  fetchMock.mockImplementation(async () => new Response('{}'))
  await updateTodo('a/b', { completed: false })
  await reorderTodo('a/b', null)
  expect(fetchMock.mock.calls).toEqual([
    ['/todos/a%2Fb', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"completed":false}',
    }],
    ['/todos/a%2Fb/order', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"before_id":null}',
    }],
  ])
})
