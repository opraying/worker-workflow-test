import type * as Cloudflare from "@cloudflare/workers-types/experimental"
import type * as CloudflareWorkers from "cloudflare:workers"
import * as Context from "effect/Context"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import type { LazyArg } from "effect/Function"
import { pipe } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Runtime from "effect/Runtime"

type WorkflowInstance = {
  readonly id: Effect.Effect<string>
  readonly pause: Effect.Effect<void>
  readonly resume: Effect.Effect<void>
  readonly terminate: Effect.Effect<void>
  readonly restart: Effect.Effect<void>
  readonly status: Effect.Effect<Cloudflare.InstanceStatus>
}

const makeInstance = (instance: Cloudflare.WorkflowInstance): WorkflowInstance => {
  return {
    id: Effect.sync(() => instance.id),
    pause: Effect.promise(() => instance.pause()),
    resume: Effect.promise(() => instance.resume()),
    terminate: Effect.promise(() => instance.terminate()),
    restart: Effect.promise(() => instance.restart()),
    status: Effect.promise(() => instance.status())
  }
}

interface CloudflareWorkflow {
  readonly get: (id: string) => Promise<any>
  readonly create: (options?: Cloudflare.WorkflowInstanceCreateOptions) => Promise<any>
}

const make = <T extends Record<string, CloudflareWorkflow>>(record: T) => {
  const get = <K extends T>(key: keyof K, id: string) =>
    Effect.promise(() => record[key as any].get(id)).pipe(
      Effect.map(makeInstance)
    )

  const create = <K extends T>(key: keyof K, options?: Cloudflare.WorkflowInstanceCreateOptions) =>
    Effect.promise(() => record[key as any].create(options)).pipe(
      Effect.map(makeInstance)
    )

  return {
    get,
    create,
    getWorkflow: <K extends T>(key: keyof K) => ({
      get: (id: string) => get(key, id),
      create: (options?: Cloudflare.WorkflowInstanceCreateOptions) => create(key, options)
    })
  }
}

export class Workflows extends Context.Tag("Workflows")<Workflows, ReturnType<typeof make>>() {
  static fromRecord = <T extends Record<string, CloudflareWorkflow>>(record: LazyArg<T>) =>
    Layer.sync(this, () => make(record()))
}

const zone = DateTime.zoneUnsafeMakeNamed("UTC")

export class WorkflowEvent
  extends Context.Tag("WorkflowEvent")<WorkflowEvent, CloudflareWorkers.WorkflowEvent<unknown>>()
{
  static params = <T>(_: T) => this as Context.Tag<WorkflowEvent, CloudflareWorkers.WorkflowEvent<T>>
}

export interface Workflow {
  readonly do: <T>(
    name: string,
    effect: Effect.Effect<T>,
    options?: CloudflareWorkers.WorkflowStepConfig
  ) => Effect.Effect<T>
  readonly sleep: (name: string, duration: Duration.DurationInput) => Effect.Effect<void>
  readonly sleepUntil: (name: string, timestamp: DateTime.DateTime) => Effect.Effect<void>
}
export const Workflow = Context.GenericTag<Workflow>("Workflow")

export const EffectWorkflowRun = (
  effect: Effect.Effect<unknown, never, Workflow | WorkflowEvent>
) => {
  return {
    run: (
      event: CloudflareWorkers.WorkflowEvent<unknown>,
      step: CloudflareWorkers.WorkflowStep
    ): Promise<unknown> =>
      Effect.runPromise(
        pipe(
          effect,
          Effect.provide(
            Layer.succeed(WorkflowEvent, event)
          ),
          Effect.provide(
            Layer.sync(Workflow, () => ({
              do: (name, callback, options) => {
                const fn = Effect.runtime<never>().pipe(
                  Effect.bindTo("runtime"),
                  Effect.andThen(({ runtime }) =>
                    Effect.promise((signal) =>
                      step.do(
                        name,
                        options ?? {},
                        () => Runtime.runPromise(runtime)(callback, { signal }) as any
                      )
                    )
                  )
                )

                return fn as any
              },

              sleep: (name, duration) => Effect.promise(() => step.sleep(name, Duration.toSeconds(duration))),

              sleepUntil: (name, timestamp) =>
                Effect.promise(() => step.sleepUntil(name, DateTime.toEpochMillis(timestamp)))
            }))
          ),
          DateTime.withCurrentZone(zone)
        )
      )
  }
}
