import type * as Cloudflare from "@cloudflare/workers-types/experimental"
import * as HttpTraceContext from "@effect/platform/HttpTraceContext"
import type * as CloudflareWorkers from "cloudflare:workers"
import { WorkerEntrypoint } from "cloudflare:workers"
import * as Cause from "effect/Cause"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Context from "effect/Context"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type { LazyArg } from "effect/Function"
import { pipe } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import type * as ParseResult from "effect/ParseResult"
import * as Predicate from "effect/Predicate"
import * as Runtime from "effect/Runtime"
import * as Schema from "effect/Schema"
import * as Struct from "effect/Struct"

export type WorkflowInstance = {
  /**
   * Return the id of a Workflow.  */
  readonly id: Effect.Effect<string>
  /**
   * Return the status of a running Workflow instance.
   */
  readonly status: Effect.Effect<Cloudflare.InstanceStatus>
  /**
   * Pause a running Workflow instance.
   */
  readonly pause: Effect.Effect<void>
  /**
   * Resume a paused Workflow instance.
   */
  readonly resume: Effect.Effect<void>
  /**
   * Restart a Workflow instance.
   */
  readonly restart: Effect.Effect<void>
  /**
   * Terminate a Workflow instance.
   */
  readonly terminate: Effect.Effect<void>
  /**
   * Send an event to a running Workflow instance.
   * Return void on success; throws an exception if the Workflow is not running or is an errored state.
   */
  readonly sendEvent: (_: { type: string; payload: unknown }) => Effect.Effect<void>
}

const makeInstance = (instance: Cloudflare.WorkflowInstance): WorkflowInstance => {
  return {
    id: Effect.sync(() => instance.id),
    status: Effect.promise(() => instance.status()),
    pause: Effect.promise(() => instance.pause()),
    resume: Effect.promise(() => instance.resume()),
    restart: Effect.promise(() => instance.restart()),
    terminate: Effect.promise(() => instance.terminate()),
    sendEvent: (_: { type: string; payload: unknown }) => Effect.promise(() => instance.sendEvent(_))
  }
}
interface WorkflowInstanceCreateOptions<T = unknown> {
  readonly id?: string | undefined
  readonly params: T | undefined
}

export interface WorkflowStepConfig {
  readonly retries?: {
    limit: number
    delay: Duration.DurationInput
    backoff?: "constant" | "linear" | "exponential"
  }
  readonly timeout?: Duration.DurationInput
}

const optionsToRetries = (options?: WorkflowStepConfig): CloudflareWorkers.WorkflowStepConfig => {
  const ret: CloudflareWorkers.WorkflowStepConfig = {}

  if (options?.retries) {
    ret.retries = {
      delay: Duration.toMillis(options.retries.delay),
      limit: options.retries.limit
    }
    if (options.retries.backoff) {
      ret.retries.backoff = options.retries.backoff
    }
  }

  if (options?.timeout) {
    ret.timeout = Duration.toMillis(options.timeout)
  }

  return ret
}

interface CloudflareWorkflow {
  /**
   * @link https://developers.cloudflare.com/workflows/build/workers-api/#get
   */
  readonly get: (id: string) => Promise<any>

  /**
   * @link https://developers.cloudflare.com/workflows/build/workers-api/#create
   */
  readonly create: (options?: WorkflowInstanceCreateOptions) => Promise<any>
}

const make = <T extends Record<string, CloudflareWorkflow>, R extends Record<keyof T, WorkflowClass<any, any>>>(
  getEnv: LazyArg<T>,
  record: R
) => {
  const getClass = (workflowTag: keyof T) => record[workflowTag]

  const getBinding = (ins: ReturnType<typeof getClass>) => getEnv()[ins._binding]

  const get = (workflowTag: keyof T, id: string) => {
    const workflow = getClass(workflowTag)
    return Effect.tryPromise({
      try: () => getBinding(workflow).get(id),
      catch: () => new Cause.NoSuchElementException()
    }).pipe(
      Effect.map(makeInstance),
      Effect.asSome,
      Effect.orElseSucceed(() => Option.none<WorkflowInstance>())
    )
  }

  const create = <A = unknown>(workflowTag: keyof T, options: WorkflowInstanceCreateOptions<A>) => {
    const workflow = getClass(workflowTag)
    const encode = Schema.encodeUnknown(workflow._schema)

    return pipe(
      Effect.all(
        {
          params: options.params ? encode(options.params) : Effect.void,
          headers: Effect.currentSpan.pipe(Effect.map(HttpTraceContext.toHeaders), Effect.optionFromOptional)
        },
        { concurrency: "unbounded" }
      ),
      Effect.andThen(({ headers, params }) =>
        getBinding(workflow).create({
          id: options?.id,
          params: {
            ...params,
            __headers: Option.match(headers, {
              onSome: (headers) => ({
                b3: headers.b3,
                traceparent: headers.traceparent
              }),
              onNone: () => ({})
            })
          }
        })
      ),
      Effect.map(makeInstance),
      Effect.withSpan(`Workflows.create.${workflowTag.toString()}`, {
        attributes: {
          workflowTag,
          id: options?.id,
          params: options?.params
        }
      }),
      Effect.orDie
    )
  }

  return {
    get,
    create,
    getWorkflow: <R extends Record<string, WorkflowClass<any, any>>>(workflowTag: keyof R) => ({
      get: (id: string) => get(workflowTag as any, id),
      create: (options: WorkflowInstanceCreateOptions<R[typeof workflowTag]["_a"]>) =>
        create(workflowTag as any, options)
    })
  }
}

