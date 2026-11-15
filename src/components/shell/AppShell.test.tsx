import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppShell, type AppShellProps } from './AppShell.tsx'

function renderShell(overrides: Partial<AppShellProps> = {}) {
  const props: AppShellProps = {
    scenario: 'normal',
    onScenarioChange: vi.fn(),
    onReset: vi.fn(),
    onReportIncident: vi.fn(),
    indicators: <span>indicators-slot</span>,
    board: <span>board-slot</span>,
    map: <span>map-slot</span>,
    responses: <span>responses-slot</span>,
    ...overrides,
  }
  render(<AppShell {...props} />)
  return props
}

describe('AppShell', () => {
  it('renders the title and every region with its slot content', () => {
    renderShell({ assumptions: <span>assumptions-slot</span> })

    const banner = screen.getByRole('banner')
    expect(banner).toHaveTextContent('RouteRipple')
    const title = screen.getByRole('heading', { level: 1, name: 'RouteRipple' })
    expect(title).toBeInTheDocument()
    expect(title.querySelector('img')).toHaveAttribute('alt', '')
    expect(screen.getByRole('main')).toBeInTheDocument()

    const regions: [string, string][] = [
      ['Indicators', 'indicators-slot'],
      ['Triage board', 'board-slot'],
      ['Map panel', 'map-slot'],
      ['Response options', 'responses-slot'],
      ['Assumptions and sources', 'assumptions-slot'],
    ]
    for (const [name, content] of regions) {
      expect(screen.getByRole('region', { name })).toHaveTextContent(content)
    }
  })

  it('omits the assumptions region when no slot is given', () => {
    renderShell()
    expect(screen.queryByRole('region', { name: 'Assumptions and sources' })).toBeNull()
  })

  it('expands assumptions into a readable panel and collapses with Escape', () => {
    renderShell({ assumptions: <p>All sources and limitations</p> })
    const content = screen.getByText('All sources and limitations')
    const toggle = screen.getByRole('button', { name: /Assumptions & sources.*Expand panel/ })
    expect(content).not.toBeVisible()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)
    expect(content).toBeVisible()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('region', { name: 'Assumptions details' })).toHaveAttribute(
      'id',
      toggle.getAttribute('aria-controls'),
    )

    fireEvent.keyDown(content, { key: 'Escape' })
    expect(content).not.toBeVisible()
    expect(toggle).toHaveFocus()
  })

  it('collapses assumptions on Reset as well as restoring the scenario', () => {
    const props = renderShell({ assumptions: <p>All sources and limitations</p> })
    fireEvent.click(screen.getByRole('button', { name: /Assumptions & sources.*Expand panel/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByText('All sources and limitations')).not.toBeVisible()
    expect(props.onReset).toHaveBeenCalledTimes(1)
  })

  it('marks the active scenario with aria-pressed', () => {
    renderShell({ scenario: 'disrupted' })
    expect(screen.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Disrupted' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('fires the toggle, reset and report callbacks', () => {
    const props = renderShell()

    fireEvent.click(screen.getByRole('button', { name: 'Disrupted' }))
    expect(props.onScenarioChange).toHaveBeenCalledWith('disrupted')
    fireEvent.click(screen.getByRole('button', { name: 'Normal' }))
    expect(props.onScenarioChange).toHaveBeenLastCalledWith('normal')

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(props.onReset).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Report incident' }))
    expect(props.onReportIncident).toHaveBeenCalledTimes(1)
  })
})
