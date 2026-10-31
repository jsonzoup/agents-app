"use client"

import * as React from "react"
import { cn } from "cn"
import { Popover as PopoverPrimitive } from "radix-ui"
import { ChevronDownIcon, CheckIcon, SearchIcon } from "lucide-react"

/**
 * Searchable select. Same parts as the usual Radix select (`Select`, `SelectTrigger`, `SelectValue`,
 * `SelectContent`, `SelectGroup`, `SelectLabel`, `SelectItem`, `SelectSeparator`), but the list opens
 * with a search box that filters items by their text and value.
 */

interface Entry {
  node: React.ReactNode
  text: string
  disabled?: boolean
}

interface SelectContextValue {
  value: string | undefined
  select: (value: string) => void
  open: boolean
  setOpen: (open: boolean) => void
  disabled?: boolean
  query: string
  setQuery: (query: string) => void
  active: string | null
  setActive: (value: string | null) => void
  entries: Map<string, Entry>
  upsert: (value: string, entry: Entry) => void
  remove: (value: string) => void
}

const SelectContext = React.createContext<SelectContextValue | null>(null)

function useSelect() {
  const ctx = React.useContext(SelectContext)
  if (!ctx) throw new Error("Select parts must be used inside <Select>")
  return ctx
}

function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(" ")
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children)
  return ""
}

function matches(query: string, value: string, text: string) {
  const hay = `${text} ${value}`.toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))
}

function Select({
  value: controlled,
  defaultValue,
  onValueChange,
  open: openProp,
  onOpenChange,
  disabled,
  name,
  required,
  children,
}: {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
  name?: string
  required?: boolean
  children?: React.ReactNode
}) {
  const [own, setOwn] = React.useState(defaultValue)
  const [ownOpen, setOwnOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [active, setActive] = React.useState<string | null>(null)
  const [, bump] = React.useReducer((n: number) => n + 1, 0)
  const entries = React.useRef(new Map<string, Entry>()).current
  const value = controlled ?? own
  const open = openProp ?? ownOpen

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (next) {
        setQuery("")
        setActive(value ?? null)
      }
      setOwnOpen(next)
      onOpenChange?.(next)
    },
    [onOpenChange, value]
  )

  const ctx: SelectContextValue = {
    value,
    select: (v) => {
      if (controlled === undefined) setOwn(v)
      if (v !== value) onValueChange?.(v)
      setOpen(false)
    },
    open,
    setOpen,
    disabled,
    query,
    setQuery,
    active,
    setActive,
    entries,
    upsert: (v, e) => {
      const old = entries.get(v)
      entries.set(v, e)
      if (!old || old.text !== e.text || old.disabled !== e.disabled) bump()
    },
    remove: (v) => {
      if (entries.delete(v)) bump()
    },
  }

  return (
    <SelectContext.Provider value={ctx}>
      <PopoverPrimitive.Root data-slot="select" open={open} onOpenChange={setOpen} modal>
        {children}
      </PopoverPrimitive.Root>
      {name && <input type="hidden" name={name} value={value ?? ""} required={required} />}
    </SelectContext.Provider>
  )
}

function SelectGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="group"
      data-slot="select-group"
      className={cn("scroll-my-1 p-1 [&:not(:has([data-slot=select-item]:not([hidden])))]:hidden", className)}
      {...props}
    />
  )
}

