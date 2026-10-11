import { cleanup, render, screen, waitFor } from '@testing-library/preact'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './app'

const todo = { id: '01a12b40-8ad1-75c6-a653-1be68d332b0a', description: 'Buy milk', completed: false }
const fetchMock = vi.fn<typeof fetch>()
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function renderList(todos = [todo]) {
  fetchMock.mockResolvedValueOnce(response(todos))
  render(<App />)
  await screen.findByText(`${todos.filter((item) => !item.completed).length} todos left`.replace('1 todos', '1 todo'))
  return userEvent.setup()
}

describe('Todo app', () => {
  it('shows loading, then an empty state', async () => {
    fetchMock.mockResolvedValueOnce(response([]))
    render(<App />)
    expect(screen.getByText('Loading your todos…')).toBeTruthy()
    expect(await screen.findByText('A fresh start.')).toBeTruthy()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/todos')
  })

  it('creates a trimmed todo and clears the input', async () => {
    const user = await renderList([])
    fetchMock.mockResolvedValueOnce(response(todo, 201))
    const input = screen.getByLabelText('What needs doing?') as HTMLInputElement
    await user.type(input, '  Buy milk  ')
    await user.click(screen.getByRole('button', { name: 'Add todo' }))
    expect(await screen.findByText('Buy milk')).toBeTruthy()
    expect(input.value).toBe('')
    expect(fetchMock.mock.calls[1]).toEqual(['/todos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Buy milk' }),
    }])
  })

  it('marks a todo complete and then incomplete', async () => {
    const user = await renderList()
    fetchMock.mockResolvedValueOnce(response({ ...todo, completed: true }))
    await user.click(screen.getByRole('checkbox', { name: 'Mark Buy milk complete' }))
    const checkbox = await screen.findByRole('checkbox', { name: 'Mark Buy milk incomplete' }) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/todos/${todo.id}`)
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe('{"completed":true}')
    fetchMock.mockResolvedValueOnce(response(todo))
    await waitFor(() => expect(checkbox.disabled).toBe(false))
    await user.click(checkbox)
    expect(await screen.findByRole('checkbox', { name: 'Mark Buy milk complete' })).toBeTruthy()
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe('{"completed":false}')
  })

  it('edits a description and supports cancel without saving', async () => {
    const user = await renderList()
    await user.click(screen.getByRole('button', { name: 'Edit Buy milk' }))
    const input = screen.getByLabelText('Edit description')
    await user.clear(input)
    await user.type(input, 'Buy bread')
    fetchMock.mockResolvedValueOnce(response({ ...todo, description: 'Buy bread' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Buy bread')).toBeTruthy()
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe('{"description":"Buy bread"}')
    await user.click(screen.getByRole('button', { name: 'Edit Buy bread' }))
    await user.clear(screen.getByLabelText('Edit description'))
    await user.type(screen.getByLabelText('Edit description'), 'Not saved')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Buy bread')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('filters active and completed todos', async () => {
    const user = await renderList([todo, { ...todo, id: 'another-id', description: 'Walk dog', completed: true }])
    await user.click(screen.getByRole('button', { name: 'Active', exact: true }))
    expect(screen.getByText('Buy milk')).toBeTruthy()
    expect(screen.queryByText('Walk dog')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Completed', exact: true }))
    expect(screen.getByText('Walk dog')).toBeTruthy()
    expect(screen.queryByText('Buy milk')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'All', exact: true }))
    expect(screen.getByText('Buy milk')).toBeTruthy()
  })

  it('shows load failures and retries', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    render(<App />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    fetchMock.mockResolvedValueOnce(response([todo]))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Buy milk')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('preserves input on failed creation and rejects whitespace-only input', async () => {
    const user = await renderList([])
    const input = screen.getByLabelText('What needs doing?') as HTMLInputElement
    await user.type(input, '   ')
    expect((screen.getByRole('button', { name: 'Add todo' }) as HTMLButtonElement).disabled).toBe(true)
    await user.clear(input)
    await user.type(input, 'Buy milk')
    fetchMock.mockResolvedValueOnce(response({ detail: 'Database unavailable' }, 503))
    await user.click(screen.getByRole('button', { name: 'Add todo' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Database unavailable')
    expect(input.value).toBe('Buy milk')
    expect(screen.queryByText('Buy milk')).toBeNull()
  })

  it('does not mark a todo completed when the update fails', async () => {
    const user = await renderList()
    fetchMock.mockResolvedValueOnce(response({ detail: 'Todo not found' }, 404))
    await user.click(screen.getByRole('checkbox'))
    expect((await screen.findByRole('alert')).textContent).toBe('Todo not found')
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText('1 todo left')).toBeTruthy()
  })

  it('keeps the edit form and draft when saving fails', async () => {
    const user = await renderList()
    await user.click(screen.getByRole('button', { name: 'Edit Buy milk' }))
    await user.clear(screen.getByLabelText('Edit description'))
    await user.type(screen.getByLabelText('Edit description'), 'Buy bread')
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert')
    expect((screen.getByLabelText('Edit description') as HTMLInputElement).value).toBe('Buy bread')
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
