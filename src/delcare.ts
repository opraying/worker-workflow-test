import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint"
import * as HttpApiGroup from "@effect/platform/HttpApiGroup"
import * as OpenApi from "@effect/platform/OpenApi"
import * as Schema from "@effect/schema/Schema"
import { UserWithSensitive } from "./model"

export class AppApi extends HttpApiGroup.make("app").pipe(
  HttpApiGroup.add(
    HttpApiEndpoint.get("index", "/").pipe(HttpApiEndpoint.setSuccess(
      UserWithSensitive
    ))
  ),
  HttpApiGroup.add(HttpApiEndpoint.get("health", "/health").pipe(HttpApiEndpoint.setSuccess(Schema.String))),
  OpenApi.annotate({
    title: "App Api",
    description: "App Api"
  })
) {}
