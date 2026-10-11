import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
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
  vi.restoreAllMocks()
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


const second = { ...todo, id: 'second-id', description: 'Walk dog' }
const third = { ...todo, id: 'third-id', description: 'Read book' }
const ordered = [todo, second, third]

function mockDragLayout() {
  // jsdom does not implement pointer capture; real browsers route moves/up
  // back to the handle while the pointer is outside its bounds.
  screen.getAllByRole('button', { name: /^Reorder / }).forEach((handle) => {
    handle.setPointerCapture = vi.fn()
  })
  const list = screen.getByRole('list')
  vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(
    { left: 0, right: 500, top: 100, bottom: 280, height: 180 } as DOMRect)
  screen.getAllByRole('listitem').forEach((row, i) => {
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(
      { left: 0, right: 500, top: 100 + i * 60, bottom: 160 + i * 60, height: 60 } as DOMRect)
  })
}

function startDrag(name: string, startY: number, destinationY: number, x = 20) {
  const handle = screen.getByRole('button', { name: `Reorder ${name}` })
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 20, clientY: startY })
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: x, clientY: destinationY })
  return handle
}

function descriptions() {
  return screen.getAllByRole('listitem').map((row) => row.querySelector('.todo-description')?.textContent)
}

describe('Reordering todos', () => {
  it.each([
    [third, 250, 101, todo.id, ['Read book', 'Buy milk', 'Walk dog']],
    [todo, 130, 210, third.id, ['Walk dog', 'Buy milk', 'Read book']],
    [todo, 130, 279, null, ['Walk dog', 'Read book', 'Buy milk']],
  ] as const)('shows the insertion position and persists a move for %s', async (moving, start, end, beforeId, expected) => {
    await renderList(ordered)
    mockDragLayout()
    fetchMock.mockResolvedValueOnce(response(moving))
    const handle = startDrag(moving.description, start, end)
    expect(handle.closest('li')?.classList.contains('is-dragging')).toBe(true)
    const indicator = beforeId === null ? screen.getByRole('list') :
      screen.getByRole('button', { name: `Reorder ${ordered.find((item) => item.id === beforeId)?.description}` }).closest('li')!
    expect(indicator.classList.contains(beforeId === null ? 'insert-end' : 'insert-before')).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fireEvent.pointerUp(handle, { pointerId: 1 })
    await waitFor(() => expect(descriptions()).toEqual(expected))
    expect(fetchMock.mock.calls[1]).toEqual([`/todos/${moving.id}/order`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ before_id: beforeId }),
    }])
    expect(document.querySelector('.insert-before, .insert-end, .is-dragging')).toBeNull()
  })

  it('preserves order and shows an error when a drop cannot be saved', async () => {
    await renderList(ordered)
    mockDragLayout()
    fetchMock.mockResolvedValueOnce(response({ detail: 'Could not save order' }, 503))
    const handle = startDrag(third.description, 250, 101)
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save order')
    expect(descriptions()).toEqual(ordered.map((item) => item.description))
    expect((handle as HTMLButtonElement).disabled).toBe(false)
  })

  it.each(['Escape', 'pointerCancel', 'lostCapture', 'outside', 'no-op', 'click'])('does not save a %s drag', async (kind) => {
    await renderList(ordered)
    mockDragLayout()
    const handle = startDrag(todo.description, 130,
      kind === 'click' ? 131 : kind === 'no-op' ? 170 : 279, kind === 'outside' ? 600 : 20)
    if (kind === 'Escape') fireEvent.keyDown(handle, { key: 'Escape' })
    if (kind === 'pointerCancel') fireEvent.pointerCancel(handle, { pointerId: 1 })
    if (kind === 'lostCapture') fireEvent.lostPointerCapture(handle, { pointerId: 1 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.insert-before, .insert-end, .is-dragging')).toBeNull()
    expect(descriptions()).toEqual(ordered.map((item) => item.description))
  })

  it('supports keyboard reordering from the handle', async () => {
    const user = await renderList(ordered)
    const handle = screen.getByRole('button', { name: 'Reorder Walk dog' })
    handle.focus()
    fetchMock.mockResolvedValueOnce(response(second))
    await user.keyboard('{ArrowUp}')
    await waitFor(() => expect(descriptions()).toEqual(['Walk dog', 'Buy milk', 'Read book']))
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ before_id: todo.id }))
    fetchMock.mockResolvedValueOnce(response(second))
    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect(descriptions()).toEqual(['Buy milk', 'Walk dog', 'Read book']))
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(JSON.stringify({ before_id: third.id }))
  })

  it('reorders a filtered list without losing hidden todos', async () => {
    const user = await renderList([todo, { ...second, completed: true }, third])
    await user.click(screen.getByRole('button', { name: 'Active', exact: true }))
    fetchMock.mockResolvedValueOnce(response(third))
    const handle = screen.getByRole('button', { name: 'Reorder Read book' })
    handle.focus()
    await user.keyboard('{ArrowUp}')
    await waitFor(() => expect(descriptions()).toEqual(['Read book', 'Buy milk']))
    await user.click(screen.getByRole('button', { name: 'All', exact: true }))
    expect(descriptions()).toEqual(['Read book', 'Buy milk', 'Walk dog'])
  })

  it('disables handles while saving and prevents overlapping moves', async () => {
    await renderList(ordered)
    let finish!: (value: Response) => void
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve }))
    const handle = screen.getByRole('button', { name: 'Reorder Read book' })
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    await waitFor(() => expect((handle as HTMLButtonElement).disabled).toBe(true))
    expect(screen.getByText('Saving order…')).toBeTruthy()
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(descriptions()).toEqual(ordered.map((item) => item.description))
    finish(response(third))
    await waitFor(() => expect(descriptions()).toEqual(['Buy milk', 'Read book', 'Walk dog']))
    expect((handle as HTMLButtonElement).disabled).toBe(false)
  })

  it('supports touch pointer dragging', async () => {
    await renderList(ordered)
    mockDragLayout()
    fetchMock.mockResolvedValueOnce(response(third))
    const handle = screen.getByRole('button', { name: 'Reorder Read book' })
    fireEvent.pointerDown(handle, { pointerType: 'touch', pointerId: 2, button: 0, clientX: 20, clientY: 250 })
    fireEvent.pointerMove(handle, { pointerType: 'touch', pointerId: 2, clientX: 20, clientY: 101 })
    expect(document.querySelector('.insert-before')).toBeTruthy()
    fireEvent.pointerUp(handle, { pointerType: 'touch', pointerId: 2 })
    await waitFor(() => expect(descriptions()).toEqual(['Read book', 'Buy milk', 'Walk dog']))
  })

})

