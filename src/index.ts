import * as Etag from "@effect/platform/Etag"
import * as FileSystem from "@effect/platform/FileSystem"
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder"
import * as HttpMiddleware from "@effect/platform/HttpMiddleware"
import * as HttpPlatform from "@effect/platform/HttpPlatform"
import * as Path from "@effect/platform/Path"
import { pipe } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { MyHttpApi } from "./api"
import { HttpAppLive } from "./handle"

const HttpLive = Layer.mergeAll(HttpAppLive)

const Live = pipe(
  HttpApiBuilder.Router.Live,
  Layer.provideMerge(HttpApiBuilder.api(MyHttpApi).pipe(Layer.provide(HttpLive))),
  Layer.provideMerge(HttpPlatform.layer),
  Layer.provideMerge(Etag.layerWeak),
  Layer.provideMerge(Path.layer),
  Layer.provideMerge(FileSystem.layerNoop({})),
  Layer.provide(Logger.pretty)
)

const runtime = ManagedRuntime.make(Live)

const handler = HttpApiBuilder.toWebHandler(runtime, HttpMiddleware.logger)

declare global {
  // eslint-disable-next-line no-var
  var env: Env
}

export default {
  fetch(request, env) {
    Object.assign(globalThis, {
      env
    })

    return handler(request as unknown as Request)
  }
} satisfies ExportedHandler<Env>