export class Workflows extends Effect.Tag("Workflows")<Workflows, ReturnType<typeof make>>() {
  static fromRecord = <T extends Record<string, WorkflowClass<any, any>>>(record: LazyArg<T>) =>
    Layer.sync(this, () => make(() => (globalThis as any).env, record()))

  static getWorkflow = <R extends Record<string, WorkflowClass<any, any>>>(workflowTag: keyof R) =>
    Effect.map(this, (_) => _.getWorkflow<R>(workflowTag))
}

const workerZone = DateTime.zoneUnsafeMakeNamed("UTC")

export class WorkflowEvent extends Context.Tag("@server:workflow-event")<
  WorkflowEvent,
  CloudflareWorkers.WorkflowEvent<unknown>
>() {
  static params = <T>(_: T) => this as Context.Tag<WorkflowEvent, CloudflareWorkers.WorkflowEvent<T>>
}

type DoPayload<Payload extends Schema.Struct.Fields> = {
  [k in Exclude<keyof Payload, "_tag">]: Payload[k] extends Schema.Schema.All ? Payload[k]["Type"] : never
}

export class Workflow extends Context.Tag("@server:workflow")<
  Workflow,
  {
    readonly do: <A, E = never, R = never>(
      name: string,
      effect: Effect.Effect<A, E, R>,
      options?: WorkflowStepConfig
    ) => Effect.Effect<A, E, never>

    readonly schema: <
      Tag extends string,
      Payload extends Schema.Struct.Fields,
      Success extends Schema.Schema.All,
      Failure extends Schema.Schema.All,
      R
    >(
      SchemaClass: Schema.TaggedRequestClass<
        any,
        Tag,
        {
          readonly _tag: Schema.tag<Tag>
        } & Payload,
        Success,
        Failure
      >,
      effect: (payload: Payload) => Effect.Effect<Success["Type"], Failure["Type"], R>,
      options?: WorkflowStepConfig
    ) => (_: Payload) => Effect.Effect<Success["Type"], Failure["Type"], never>

    readonly sleep: (label: string, duration: Duration.DurationInput) => Effect.Effect<void, never>

    readonly sleepUntil: (label: string, timestamp: DateTime.DateTime) => Effect.Effect<void, never>

    readonly waitForEvent: <T = never>(
      label: string,
      options: { type: string; timeout?: Duration.DurationInput | undefined }
    ) => Effect.Effect<
      {
        payload: T
        timestamp: Date
        type: string
      },
      never
    >
  }
>() {
  static do = <A, E = never, R = never>(name: string, effect: Effect.Effect<A, E, R>, options?: WorkflowStepConfig) =>
    Effect.flatMap(Workflow, (workflow) => workflow.do(name, effect, options))

  static schema = <
    Tag extends string,
    Payload extends Schema.Struct.Fields,
    Success extends Schema.Schema.All,
    Failure extends Schema.Schema.All,
    R
  >(
    SchemaClass: Schema.TaggedRequestClass<any, Tag, Payload, Success, Failure>,
    effect: (payload: DoPayload<Payload>) => Effect.Effect<Success["Type"], Failure["Type"], R>,
    options?: WorkflowStepConfig
  ) =>
  (payload: DoPayload<Payload>) =>
    Effect.flatMap(Workflow, (workflow) => workflow.schema(SchemaClass as any, effect, options)(payload))

  static sleep = (label: string, duration: Duration.DurationInput) =>
    Effect.flatMap(Workflow, (workflow) => workflow.sleep(label, duration))

  static sleepUntil = (label: string, timestamp: DateTime.DateTime) =>
    Effect.flatMap(Workflow, (workflow) => workflow.sleepUntil(label, timestamp))

  static waitForEvent = <T>(label: string, options: { type: string; timeout?: Duration.DurationInput | undefined }) =>
    Effect.flatMap(Workflow, (workflow) => workflow.waitForEvent<T>(label, options))
}

