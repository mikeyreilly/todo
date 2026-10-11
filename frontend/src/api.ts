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

const writeTodo = (path: string, body: unknown, method = 'PATCH') =>
  request<Todo>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

export const createTodo = (description: string) =>
  writeTodo('/todos', { description }, 'POST')

export const updateTodo = (id: string, changes: TodoChanges) =>
  writeTodo(`/todos/${encodeURIComponent(id)}`, changes)

export const reorderTodo = (id: string, beforeId: string | null) =>
  writeTodo(`/todos/${encodeURIComponent(id)}/order`, { before_id: beforeId })
