import * as Etag from "@effect/platform/Etag"
import * as FileSystem from "@effect/platform/FileSystem"
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder"
import * as HttpMiddleware from "@effect/platform/HttpMiddleware"
import * as HttpPlatform from "@effect/platform/HttpPlatform"
import * as Path from "@effect/platform/Path"
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
import { makeWorkflowEntrypoint, Workflow, Workflows } from "./workflows"

declare global {
  // eslint-disable-next-line no-var
  var env: Env

  // for type safety when using workflows
  type WorkflowsBinding = typeof workflows
}

const HttpLive = HttpApiBuilder.api(MyHttpApi).pipe(
  Layer.provide([HttpAppLive]),
  Layer.provide(
    Workflows.fromRecord(() => workflows)
  )
)

const Live = pipe(
  HttpApiBuilder.Router.Live,
  Layer.provideMerge(HttpLive),
  Layer.provideMerge(HttpPlatform.layer),
  Layer.provideMerge(Etag.layerWeak),
  Layer.provideMerge(Path.layer),
  Layer.provideMerge(FileSystem.layerNoop({})),
  Layer.provide(Logger.minimumLogLevel(LogLevel.All)),
  Layer.provide(Logger.structured)
)

//  ----- Workflow -----

class Step2Error extends Schema.TaggedError<Step2Error>("Step2Error")(
  "Step2Error",
  {
    cause: Schema.Defect
  }
) {
}

class Step2Request extends Schema.TaggedRequest<Step2Request>()("Step2Request", {
  failure: Step2Error,
  success: Schema.Option(Schema.String),
  payload: {
    event: Schema.Struct({ id: Schema.String, name: Schema.Option(Schema.String) })
  }
}) {}

let step2ErrorCount = 0

const step2 = Workflow.schema(Step2Request, ({ event: { id, name } }) =>
  Effect.gen(function*() {
    yield* Effect.log(`step2 run`).pipe(
      Effect.annotateLogs({ id })
    )

    if (step2ErrorCount <= 5) {
      step2ErrorCount++
      yield* new Step2Error({ cause: new Error("step2 error") })
    }

    /**
     * In `do`, if the return value is not serialized, types like Option cannot work normally and will be handled by Schema here.
     */
    return Option.map(name, (name) => `hi ${name}`)
  }), {
  retries: {
    limit: 10,
    delay: "300 millis"
  }
})

const step3 = Workflow.do("step3", Effect.die("step3 die message"))

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
        Effect.andThen(Effect.sleep("1 second")), // Effect sleep
        Effect.andThen(Effect.succeed(10))
      )
    )

    yield* Effect.log("step1 result", step1Result)

    yield* Workflow.sleep("sleep", "5 seconds") // Workflow sleep

    /**
     * Direct use of workflow
     */
    const now = yield* DateTime.now
    const until = DateTime.add(now, { seconds: 5 })
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
     * Step die
     */
    yield* step3.pipe(
      Effect.catchAllCause(() => Effect.succeed("step 3 default value")),
      Effect.tap(Effect.log)
    )

    yield* Effect.log("my workflow done")
  })

// ---------

export const MyWorkflow = makeWorkflowEntrypoint(
  { name: "MyWorkflow", binding: "MY_WORKFLOW", schema: WorkflowParams },
  flow(
    runMyWorkflow
    // Effect.provide([D1Live, CloudflareLive]),
  )
)

const workflows = {
  MyWorkflow
}

const handler = HttpApiBuilder.toWebHandler(Live, { middleware: HttpMiddleware.logger })

export default {
  fetch(request, env) {
    Object.assign(globalThis, {
      env
    })

    return handler.handler(request)
  }
} satisfies ExportedHandler<Env>