describe('Action and drag regressions', () => {
  it('prevents duplicate creation while preserving a failed draft for retry', async () => {
    const user = await renderList([])
    const input = screen.getByLabelText('What needs doing?') as HTMLInputElement
    await user.type(input, 'Buy milk')
    let finish!: (value: Response) => void
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve }))
    const form = input.closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(input.disabled).toBe(true)
    finish(response({ detail: 'Try later' }, 503))
    expect((await screen.findByRole('alert')).textContent).toBe('Try later')
    expect(input.value).toBe('Buy milk')
    fetchMock.mockResolvedValueOnce(response(todo, 201))
    await user.click(screen.getByRole('button', { name: 'Add todo' }))
    expect(await screen.findByText('Buy milk')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('supports Escape and blank drafts without losing the saved description', async () => {
    const user = await renderList()
    await user.click(screen.getByRole('button', { name: 'Edit Buy milk' }))
    const input = screen.getByLabelText('Edit description')
    await user.clear(input)
    await user.type(input, '   ')
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.submit(input.closest('form')!)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await user.keyboard('{Escape}')
    expect(screen.queryByLabelText('Edit description')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Edit Buy milk' }))
    expect((screen.getByLabelText('Edit description') as HTMLInputElement).value).toBe('Buy milk')
  })

  it('guards duplicate edits and retains an in-flight edit when order changes', async () => {
    const user = await renderList(ordered)
    await user.click(screen.getByRole('button', { name: 'Edit Buy milk' }))
    const input = screen.getByLabelText('Edit description')
    await user.clear(input)
    await user.type(input, 'Buy bread')
    let finish!: (value: Response) => void
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve }))
    fireEvent.submit(input.closest('form')!)
    fireEvent.submit(input.closest('form')!)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    fetchMock.mockResolvedValueOnce(response(third))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Read book' }), { key: 'ArrowUp' })
    await screen.findByText('Order saved.')
    finish(response({ ...todo, description: 'Buy bread' }))
    await waitFor(() => expect(descriptions()).toEqual(['Buy bread', 'Read book', 'Walk dog']))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('aborts loading on unmount', async () => {
    fetchMock.mockImplementationOnce((_path, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')))
    }))
    const { unmount } = render(<App />)
    const signal = fetchMock.mock.calls[0][1]?.signal
    unmount()
    expect(signal?.aborted).toBe(true)
  })

  it.each([12, -12])('scrolls at the viewport edge (%s) and cancels the animation', async (speed) => {
    await renderList(ordered)
    mockDragLayout()
    vi.stubGlobal('innerHeight', 300)
    vi.stubGlobal('scrollY', 100)
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(1000)
    const scroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    const frames = vi.fn<typeof requestAnimationFrame>().mockReturnValue(42)
    const cancel = vi.fn()
    vi.stubGlobal('requestAnimationFrame', frames)
    vi.stubGlobal('cancelAnimationFrame', cancel)
    vi.mocked(screen.getByRole('list').getBoundingClientRect).mockReturnValue(
      { left: 0, right: 500, top: 0, bottom: 1000, height: 1000 } as DOMRect)
    const handle = startDrag(third.description, 250, speed > 0 ? 299 : 1)
    await waitFor(() => expect(frames).toHaveBeenCalled())
    act(() => frames.mock.calls[0][0](0))
    expect(scroll).toHaveBeenCalledWith(0, speed)
    fireEvent.pointerCancel(handle, { pointerId: 1 })
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(42))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
