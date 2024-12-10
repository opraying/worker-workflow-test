# Effect & Cloudflare Workers Workflow integration

To install dependencies:

```bash
bun install
```

To run:

```bash
bun dev
```

This project was created using `bun init` in bun v1.1.24. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.

This repository was forked from opraying/workers-starter.

# Logs

```bash
timestamp=2024-12-10T11:56:19.566Z level=INFO fiber=#7 message="my workflow params" message="{
  \"id\": \"7765\",
  \"name\": \"Test\"
}"
timestamp=2024-12-10T11:56:19.577Z level=INFO fiber=#8 message=step1
timestamp=2024-12-10T12:00:02.786Z level=INFO fiber=#7 message="step1 result" message=10
timestamp=2024-12-10T12:00:07.787Z level=INFO fiber=#7 message="sleep until done"
timestamp=2024-12-10T12:00:07.792Z level=INFO fiber=#9 message="step2 run" id=9619
✘ [ERROR] Uncaught (in promise)
timestamp=2024-12-10T12:00:08.085Z level=INFO fiber=#10 message="step2 run" id=9619
✘ [ERROR] Uncaught (in promise)
timestamp=2024-12-10T12:00:08.386Z level=INFO fiber=#11 message="step2 run" id=9619
✘ [ERROR] Uncaught (in promise)
timestamp=2024-12-10T12:00:08.686Z level=INFO fiber=#12 message="step2 run" id=9619
✘ [ERROR] Uncaught (in promise)
timestamp=2024-12-10T12:00:08.987Z level=INFO fiber=#13 message="step2 run" id=9619
✘ [ERROR] Uncaught (in promise)
timestamp=2024-12-10T12:00:09.292Z level=INFO fiber=#14 message="step2 run" id=9619
✘ [ERROR] Uncaught (in promise)
timestamp=2024-12-10T12:00:09.589Z level=INFO fiber=#15 message="step2 run" id=9619
timestamp=2024-12-10T12:00:09.590Z level=INFO fiber=#7 message="step2 result" message="hi Test"
timestamp=2024-12-10T12:00:09.591Z level=ERROR fiber=#7 cause="Error: step3 die message"
timestamp=2024-12-10T12:00:09.592Z level=INFO fiber=#7 message="step 3 default value"
timestamp=2024-12-10T12:00:09.592Z level=INFO fiber=#7 message="my workflow done"
```

# Example

```typescript
const workflow = Effect.gen(function* () {
  yield* Workflow.do("step1", Effect.log("hello"))

  yield* Workflow.do("step2", Effect.log("world!"))

  yield* Workflow.sleep("sleep", "8 hours")

  yield* Workflow.do("step3", Effect.log("ship 🚀"), {
    retries: {
      limit: 10,
      delay: "300 millis"
    }
  })
})

// Workflow.do
// Workflow.schema
// Workflow.sleep
// Workflow.sleepUntil
```
