import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint"
import * as HttpApiGroup from "@effect/platform/HttpApiGroup"
import * as OpenApi from "@effect/platform/OpenApi"
import * as Schema from "effect/Schema"

export class AppApi extends HttpApiGroup.make("app")
  .add(HttpApiEndpoint.get("index", "/").addSuccess(Schema.Any))
  .add(HttpApiEndpoint.get("health", "/health").addSuccess(Schema.String))
  .annotate(OpenApi.Title, "App Api")
  .annotate(OpenApi.Description, "App Api")
{}