function SelectValue({ placeholder, className, ...props }: React.ComponentProps<"span"> & { placeholder?: React.ReactNode }) {
  const { value, entries } = useSelect()
  const entry = value === undefined ? undefined : entries.get(value)
  return (
    <span data-slot="select-value" className={className} {...props}>
      {entry ? entry.node : value || placeholder}
    </span>
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  onKeyDown,
  disabled,
  ...props
}: React.ComponentProps<"button"> & {
  size?: "sm" | "default"
}) {
  const { value, entries, open, setOpen, setQuery, disabled: rootDisabled } = useSelect()
  const empty = value === undefined || value === "" || !entries.has(value)
  return (
    <PopoverPrimitive.Trigger asChild>
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        data-slot="select-trigger"
        data-size={size}
        data-placeholder={empty && !value ? "" : undefined}
        disabled={disabled ?? rootDisabled}
        onKeyDown={(e) => {
          onKeyDown?.(e)
          if (e.defaultPrevented || open) return
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault()
            setOpen(true)
          } else if (e.key.length === 1 && e.key !== " " && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault()
            setOpen(true)
            setQuery(e.key)
          }
        }}
        className={cn(
          "flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
      </button>
    </PopoverPrimitive.Trigger>
  )
}

const ITEMS = "[data-slot=select-item]:not([hidden]):not([data-disabled])"

function SelectContent({
  className,
  children,
  align = "start",
  placeholder = "搜索…",
}: {
  className?: string
  children?: React.ReactNode
  align?: "start" | "center" | "end"
  /** Accepted for compatibility with the Radix select; the list always opens below or above the trigger. */
  position?: "item-aligned" | "popper"
  placeholder?: string
}) {
  const { open, query, setQuery, active, setActive, value, select, entries } = useSelect()
  const list = React.useRef<HTMLDivElement>(null)
  const shown = [...entries].filter(([v, e]) => matches(query, v, e.text)).length

  const visible = () => [...(list.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])]
  const reveal = (v: string | null) =>
    v !== null && list.current?.querySelector(`[data-slot=select-item][data-value="${CSS.escape(v)}"]`)?.scrollIntoView({ block: "nearest" })

  React.useEffect(() => {
    if (!open) return
    if (query) {
      const first = visible()[0]?.dataset.value ?? null
      setActive(first)
      list.current?.scrollTo({ top: 0 })
    } else requestAnimationFrame(() => reveal(value ?? null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query])

  if (!open) return <div hidden>{children}</div>

  function onKeyDown(e: React.KeyboardEvent) {
    const items = visible().map((el) => el.dataset.value!)
    const at = active === null ? -1 : items.indexOf(active)
    let next: string | undefined
    if (e.key === "ArrowDown") next = items[Math.min(at + 1, items.length - 1)]
    else if (e.key === "ArrowUp") next = items[Math.max(at - 1, 0)]
    else if (e.key === "Home") next = items[0]
    else if (e.key === "End") next = items[items.length - 1]
    else if (e.key === "Enter") {
      e.preventDefault()
      const pick = at >= 0 ? items[at] : items.length === 1 ? items[0] : undefined
      if (pick !== undefined) select(pick)
      return
    } else return
    e.preventDefault()
    if (next !== undefined) {
      setActive(next)
      reveal(next)
    }
  }

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="select-content"
        align={align}
        sideOffset={4}
        onKeyDown={onKeyDown}
        className="z-50 flex max-h-(--radix-popover-content-available-height) w-auto max-w-[min(36rem,90vw)] min-w-(--radix-popover-trigger-width) origin-(--radix-popover-content-transform-origin) flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
      >
        <div className="flex items-center gap-1.5 border-b px-2.5">
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            data-slot="select-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="h-8 w-full min-w-24 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div ref={list} role="listbox" className={cn("max-h-80 min-h-0 overflow-x-hidden overflow-y-auto p-1", className)}>
          {children}
          {shown === 0 && <div className="px-2 py-4 text-center text-xs text-muted-foreground">没有匹配的选项</div>}
        </div>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
}

function SelectLabel({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="select-label" className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)} {...props} />
}

function SelectItem({
  className,
  children,
  value,
  disabled,
  textValue,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  value: string
  disabled?: boolean
  /** Text to search on when the children are not plain text. */
  textValue?: string
  children?: React.ReactNode
}) {
  const ctx = useSelect()
  const text = textValue ?? textOf(children)
  React.useLayoutEffect(() => ctx.upsert(value, { node: children, text, disabled }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useLayoutEffect(() => () => ctx.remove(value), [value])
  const selected = ctx.value === value
  return (
    <div
      role="option"
      aria-selected={selected}
      data-slot="select-item"
      data-value={value}
      data-highlighted={ctx.active === value ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
      hidden={!matches(ctx.query, value, text)}
      onPointerMove={() => !disabled && ctx.active !== value && ctx.setActive(value)}
      onClick={() => !disabled && ctx.select(value)}
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">{selected && <CheckIcon className="pointer-events-none" />}</span>
      {children}
    </div>
  )
}

function SelectSeparator({ className, ...props }: React.ComponentProps<"div">) {
  const { query } = useSelect()
  if (query) return null
  return <div data-slot="select-separator" className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)} {...props} />
}

/** Kept for compatibility; the list scrolls natively. */
function SelectScrollUpButton() {
  return null
}

/** Kept for compatibility; the list scrolls natively. */
function SelectScrollDownButton() {
  return null
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
