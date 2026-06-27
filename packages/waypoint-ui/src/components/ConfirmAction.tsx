import { useState } from 'react'

export function ConfirmAction({
  label,
  confirmLabel = 'Confirm',
  withNote,
  disabled,
  onConfirm,
}: {
  label: string
  confirmLabel?: string
  withNote?: boolean
  disabled?: boolean
  onConfirm: (note?: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [note, setNote] = useState('')

  if (!confirming) {
    return (
      <button type="button" disabled={disabled} onClick={() => setConfirming(true)}>
        {label}
      </button>
    )
  }

  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {withNote ? (
        <input
          type="text"
          placeholder="note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ fontSize: 12 }}
        />
      ) : null}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          onConfirm(withNote ? note : undefined)
          setConfirming(false)
          setNote('')
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" onClick={() => { setConfirming(false); setNote('') }}>
        Cancel
      </button>
    </span>
  )
}
