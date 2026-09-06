import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/compare')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/compare"!</div>
}
