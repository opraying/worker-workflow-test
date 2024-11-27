import * as Etag from "@effect/platform/Etag"
import * as FileSystem from "@effect/platform/FileSystem"
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder"
import * as HttpMiddleware from "@effect/platform/HttpMiddleware"
import * as HttpPlatform from "@effect/platform/HttpPlatform"
import * as Path from "@effect/platform/Path"
import * as Data from "effect/Data"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import { flow, pipe } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as LogLevel from "effect/LogLevel"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { MyHttpApi } from "./api"
import { HttpAppLive } from "./handle"
import { makeWorkflow, Workflow, Workflows } from "./workflows"

declare global {
  // eslint-disable-next-line no-var
  var env: Env

  // for type safety when using workflows
  type WorkflowsBinding = typeof workflows
}

const HttpLive = Layer.mergeAll(HttpAppLive).pipe(
  Layer.provide(
    Workflows.fromRecord(() => workflows)
  )
)

const Live = pipe(
  HttpApiBuilder.Router.Live,
  Layer.provideMerge(
    HttpApiBuilder.api(MyHttpApi).pipe(Layer.provide(HttpLive))
  ),
  Layer.provideMerge(HttpPlatform.layer),
  Layer.provideMerge(Etag.layerWeak),
  Layer.provideMerge(Path.layer),
  Layer.provideMerge(FileSystem.layerNoop({})),
  Layer.provide(Logger.minimumLogLevel(LogLevel.All)),
  Layer.provide(Logger.structured)
)

//  ----- Workflow -----

class WorkflowEventError extends Data.TaggedError("WorkflowEventError")<{ message?: string; cause?: unknown }> {}

class Step2Request extends Schema.TaggedRequest<Step2Request>()("Step2Request", {
  failure: Schema.Never,
  success: Schema.Option(Schema.String),
  payload: {
    event: Schema.Struct({ id: Schema.String, name: Schema.Option(Schema.String) })
  }
}) {}

const step2 = Workflow.fn(Step2Request, ({ event: { id, name } }) =>
  Effect.gen(function*() {
    yield* Effect.log(`id: ${id}`, `name: ${name}`)

    /**
     * In `do`, if the return value is not serialized, types like Option cannot work normally and will be handled by Schema here.
     */
    return Option.map(name, (name) => `hi ${name}`)
  }))

const step3 = Workflow.do("step3", Effect.log("step3"))

const WorkflowParams = Schema.Struct({
  id: Schema.String,
  name: Schema.String
})

export const runMyWorkflow = ({ id, name }: typeof WorkflowParams.Type) =>
  Effect.gen(function*() {
    yield* Effect.log("my workflow params", { id, name })

    const workflow = yield* Workflow

    /**
     * Simple workflow step
     */
    const step1Result = yield* workflow.do(
      "step1",
      pipe(
        Effect.log("step1"),
        Effect.andThen(Effect.sleep("1 second")),
        Effect.andThen(Effect.succeed(10))
      )
    )
    yield* Effect.log("step1 result", step1Result)

    /**
     * Direct use of workflow
     */
    const now = yield* DateTime.now
    const until = DateTime.add(now, { minutes: 1 })
    yield* Workflow.sleepUntil("sleep until", until)
    yield* Effect.log("sleep until done")

    /**
     * Workflow step with payload, deserialized from event and serialized to result
     */
    const step2Result = yield* step2({
      event: {
        id,
        name: Option.fromNullable(name)
      }
    })
    yield* Effect.log("step2 result", step2Result.pipe(Option.getOrElse(() => "no name")))

    /**
     * Workflow step with no payload
     */
    yield* step3
  })

// ---------

export const MyWorkflow = makeWorkflow(
  { name: "MyWorkflow", binding: "MY_WORKFLOW", schema: WorkflowParams },
  flow(
    runMyWorkflow,
    // Effect.provide([D1Live, Cloudflare.CloudflareLive]),
    Effect.mapError((error) => new WorkflowEventError({ cause: error })),
    Effect.orDie
  )
)

const workflows = {
  MyWorkflow
}

export default {
  fetch(request, env) {
    Object.assign(globalThis, {
      env
    })

    const handler = HttpApiBuilder.toWebHandler(Live, { middleware: HttpMiddleware.logger })

    return handler.handler(request)
  }
} satisfies ExportedHandler<Env>
