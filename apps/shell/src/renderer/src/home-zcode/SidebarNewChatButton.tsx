// ZCode-style full-width "new chat" button for the home sidebar — the visual
// twin of ZCode's NewTaskButtonGroup (MessageCirclePlus + label, ghost row
// with hover fill; see docs/plans/2026-11-19-zcode-ui-consistency.md).
// Renders the SAME `.side-new-row` geometry as the six new-file rows so all
// eight rows align by construction (icon box, padding, pitch).
// Session-creation logic stays in Home (it owns the chat store and the
// open-signal wiring); this component is presentational only.
import { MessageCirclePlusIcon } from '@chaoffice/ui'

export function SidebarNewChatButton({
  label,
  onClick,
}: {
  readonly label: string
  readonly onClick: () => void
}) {
  return (
    <button className="side-new-row" onClick={onClick} title={label} aria-label={label}>
      <MessageCirclePlusIcon size={16} />
      <span className="side-new-label">{label}</span>
    </button>
  )
}