export interface WorkflowClass<A, I> extends WorkerEntrypoint<never> {
  readonly _a: A
  readonly _i: I
  readonly _schema: Schema.Schema<A, I>
  readonly _binding: string
  readonly run: (...args: any) => Promise<void>
}

export const runEffectWorkflow = <A, I, E = never, Env = unknown>(
  schema: Schema.Schema<A, I>,
  effect: (event: A) => Effect.Effect<void, E, Workflow | WorkflowEvent>
) => {
  const decode = Schema.decodeUnknown(schema)
  const DoExitSchema = Schema.Exit({
    defect: Schema.Defect,
    failure: Schema.Union(Schema.Defect, Schema.Any),
    success: Schema.Any
  })
  const encodeDoExit = Schema.encodeUnknownSync(DoExitSchema)
  const decodeDoExit = Schema.decodeUnknown(DoExitSchema)

  const catchAll = (_: {
    decode: (input: unknown) => Effect.Effect<Exit.Exit<any, any>, ParseResult.ParseError, never>
  }) =>
  (
    effect: Effect.Effect<any, any>
  ) =>
    pipe(
      effect,
      Effect.catchAllCause((cause) => {
        if (cause._tag === "Fail") {
          const fromError = Effect.sync(() => {
            if (cause.error instanceof Error) {
              return cause.error
            }
            if (Predicate.isObject(cause.error)) {
              return cause.error
            }
            return JSON.stringify(cause.error)
          })

          const safeError = cause.error?.message
            ? Effect.orElse(Effect.try(() => JSON.parse(cause.error.message) as object), () => fromError)
            : fromError

          return pipe(
            safeError,
            Effect.flatMap(_.decode),
            Effect.orDieWith((cause) => new Error("Failed to parse exit", { cause })),
            Effect.flatMap(
              (exit) =>
                Exit.match(exit, {
                  onSuccess: () => Effect.dieMessage("Should never happen"),
                  onFailure: (cause) => Cause.isDieType(cause) ? Effect.die(cause.defect) : Effect.failCause(cause)
                })
            )
          )
        }

        if (cause._tag === "Die") {
          return Effect.die(cause.defect)
        }

        return Effect.die(Cause.squash(cause))
      }),
      Effect.flatMap((result) => {
        // Step do success, but not return anything
        if (!result) {
          return Effect.void
        }

        return pipe(
          _.decode(result),
          Effect.orDieWith((cause) => new Error("Failed to parse exit", { cause })),
          Effect.flatMap((exit) =>
            Exit.match(exit, {
              onSuccess: (value) => Effect.succeed(value),
              onFailure: (cause) => Cause.isDieType(cause) ? Effect.die(cause.defect) : Effect.failCause(cause)
            })
          )
        )
      })
    )

  return (
    env: Env,
    event: CloudflareWorkers.WorkflowEvent<I>,
    step: CloudflareWorkers.WorkflowStep
  ): Promise<unknown> =>
    pipe(
      decode(event.payload),
      Effect.flatMap((payload) => effect(payload)),
      Effect.provide(
        Layer.sync(Workflow, () => ({
          do: (name, callback, options) => {
            const run = pipe(
              Effect.runtime<never>(),
              Effect.andThen((runtime) =>
                Effect.tryPromise({
                  try: (signal) => {
                    const runExit = Runtime.runPromiseExit(runtime)

                    return step.do(name, optionsToRetries(options), async () => {
                      const exit = (await runExit(callback as Effect.Effect<any, any>, { signal })) as Exit.Exit<any>

                      if (Exit.isSuccess(exit)) {
                        return encodeDoExit(exit)
                      }

                      if (Exit.isFailure(exit)) {
                        /**
                         * If it is "die", then no exception is thrown;
                         * pass this step up to the outer layer to handle the termination.
                         */
                        if (Cause.isDieType(exit.cause)) {
                          // Worker unsupported Serialization Effect Cause
                          // Covert to plain error message, not Effect Cause
                          return encodeDoExit(exit)
                        }

                        /**
                         * Throw an error to make step do retry
                         * Cloudflare Workflow will wrap error string to Error instance
                         */
                        throw JSON.stringify(encodeDoExit(exit))
                      }
                    })
                  },
                  catch: (error) => error as any
                })
              ),
              catchAll({ decode: decodeDoExit })
            )

            return run as any
          },
          schema: (SchemaClass, callback, options) => (payload) => {
            const sc = new SchemaClass(Struct.omit(payload, "_tag") as any) as unknown as Schema.TaggedRequest<
              string,
              any,
              any,
              any,
              any,
              any,
              any,
              any,
              never
            >
            const successSchema = Schema.successSchema(sc)
            const failureSchema = Schema.failureSchema(sc)
            const isAllowEmpty = successSchema.ast._tag === "VoidKeyword"

            const ExitSchema = Schema.Exit({
              defect: Schema.Defect,
              failure: Schema.Union(Schema.Defect, failureSchema),
              success: Schema.transform(successSchema, Schema.Any, {
                decode: (fa) => {
                  return fa
                },
                encode: (ti) => {
                  return isAllowEmpty ? undefined : ti
                },
                strict: false
              })
            })
            const encodeExit = Schema.encodeUnknownSync(ExitSchema)
            const decodeExit = Schema.decodeUnknown(ExitSchema)

            const run = pipe(
              Effect.runtime<never>(),
              Effect.andThen((runtime) =>
                Effect.tryPromise({
                  try: (signal) => {
                    const run = Runtime.runPromiseExit(runtime)

                    return step.do(SchemaClass.identifier, optionsToRetries(options), async () => {
                      const exit = (await run(callback(payload as any) as Effect.Effect<any, any>, {
                        signal
                      })) as Exit.Exit<any>

                      if (Exit.isSuccess(exit)) {
                        try {
                          return encodeExit(exit)
                        } catch (error) {
                          return encodeExit(Exit.die(error))
                        }
                      }

                      if (Exit.isFailure(exit)) {
                        /**
                         * If it is "die", then no exception is thrown;
                         * pass this step up to the outer layer to handle the termination.
                         */
                        if (Cause.isDieType(exit.cause)) {
                          // Worker unsupported Serialization Effect Cause
                          // Covert to plain error message, not Effect Cause
                          try {
                            return encodeExit(exit)
                          } catch (error) {
                            return encodeExit(Exit.die(error))
                          }
                        }

                        /**
                         * Throw an error to make step do retry
                         * Cloudflare Workflow will wrap error string to Error instance
                         */
                        throw JSON.stringify(encodeExit(exit))
                      }
                    })
                  },
                  catch: (error) => error as any
                })
              ),
              catchAll({ decode: decodeExit })
            )

            return run as any
          },
          sleep: (label, duration) =>
            Effect.promise(() => step.sleep(label, Duration.toMillis(duration))).pipe(
              Effect.withSpan("Workflows.sleep", { attributes: { label, duration } })
            ),
          sleepUntil: (label, timestamp) =>
            Effect.promise(() => step.sleepUntil(label, DateTime.toEpochMillis(timestamp))).pipe(
              Effect.withSpan("Workflows.sleepUntil", { attributes: { label, timestamp } })
            ),
          waitForEvent: (label, options) =>
            Effect.promise(() =>
              step.waitForEvent<any>(label, {
                type: options.type,
                timeout: Duration.toMillis(options.timeout ?? Duration.days(1))
              })
            )
        }))
      ),
      Effect.provide(Layer.succeed(WorkflowEvent, event)),
      Effect.provide(Layer.setConfigProvider(ConfigProvider.fromJson(env))),
      DateTime.withCurrentZone(workerZone),
      Effect.runPromise
    )
}

export const makeWorkflowEntrypoint = <const Tag, A, I, E = never>(
  { binding, name, schema }: { name: Tag; binding: string; schema: Schema.Schema<A, I> },
  run: (event: A) => Effect.Effect<void, E, Workflow | WorkflowEvent>
) => {
  const entrypoint = class extends WorkerEntrypoint<never> {
    static _tag = name as Tag
    static _binding = binding
    static _schema = schema
    run(...args: [event: CloudflareWorkers.WorkflowEvent<I>, step: CloudflareWorkers.WorkflowStep]) {
      return runEffectWorkflow<A, I, E>(schema, run).apply(null, [this.env, ...args])
    }
  }

  return entrypoint as unknown as WorkflowClass<A, I>
}
