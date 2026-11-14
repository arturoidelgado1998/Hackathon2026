import { useEffect, useSyncExternalStore } from 'react'
import type { Decision, Incident } from '../types.ts'
import type { ResponsePanelView, Scenario } from '../viewModels.ts'
import { decisionKey, decisionKeys, getDriverDesk, type NoticeDesk } from './desk.ts'
import { buildDraft } from './draft.ts'
import { DriverNoticePanel } from './DriverNoticePanel.tsx'

export interface DriverNoticeDeskProps {
  /** The response panel's view of the selected shipment, or null. */
  view: ResponsePanelView | null
  scenario: Scenario
  /** Committed decisions only. Previews are deliberately not an input. */
  decisions: Readonly<Record<string, Decision>>
  /** The confirmed incident, or null in normal operations. */
  incident: Incident | null
  /** Defaults to the dashboard's shared desk. Tests pass their own. */
  desk?: NoticeDesk
}

/**
 * Connects the dashboard to the notice desk. Always mounted, so a decision
 * that changes after Send marks the driver's notice as under revision even
 * when another shipment is selected. Shows the panel for the selected
 * shipment once it has a decision or a sent notice.
 */
export function DriverNoticeDesk({
  view,
  scenario,
  decisions,
  incident,
  desk = getDriverDesk(),
}: DriverNoticeDeskProps) {
  const sentByShipment = useSyncExternalStore(desk.subscribe, desk.getSnapshot)

  useEffect(() => {
    desk.reconcile(decisionKeys(decisions, scenario))
  }, [desk, decisions, scenario])

  if (!view) return null
  const shipmentId = view.shipment.id
  const decision = decisions[shipmentId]
  const sent = sentByShipment[shipmentId]
  if (!decision && !sent) return null

  const draft = decision && incident ? buildDraft(view, decision, incident) : null
  const key = decision ? decisionKey(decision, scenario) : null
  return (
    <DriverNoticePanel
      shipmentId={shipmentId}
      draft={draft}
      sent={sent?.notice}
      isCurrent={sent?.notice.state === 'active' && sent.decisionKey === key}
      onSend={draft && key ? () => desk.send(draft, key) : undefined}
    />
  )
}
