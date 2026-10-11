import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { createTodo, listTodos, reorderTodo, updateTodo } from './api'
import type { Todo, TodoChanges } from './api'
import './app.css'

type Filter = 'all' | 'active' | 'completed'
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.'

type Drag = {
  id: string
  pointerId: number
  x: number
  y: number
  active: boolean
  beforeId: string | null | undefined
}

type HandleEvents = Pick<JSX.HTMLAttributes<HTMLButtonElement>,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture' | 'onKeyDown'>

// Each action owns its error and guards overlapping calls, even before a render.
function useAction() {
  const [state, setState] = useState({ pending: false, error: '' })
  const busy = useRef(false)
  const reset = () => setState({ pending: false, error: '' })
  async function run(action: () => Promise<void>) {
    if (busy.current) return
    busy.current = true
    setState({ pending: true, error: '' })
    let error = ''
    try {
      await action()
    } catch (cause) {
      error = errorMessage(cause)
    } finally {
      busy.current = false
      setState({ pending: false, error })
    }
  }
  return { ...state, busy, run, reset }
}

function TodoItem({ todo, onUpdate, locked, dragging, insertBefore, handleEvents }: {
  todo: Todo
  locked: boolean
  dragging: boolean
  insertBefore: boolean
  handleEvents: HandleEvents
  onUpdate: (id: string, changes: TodoChanges) => Promise<void>
}) {
  const [description, setDescription] = useState<string | null>(null)
  const editing = description !== null
  const { pending: saving, error, run, reset } = useAction()
  const save = (changes: TodoChanges) => run(async () => {
    await onUpdate(todo.id, changes)
    setDescription(null)
  })
  function cancel() {
    setDescription(null)
    reset()
  }

  return (
    <li data-todo-id={todo.id}
      class={`todo-item ${todo.completed ? 'is-completed' : ''} ${dragging ? 'is-dragging' : ''} ${insertBefore ? 'insert-before' : ''}`}
      aria-busy={saving}>
      <div class="todo-row">
        <button type="button" class="drag-handle" disabled={saving || editing || locked}
          aria-label={`Reorder ${todo.description}`} aria-describedby="reorder-help"
          {...handleEvents}>
          <svg width="16" height="22" viewBox="0 0 16 22" fill="currentColor" aria-hidden="true">
            {[5, 11, 17].map((y) => <g key={y}><circle cx="5" cy={y} r="1.5" /><circle cx="11" cy={y} r="1.5" /></g>)}
          </svg>
        </button>
        <input
          class="completion"
          type="checkbox"
          checked={todo.completed}
          disabled={saving || editing || locked}
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
            <button class="text-button" type="button" disabled={saving || locked}
              aria-label={`Edit ${todo.description}`}
              onClick={() => {
                setDescription(todo.description)
                reset()
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
  const creation = useAction()
  const [filter, setFilter] = useState<Filter>('all')
  const [dragPosition, setDragPosition] = useState<Pick<Drag, 'id' | 'beforeId'> | null>(null)
  const draggingId = dragPosition?.id
  const dropBefore = dragPosition?.beforeId
  const order = useAction()
  const [orderSaved, setOrderSaved] = useState(false)
  const orderStatus = order.pending ? 'Saving order…' : order.error || !orderSaved ? '' : 'Order saved.'
  const listRef = useRef<HTMLUListElement>(null)
  const dragRef = useRef<Drag | null>(null)

  function cancelDrag() {
    dragRef.current = null
    setDragPosition(null)
  }

  function updateDropPosition(drag: Drag) {
    const list = listRef.current
    if (!list) return
    const bounds = list.getBoundingClientRect()
    if (drag.x < bounds.left || drag.x > bounds.right ||
        drag.y < bounds.top - 16 || drag.y > bounds.bottom + 16) {
      drag.beforeId = undefined
    } else {
      drag.beforeId = Array.from(list.querySelectorAll<HTMLElement>('[data-todo-id]')).find((row) => {
        const rect = row.getBoundingClientRect()
        return row.dataset.todoId !== drag.id && drag.y < rect.top + rect.height / 2
      })?.dataset.todoId ?? null
    }
    setDragPosition({ id: drag.id, beforeId: drag.beforeId })
  }

  // Pointer capture keeps events on the handle; scroll near viewport edges
  // so long lists can be reordered without releasing the mouse/finger.
  useEffect(() => {
    if (!draggingId) return
    let frame: number
    function scroll() {
      const drag = dragRef.current
      const bounds = listRef.current?.getBoundingClientRect()
      if (!drag?.active || !bounds) return
      if (drag.x >= bounds.left && drag.x <= bounds.right) {
        const edge = 56
        const speed = drag.y < edge ? -12 : drag.y > window.innerHeight - edge ? 12 : 0
        if ((speed < 0 && window.scrollY > 0) ||
            (speed > 0 && window.scrollY + window.innerHeight < document.documentElement.scrollHeight)) {
          window.scrollBy(0, speed)
          updateDropPosition(drag)
        }
      }
      frame = requestAnimationFrame(scroll)
    }
    frame = requestAnimationFrame(scroll)
    return () => cancelAnimationFrame(frame)
  }, [draggingId])

  function moveTodo(id: string, beforeId: string | null) {
    const index = todos.findIndex((todo) => todo.id === id)
    if (index < 0 || beforeId === id || (todos[index + 1]?.id ?? null) === beforeId) return
    return order.run(async () => {
      await reorderTodo(id, beforeId)
      setTodos((current) => {
        const moving = current.find((todo) => todo.id === id)
        if (!moving) return current
        const rest = current.filter((todo) => todo.id !== id)
        const destination = beforeId === null ? rest.length : rest.findIndex((todo) => todo.id === beforeId)
        if (destination < 0) return current
        return [...rest.slice(0, destination), moving, ...rest.slice(destination)]
      })
      setOrderSaved(true)
    })
  }

  function handleEvents(id: string): HandleEvents {
    return {
      onPointerDown(event) {
        if (event.button !== 0 || creation.busy.current || order.busy.current || dragRef.current) return
        dragRef.current = {
          id, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
          active: false, beforeId: undefined,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      },
      onPointerMove(event) {
        const drag = dragRef.current
        const list = listRef.current
        if (!drag || drag.pointerId !== event.pointerId || !list) return
        if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return
        drag.active = true
        setOrderSaved(false)
        event.preventDefault()
        drag.x = event.clientX
        drag.y = event.clientY
        updateDropPosition(drag)
      },
      onPointerUp(event) {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        cancelDrag()
        if (drag.active && drag.beforeId !== undefined) void moveTodo(id, drag.beforeId)
      },
      onPointerCancel: cancelDrag,
      onLostPointerCapture: cancelDrag,
      onKeyDown(event) {
        if (event.key === 'Escape') { cancelDrag(); return }
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        if (dragRef.current) return
        const index = visible.findIndex((todo) => todo.id === id)
        if (event.key === 'ArrowUp' && index > 0) void moveTodo(id, visible[index - 1].id)
        if (event.key === 'ArrowDown' && index < visible.length - 1) {
          void moveTodo(id, visible[index + 2]?.id ?? null)
        }
      },
    }
  }

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

  function addTodo() {
    const trimmed = description.trim()
    if (!trimmed) return
    return creation.run(async () => {
      const todo = await createTodo(trimmed)
      setTodos((todos) => [...todos, todo])
      setDescription('')
      setFilter('all')
    })
  }

  async function editTodo(id: string, changes: TodoChanges) {
    const updated = await updateTodo(id, changes)
    setTodos((todos) => todos.map((todo) => todo.id === id ? updated : todo))
  }

  const orderingLocked = order.pending || !!draggingId
  const createLocked = creation.pending || loading || !!loadError || orderingLocked
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
              maxLength={255} required disabled={createLocked} />
            <button type="submit" disabled={createLocked || !description.trim()}>
              {creation.pending ? 'Adding…' : 'Add todo'}
            </button>
          </div>
          {creation.error && <p class="error" role="alert">{creation.error}</p>}
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
                  <button key={value} type="button" disabled={orderingLocked} aria-pressed={filter === value}
                    onClick={() => setFilter(value)}>{value[0].toUpperCase() + value.slice(1)}</button>
                ))}
              </div>
            </div>
            <p id="reorder-help" class="sr-only">Drag a handle to reorder, or use Arrow Up and Arrow Down. Escape cancels dragging.</p>
            <p class="order-status" role="status">{orderStatus}</p>
            {order.error && <p class="error reorder-error" role="alert">{order.error}</p>}
            {visible.length ? (
              <ul ref={listRef} class={`todo-list ${draggingId && dropBefore === null ? 'insert-end' : ''}`}
                aria-busy={order.pending}>
                {visible.map((todo) => <TodoItem key={todo.id} todo={todo} onUpdate={editTodo}
                  locked={order.pending || creation.pending || (!!draggingId && draggingId !== todo.id)}
                  dragging={draggingId === todo.id} insertBefore={!!draggingId && dropBefore === todo.id}
                  handleEvents={handleEvents(todo.id)} />)}
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
