import { startTransition, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { addAgent, getAgents } from '@/server/agents'

export const Route = createFileRoute('/')({
  loader: () => getAgents(),
  component: Home,
})

function Home() {
  const agents = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = useState<string>()
  const [isSaving, setIsSaving] = useState(false)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)

    setError(undefined)
    setIsSaving(true)
    startTransition(async () => {
      try {
        await addAgent({
          data: {
            name: String(formData.get('name')),
            description: String(formData.get('description')),
          },
        })
        form.reset()
        await router.invalidate()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not save agent')
      } finally {
        setIsSaving(false)
      }
    })
  }

  return (
    <main className="min-h-svh px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
        <section className="lg:sticky lg:top-12">
          <p className="mb-5 font-mono text-xs font-semibold tracking-[0.24em] text-primary uppercase">
            Openbot registry
          </p>
          <h1 className="max-w-xl text-5xl leading-[0.92] font-semibold tracking-[-0.055em] text-balance sm:text-6xl">
            Give every agent a clear purpose.
          </h1>
          <p className="mt-6 max-w-md text-base leading-7 text-muted-foreground">
            Define the people in your machine. Add an agent, describe its role,
            and keep the roster close at hand.
          </p>

          <Card className="mt-10 border-0 bg-card/85 shadow-[0_28px_80px_-38px_oklch(0.28_0.04_55/0.55)] ring-1 ring-foreground/10 backdrop-blur">
            <CardHeader>
              <CardTitle>New agent</CardTitle>
              <CardDescription>Both fields are required.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-5" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    name="name"
                    placeholder="Research lead"
                    autoComplete="off"
                    maxLength={80}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    name="description"
                    placeholder="Finds primary sources and turns them into concise briefs."
                    rows={4}
                    maxLength={500}
                    required
                  />
                </div>
                {error ? (
                  <p className="text-sm text-destructive" role="alert">
                    {error}
                  </p>
                ) : null}
                <Button className="w-full" type="submit" disabled={isSaving}>
                  {isSaving ? 'Adding agent...' : 'Add agent'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="agent-list-title">
          <div className="flex items-end justify-between border-b border-foreground/15 pb-4">
            <div>
              <p className="font-mono text-xs tracking-[0.18em] text-muted-foreground uppercase">
                Active roster
              </p>
              <h2 id="agent-list-title" className="mt-2 text-2xl font-semibold tracking-tight">
                Agents
              </h2>
            </div>
            <span className="font-mono text-sm tabular-nums text-muted-foreground">
              {String(agents.length).padStart(2, '0')}
            </span>
          </div>

          {agents.length === 0 ? (
            <div className="grid min-h-72 place-items-center border-b border-foreground/15 text-center">
              <div>
                <p className="text-lg font-medium">The roster is empty.</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Add the first agent to get started.
                </p>
              </div>
            </div>
          ) : (
            <ol>
              {agents.map((agent, index) => (
                <li
                  className="group grid grid-cols-[2.5rem_1fr] gap-4 border-b border-foreground/15 py-7 sm:grid-cols-[3.5rem_1fr] sm:py-9"
                  key={agent.id}
                >
                  <span className="pt-1 font-mono text-xs text-muted-foreground transition-colors group-hover:text-primary">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">
                      {agent.name}
                    </h3>
                    <p className="mt-3 max-w-xl leading-7 text-muted-foreground">
                      {agent.description}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  )
}
