import * as HttpApi from "@effect/platform/HttpApi"
import * as OpenApi from "@effect/platform/OpenApi"
import { AppApi } from "./delcare"

export class MyHttpApi extends HttpApi.make("api")
  .add(AppApi)
  .annotateContext(OpenApi.annotations({
    title: "Public Api",
    description: "Public Api"
  }))
{}
