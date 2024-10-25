import * as Etag from "@effect/platform/Etag"
import * as FileSystem from "@effect/platform/FileSystem"
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder"
import * as HttpMiddleware from "@effect/platform/HttpMiddleware"
import * as HttpPlatform from "@effect/platform/HttpPlatform"
import * as Path from "@effect/platform/Path"
import { WorkflowEntrypoint } from "cloudflare:workers"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import { pipe } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as LogLevel from "effect/LogLevel"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { MyHttpApi } from "./api"
import { HttpAppLive } from "./handle"
import { EffectWorkflowRun, Workflow, WorkflowEvent, Workflows } from "./workflows"

declare global {
  // eslint-disable-next-line no-var
  var env: Env

  type WorkflowsBinding = {
    myWorkflow: Env["MY_WORKFLOW"]
  }
}

const HttpLive = Layer.mergeAll(HttpAppLive).pipe(
  Layer.provide(
    Workflows.fromRecord<WorkflowsBinding>(() => ({
      myWorkflow: globalThis.env.MY_WORKFLOW
    }))
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
  Layer.provide(Logger.pretty)
)

const runtime = ManagedRuntime.make(Live)

const workflow1 = EffectWorkflowRun(
  Effect.gen(function*() {
    const workflow = yield* Workflow
    const event = yield* WorkflowEvent

    yield* Effect.log("event", event)

    const step1Result = yield* workflow.do(
      "step1",
      pipe(
        Effect.log("step1"),
        Effect.andThen(Effect.sleep("1 second")),
        Effect.andThen(Effect.succeed(10))
      )
    )
    yield* Effect.log("step1-result", step1Result)

    yield* workflow.sleep("sleep 1", "1 minute")

    yield* workflow.do("step2", Effect.log("step2"))
    yield* Effect.log("step2-done")

    const now = yield* DateTime.now
    const until = DateTime.add(now, { minutes: 1 })
    yield* workflow.sleepUntil("sleep until", until)

    yield* workflow.do("step3", Effect.log("step3"))
    yield* Effect.log("step3-done")
  }).pipe(
    Effect.provide(
      Layer.mergeAll(Layer.empty).pipe(
        Layer.provide(Logger.pretty)
      )
    ),
    Logger.withMinimumLogLevel(LogLevel.All)
  )
)

export class MyWorkflow extends WorkflowEntrypoint {
  run(...args: any) {
    return workflow1.run.apply(this, args)
  }
}

export default {
  fetch(request, env) {
    Object.assign(globalThis, {
      env
    })

    const handler = HttpApiBuilder.toWebHandler(runtime, HttpMiddleware.logger)

    return handler(request as unknown as Request)
  }
} satisfies ExportedHandler<Env>
