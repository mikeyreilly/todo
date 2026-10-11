import { useEffect, useState } from 'preact/hooks'
import { createTodo, listTodos, updateTodo } from './api'
import type { Todo, TodoChanges } from './api'
import './app.css'

type Filter = 'all' | 'active' | 'completed'
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.'

function TodoItem({ todo, onUpdate }: {
  todo: Todo
  onUpdate: (id: string, changes: TodoChanges) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [description, setDescription] = useState(todo.description)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(changes: TodoChanges) {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await onUpdate(todo.id, changes)
      setEditing(false)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setEditing(false)
    setDescription(todo.description)
    setError('')
  }

  return (
    <li class={`todo-item ${todo.completed ? 'is-completed' : ''}`} aria-busy={saving}>
      <div class="todo-row">
        <input
          class="completion"
          type="checkbox"
          checked={todo.completed}
          disabled={saving || editing}
          aria-label={`Mark ${todo.description} ${todo.completed ? 'incomplete' : 'complete'}`}
          onChange={() => void save({ completed: !todo.completed })}
        />
        {editing ? (
          <form class="edit-form" onSubmit={(event) => {
            event.preventDefault()
            if (description.trim()) void save({ description: description.trim() })
          }}>
            <label class="sr-only" for={`edit-${todo.id}`}>Edit description</label>
            <input
              id={`edit-${todo.id}`}
              value={description}
              onInput={(event) => setDescription(event.currentTarget.value)}
              onKeyDown={(event) => { if (event.key === 'Escape' && !saving) cancel() }}
              maxLength={255}
              required
              autoFocus
              disabled={saving}
            />
            <div class="edit-actions">
              <button type="submit" disabled={saving || !description.trim()}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button class="secondary" type="button" disabled={saving} onClick={cancel}>Cancel</button>
            </div>
          </form>
        ) : (
          <>
            <span class="todo-description">{todo.description}</span>
            <button class="text-button" type="button" disabled={saving}
              aria-label={`Edit ${todo.description}`}
              onClick={() => {
                setDescription(todo.description)
                setError('')
                setEditing(true)
              }}>
              {saving ? 'Saving…' : 'Edit'}
            </button>
          </>
        )}
      </div>
      {error && <p class="error item-error" role="alert">{error}</p>}
    </li>
  )
}

export function App() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadError('')
    listTodos(controller.signal)
      .then((todos) => { if (!controller.signal.aborted) setTodos(todos) })
      .catch((error) => { if (!controller.signal.aborted) setLoadError(errorMessage(error)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [loadAttempt])

  async function addTodo() {
    const trimmed = description.trim()
    if (!trimmed || creating) return
    setCreating(true)
    setCreateError('')
    try {
      const todo = await createTodo(trimmed)
      setTodos((todos) => [...todos, todo])
      setDescription('')
      setFilter('all')
    } catch (error) {
      setCreateError(errorMessage(error))
    } finally {
      setCreating(false)
    }
  }

  async function editTodo(id: string, changes: TodoChanges) {
    const updated = await updateTodo(id, changes)
    setTodos((todos) => todos.map((todo) => todo.id === id ? updated : todo))
  }

  const remaining = todos.filter((todo) => !todo.completed).length
  const visible = todos.filter((todo) =>
    filter === 'all' || (filter === 'completed' ? todo.completed : !todo.completed))

  return (
    <main class="todo-app">
      <header class="page-header">
        <p class="eyebrow">ONE THING AT A TIME</p>
        <h1>Your todos.</h1>
        <p class="subtitle">A little less on your mind. A little more done.</p>
      </header>

      <section class="todo-card" aria-label="Todo list">
        <form class="create-form" onSubmit={(event) => { event.preventDefault(); void addTodo() }}>
          <label for="new-todo">What needs doing?</label>
          <div class="create-row">
            <input id="new-todo" placeholder="e.g. Pick up groceries"
              value={description} onInput={(event) => setDescription(event.currentTarget.value)}
              maxLength={255} required disabled={creating || loading || !!loadError} />
            <button type="submit" disabled={creating || loading || !!loadError || !description.trim()}>
              {creating ? 'Adding…' : 'Add todo'}
            </button>
          </div>
          {createError && <p class="error" role="alert">{createError}</p>}
        </form>

        {loading ? <p class="list-message" role="status">Loading your todos…</p> : loadError ? (
          <div class="list-message">
            <p class="error" role="alert">{loadError}</p>
            <button type="button" class="secondary" onClick={() => setLoadAttempt((n) => n + 1)}>Try again</button>
          </div>
        ) : (
          <>
            <div class="list-toolbar">
              <p class="remaining" role="status">{remaining} {remaining === 1 ? 'todo' : 'todos'} left</p>
              <div class="filters" role="group" aria-label="Filter todos">
                {(['all', 'active', 'completed'] as const).map((value) => (
                  <button key={value} type="button" aria-pressed={filter === value}
                    onClick={() => setFilter(value)}>{value === 'all' ? 'All' : value === 'active' ? 'Active' : 'Completed'}</button>
                ))}
              </div>
            </div>
            {visible.length ? (
              <ul class="todo-list">
                {visible.map((todo) => <TodoItem key={todo.id} todo={todo} onUpdate={editTodo} />)}
              </ul>
            ) : (
              <div class="empty-state">
                <span class="empty-icon" aria-hidden="true">✓</span>
                <h2>{todos.length === 0 ? 'A fresh start.' : filter === 'active' ? 'All caught up.' : 'Nothing here yet.'}</h2>
                <p>{todos.length === 0 ? 'Add your first todo above.' : filter === 'active' ? 'Enjoy a little breathing room.' : 'Try another filter to see your todos.'}</p>
              </div>
            )}
          </>
        )}
      </section>
      <footer class="page-footer">Small steps count.</footer>
    </main>
  )
}
