import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { pipe } from "effect/Function"
import * as Layer from "effect/Layer"
import * as TestClock from "effect/TestClock"
import { runMyWorkflow } from "./index"
import { Workflow } from "./workflows"

declare let describe: any
declare let it: any

const TestWorkflow = Layer.succeed(
  Workflow,
  Workflow.of({
    do: (name, effect, _options) => effect as any,
    /**
     * NOTE: This has been omitted here
     * and serialization and deserialization of parameters and results should also be implemented.
     */
    schema: (schemaClass, effect, _options) => (...args) => {
      return effect(...args) as any
    },
    sleep: (name, duration) => TestClock.sleep(duration),
    sleepUntil: (name, timestamp) => {
      const diff = DateTime.now.pipe(
        Effect.map((now) => DateTime.toEpochMillis(now) - DateTime.toEpochMillis(timestamp))
      )

      return diff.pipe(Effect.flatMap((diff) => TestClock.sleep(Duration.millis(diff))))
    }
  })
)

describe("handle", () => {
  it("should work", () => {
    return pipe(
      Effect.gen(function*() {
        yield* runMyWorkflow({ id: "123", name: "test" })
      }),
      Effect.provide(TestWorkflow),
      Effect.runPromise
    )
  })
})
