import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder"
import * as Effect from "effect/Effect"
import * as Random from "effect/Random"
import { MyHttpApi } from "./api"
import { Workflows } from "./workflows"

export const HttpAppLive = HttpApiBuilder.group(MyHttpApi, "app", (handles) =>
  Effect.gen(function*() {
    const workflow = yield* Workflows.getWorkflow<WorkflowsBinding>("MyWorkflow")

    return handles.handle(
      "index",
      () =>
        Effect.gen(function*() {
          const id = yield* Random.nextIntBetween(1000, 9999).pipe(Effect.map(String))

          /**
           * Create a workflow with payload, params is typed to the workflow schema and will be encoded to the event
           */
          const workflowInstance = yield* workflow.create({
            params: {
              id,
              name: "Test"
            }
          }).pipe(Effect.orDie)

          const workflowState = yield* Effect.all({
            id: workflowInstance.id,
            status: workflowInstance.status
          })

          return { id: workflowState.id, status: workflowState.status }
        })
    )
  }))
