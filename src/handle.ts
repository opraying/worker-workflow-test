import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder"
import * as Effect from "effect/Effect"
import * as Random from "effect/Random"
import { MyHttpApi } from "./api"
import { Workflows } from "./workflows"

export const HttpAppLive = HttpApiBuilder.group(MyHttpApi, "app", (handles) =>
  Effect.gen(function*() {
    const workflows = yield* Workflows
    const myWorkflow = workflows.getWorkflow<WorkflowsBinding>("MyWorkflow")

    return handles.handle(
      "index",
      () =>
        Effect.gen(function*() {
          const id = yield* Random.nextIntBetween(1000, 9999).pipe(Effect.map(String))
          const workflow = yield* myWorkflow.create({ id }).pipe(Effect.orDie)

          const workflowState = yield* Effect.all({
            id: workflow.id,
            status: workflow.status
          })

          return { id: workflowState.id, status: workflowState.status }
        })
    ).handle(
      "health",
      () => Effect.succeed("ok")
    )
  }))
