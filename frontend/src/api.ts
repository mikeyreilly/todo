export interface Todo {
  id: string
  description: string
  completed: boolean
}

export type TodoChanges = Partial<Pick<Todo, 'description' | 'completed'>>

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, options)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error('Could not reach the server. Check your connection and try again.')
  }
  if (!response.ok) {
    let message = `Request failed (${response.status}). Please try again.`
    try {
      const body = await response.json()
      if (typeof body.detail === 'string') message = body.detail
      else if (Array.isArray(body.detail)) {
        message = body.detail.map((entry: { msg: string }) => entry.msg).join('; ')
      }
    } catch {
      // A proxy or server may return a non-JSON error page.
    }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

export const listTodos = (signal?: AbortSignal) =>
  request<Todo[]>('/todos', { signal })

export const createTodo = (description: string) =>
  request<Todo>('/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  })

export const updateTodo = (id: string, changes: TodoChanges) =>
  request<Todo>(`/todos/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  })

export const reorderTodo = (id: string, beforeId: string | null) =>
  request<Todo>(`/todos/${encodeURIComponent(id)}/order`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ before_id: beforeId }),
  })
