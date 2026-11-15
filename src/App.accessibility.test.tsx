import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { axe } from 'vitest-axe'
import App, { type AppProps } from './App.tsx'

describe('dashboard accessibility', () => {
  it.each([
    { name: 'no selection', props: {} },
    { name: 'no affected shipments', props: {}, button: 'Normal' },
    { name: 'comparison and explanations', props: {}, shipmentId: 'S-01', explanations: true },
    { name: 'no feasible response', props: {}, shipmentId: 'S-03' },
    { name: 'incident interpretation loading', props: { incidentInterpretationStatus: 'loading' } },
    { name: 'AI unavailable', props: { incidentInterpretationStatus: 'unavailable' } },
  ] satisfies {
    name: string
    props: AppProps
    button?: string
    shipmentId?: string
    explanations?: boolean
  }[])('has no serious or critical axe violations: $name', async (sample) => {
    const { container } = render(<App {...sample.props} />)
    if ('button' in sample) fireEvent.click(screen.getByRole('button', { name: sample.button }))
    if ('shipmentId' in sample) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${sample.shipmentId}`) }))
    }
    if ('explanations' in sample) {
      fireEvent.click(screen.getByRole('button', { name: 'Why? (Reroute)' }))
      fireEvent.click(screen.getByRole('button', { name: /Assumptions & sources.*Expand panel/ }))
    }
    await screen.findByTestId('arcgis-map')

    const results = await axe(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      // jsdom has no layout engine. Contrast is checked separately in a real browser.
      rules: { 'color-contrast': { enabled: false } },
    })
    expect(
      results.violations
        .filter(({ impact }) => impact === 'serious' || impact === 'critical')
        .map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })),
    ).toEqual([])
  })
})
